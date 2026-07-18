from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.database import get_db
from models.academic_master import AcademicClass, AcademicGrade, AcademicMasterAudit, AcademicProgram
from models.academic_year import AcademicYear
from models.jenjang import Jenjang
from models.student_enrollment import StudentEnrollment
from models.user import User
from security.dependencies import get_current_user, require_role


router = APIRouter(dependencies=[Depends(get_current_user), Depends(require_role("admin"))])


class YearBody(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    start_date: date
    end_date: date
    is_active: bool = False
    is_default: bool = False

    @model_validator(mode="after")
    def dates_are_ordered(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class JenjangBody(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=255)
    level: str = Field(min_length=1, max_length=64)
    active: bool = True


class ProgramBody(BaseModel):
    jenjang_id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=255)
    active: bool = True


class GradeBody(BaseModel):
    jenjang_id: int = Field(gt=0)
    program_id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=255)
    sequence_number: int = Field(gt=0)
    active: bool = True


class ClassBody(BaseModel):
    academic_year_id: int = Field(gt=0)
    grade_id: int = Field(gt=0)
    class_name: str = Field(min_length=1, max_length=255)
    section_code: str = Field(default="", max_length=32)
    active: bool = True


def _snapshot(row) -> dict:
    values = {}
    for column in row.__table__.columns:
        value = getattr(row, column.name)
        values[column.name] = value.isoformat() if hasattr(value, "isoformat") else value
    return values


def _audit(db: Session, entity: str, row_id, action: str, actor: str, before=None, after=None):
    db.add(AcademicMasterAudit(entity_type=entity, entity_id=str(row_id), action=action, actor=actor, before_data=before, after_data=after))


def _commit(db: Session):
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Duplicate or referenced academic master") from exc


def _get(db: Session, model, row_id: int, label: str):
    row = db.get(model, row_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"{label} not found")
    return row


@router.get("/academic-years")
def list_years(db: Session = Depends(get_db)):
    return db.query(AcademicYear).order_by(AcademicYear.start_date.desc(), AcademicYear.id).all()


@router.post("/academic-years", status_code=status.HTTP_201_CREATED)
def create_year(body: YearBody, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    if body.is_default:
        db.query(AcademicYear).filter(AcademicYear.is_default.is_(True)).update({AcademicYear.is_default: False})
    row = AcademicYear(label=body.name.strip(), start_date=body.start_date, end_date=body.end_date, status="active" if body.is_active else "upcoming", is_default=body.is_default)
    db.add(row); db.flush(); _audit(db, "academic_year", row.id, "CREATE", user.username, after=_snapshot(row)); _commit(db); db.refresh(row); return row


@router.put("/academic-years/{row_id}")
def update_year(row_id: int, body: YearBody, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    row = _get(db, AcademicYear, row_id, "Academic year"); before = _snapshot(row)
    if body.is_default:
        db.query(AcademicYear).filter(AcademicYear.id != row.id, AcademicYear.is_default.is_(True)).update({AcademicYear.is_default: False})
    row.label, row.start_date, row.end_date, row.status, row.is_default = body.name.strip(), body.start_date, body.end_date, "active" if body.is_active else "upcoming", body.is_default
    _audit(db, "academic_year", row.id, "UPDATE", user.username, before, _snapshot(row)); _commit(db); db.refresh(row); return row


@router.delete("/academic-years/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_year(row_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    row = _get(db, AcademicYear, row_id, "Academic year")
    if db.query(AcademicClass).filter_by(academic_year_id=row.id).first() or db.query(StudentEnrollment).filter_by(academic_year_id=row.id).first():
        raise HTTPException(status_code=409, detail="Academic year is referenced; deactivate it instead")
    before = _snapshot(row); db.delete(row); _audit(db, "academic_year", row.id, "DELETE", user.username, before=before); _commit(db)


@router.get("/jenjangs")
def list_jenjangs(db: Session = Depends(get_db)):
    return db.query(Jenjang).order_by(Jenjang.code, Jenjang.id).all()


@router.post("/jenjangs", status_code=status.HTTP_201_CREATED)
def create_jenjang(body: JenjangBody, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    row = Jenjang(**body.model_dump()); db.add(row); db.flush(); _audit(db, "jenjang", row.id, "CREATE", user.username, after=_snapshot(row)); _commit(db); db.refresh(row); return row


@router.put("/jenjangs/{row_id}")
def update_jenjang(row_id: int, body: JenjangBody, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    row = _get(db, Jenjang, row_id, "Jenjang"); before = _snapshot(row)
    for key, value in body.model_dump().items(): setattr(row, key, value)
    _audit(db, "jenjang", row.id, "UPDATE", user.username, before, _snapshot(row)); _commit(db); db.refresh(row); return row


@router.delete("/jenjangs/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_jenjang(row_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    row = _get(db, Jenjang, row_id, "Jenjang")
    if db.query(AcademicProgram).filter_by(jenjang_id=row.id).first() or db.query(StudentEnrollment).filter_by(jenjang_id=row.id).first():
        raise HTTPException(status_code=409, detail="Jenjang is referenced; deactivate it instead")
    before = _snapshot(row); db.delete(row); _audit(db, "jenjang", row.id, "DELETE", user.username, before=before); _commit(db)


def _crud_list(db, model, *ordering): return db.query(model).order_by(*ordering).all()


@router.get("/programs")
def list_programs(db: Session = Depends(get_db)): return _crud_list(db, AcademicProgram, AcademicProgram.jenjang_id, AcademicProgram.name)


@router.post("/programs", status_code=201)
def create_program(body: ProgramBody, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    _get(db, Jenjang, body.jenjang_id, "Jenjang"); row = AcademicProgram(**body.model_dump()); db.add(row); db.flush(); _audit(db, "program", row.id, "CREATE", user.username, after=_snapshot(row)); _commit(db); db.refresh(row); return row


@router.put("/programs/{row_id}")
def update_program(row_id: int, body: ProgramBody, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    _get(db, Jenjang, body.jenjang_id, "Jenjang"); row = _get(db, AcademicProgram, row_id, "Program"); before = _snapshot(row)
    for k,v in body.model_dump().items(): setattr(row,k,v)
    _audit(db,"program",row.id,"UPDATE",user.username,before,_snapshot(row)); _commit(db); db.refresh(row); return row


@router.delete("/programs/{row_id}", status_code=204)
def delete_program(row_id:int, db:Session=Depends(get_db), user:User=Depends(require_role("admin"))):
    row=_get(db,AcademicProgram,row_id,"Program")
    if db.query(AcademicGrade).filter_by(program_id=row.id).first(): raise HTTPException(409,"Program is referenced; deactivate it instead")
    before=_snapshot(row); db.delete(row); _audit(db,"program",row.id,"DELETE",user.username,before=before); _commit(db)


@router.get("/grades")
def list_grades(db: Session = Depends(get_db)): return _crud_list(db, AcademicGrade, AcademicGrade.program_id, AcademicGrade.sequence_number)


def _validate_grade_parent(db, body: GradeBody):
    program=_get(db,AcademicProgram,body.program_id,"Program")
    if program.jenjang_id != body.jenjang_id: raise HTTPException(422,"Program does not belong to jenjang")


@router.post("/grades", status_code=201)
def create_grade(body:GradeBody, db:Session=Depends(get_db), user:User=Depends(require_role("admin"))):
    _validate_grade_parent(db,body); row=AcademicGrade(**body.model_dump()); db.add(row); db.flush(); _audit(db,"grade",row.id,"CREATE",user.username,after=_snapshot(row)); _commit(db); db.refresh(row); return row


@router.put("/grades/{row_id}")
def update_grade(row_id:int,body:GradeBody,db:Session=Depends(get_db),user:User=Depends(require_role("admin"))):
    _validate_grade_parent(db,body); row=_get(db,AcademicGrade,row_id,"Grade"); before=_snapshot(row)
    for k,v in body.model_dump().items(): setattr(row,k,v)
    _audit(db,"grade",row.id,"UPDATE",user.username,before,_snapshot(row)); _commit(db); db.refresh(row); return row


@router.delete("/grades/{row_id}", status_code=204)
def delete_grade(row_id:int,db:Session=Depends(get_db),user:User=Depends(require_role("admin"))):
    row=_get(db,AcademicGrade,row_id,"Grade")
    if db.query(AcademicClass).filter_by(grade_id=row.id).first(): raise HTTPException(409,"Grade is referenced; deactivate it instead")
    before=_snapshot(row); db.delete(row); _audit(db,"grade",row.id,"DELETE",user.username,before=before); _commit(db)


@router.get("/classes")
def list_classes(db: Session = Depends(get_db)): return _crud_list(db, AcademicClass, AcademicClass.academic_year_id, AcademicClass.grade_id, AcademicClass.class_name)


@router.post("/classes", status_code=201)
def create_class(body:ClassBody,db:Session=Depends(get_db),user:User=Depends(require_role("admin"))):
    _get(db,AcademicYear,body.academic_year_id,"Academic year"); _get(db,AcademicGrade,body.grade_id,"Grade"); row=AcademicClass(**body.model_dump()); db.add(row); db.flush(); _audit(db,"class",row.id,"CREATE",user.username,after=_snapshot(row)); _commit(db); db.refresh(row); return row


@router.put("/classes/{row_id}")
def update_class(row_id:int,body:ClassBody,db:Session=Depends(get_db),user:User=Depends(require_role("admin"))):
    _get(db,AcademicYear,body.academic_year_id,"Academic year"); _get(db,AcademicGrade,body.grade_id,"Grade"); row=_get(db,AcademicClass,row_id,"Class"); before=_snapshot(row)
    for k,v in body.model_dump().items(): setattr(row,k,v)
    _audit(db,"class",row.id,"UPDATE",user.username,before,_snapshot(row)); _commit(db); db.refresh(row); return row


@router.delete("/classes/{row_id}", status_code=204)
def delete_class(row_id:int,db:Session=Depends(get_db),user:User=Depends(require_role("admin"))):
    row=_get(db,AcademicClass,row_id,"Class")
    if db.query(StudentEnrollment).filter_by(academic_class_id=row.id).first(): raise HTTPException(409,"Class is referenced; deactivate it instead")
    before=_snapshot(row); db.delete(row); _audit(db,"class",row.id,"DELETE",user.username,before=before); _commit(db)
