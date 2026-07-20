from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.database import get_db
from models.user import User
from security.dependencies import get_current_user, require_capability
from services.enrollment_population import (
    commit_enrollment_preview,
    create_enrollment_preview,
    enrollment_summary,
)
from services.academic_mapping import build_academic_mapping_preview
from services.academic_roster import commit_roster_preview, create_roster_preview, roster_preview_checksum, roster_template
from services.academic_master_preview import create_academic_master_preview
from models.student_enrollment import StudentEnrollment
from models.student_master import StudentEnrollmentClassHistory, StudentMaster
from schemas.student_management import EnrollmentEndRequest, EnrollmentInput, EnrollmentTransferRequest
from services.student_management import create_enrollment_for_student, end_enrollment, transfer_enrollment


router = APIRouter(dependencies=[Depends(get_current_user)])


class EnrollmentPopulationPreviewRequest(BaseModel):
    academic_year_id: int = Field(gt=0)
    legacy_student_ids: list[int] | None = None
    effective_start_date: date


class EnrollmentPopulationCommitRequest(BaseModel):
    preview_id: str
    selected_legacy_student_ids: list[int] = Field(min_length=1)
    confirmation: str


class AcademicRosterCommitRequest(BaseModel):
    preview_id: str
    selected_row_ids: list[int] = Field(min_length=1)
    confirmation: str
    preview_checksum: str | None = Field(default=None, min_length=64, max_length=64)


class JenjangMasterProposal(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=255)
    level: str = Field(min_length=1, max_length=64)
    active: bool = True


class ProgramMasterProposal(BaseModel):
    jenjang_code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=255)
    active: bool = True


class ClassMasterProposal(BaseModel):
    academic_year: str = Field(min_length=1, max_length=32)
    jenjang_code: str = Field(min_length=1, max_length=32)
    program: str = Field(min_length=1, max_length=255)
    grade: str = Field(min_length=1, max_length=255)
    class_name: str = Field(min_length=1, max_length=255)
    section_code: str = Field(default="", max_length=32)
    active: bool = True


class AcademicYearMasterProposal(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    start_date: date | None = None
    end_date: date | None = None
    is_active: bool = False
    is_default: bool = False


class GradeMasterProposal(BaseModel):
    jenjang_code: str = Field(min_length=1, max_length=32)
    program: str = Field(min_length=1, max_length=255)
    name: str = Field(min_length=1, max_length=255)
    sequence_number: int = Field(gt=0)
    active: bool = True


@router.get("/student/{student_master_id}")
def list_student_enrollment_history(
    student_master_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("view_student")),
):
    if db.get(StudentMaster, student_master_id) is None:
        raise HTTPException(status_code=404, detail="Student master not found")
    enrollments = db.query(StudentEnrollment).filter_by(student_master_id=student_master_id).order_by(StudentEnrollment.academic_year_id.desc(), StudentEnrollment.id.desc()).all()
    result = []
    for enrollment in enrollments:
        history = db.query(StudentEnrollmentClassHistory).filter_by(enrollment_id=enrollment.id).order_by(StudentEnrollmentClassHistory.effective_from.asc(), StudentEnrollmentClassHistory.id.asc()).all()
        history_items = []
        for index, row in enumerate(history):
            next_start = history[index + 1].effective_from if index + 1 < len(history) else None
            history_items.append({
                "id": row.id, "class_name": row.class_name,
                "effective_from": row.effective_from,
                "effective_to": row.effective_to or next_start or enrollment.effective_to,
                "changed_by": row.changed_by, "changed_at": row.changed_at,
                "source": row.source,
            })
        result.append({
            "id": enrollment.id, "academic_year_id": enrollment.academic_year_id,
            "jenjang_id": enrollment.jenjang_id, "academic_class_id": enrollment.academic_class_id,
            "class_name": enrollment.class_name, "effective_from": enrollment.effective_from,
            "effective_to": enrollment.effective_to, "active": enrollment.class_assigned and enrollment.effective_to is None,
            "class_history": history_items,
        })
    return result


@router.post("/student/{student_master_id}", status_code=201)
def create_student_enrollment(
    student_master_id: str,
    body: EnrollmentInput,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("manage_enrollment")),
):
    student = db.get(StudentMaster, student_master_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student master not found")
    row = create_enrollment_for_student(db, student, body, user.username)
    return {"id": row.id, "academic_year_id": row.academic_year_id, "academic_class_id": row.academic_class_id, "class_name": row.class_name, "effective_from": row.effective_from, "active": row.class_assigned}


@router.post("/{enrollment_id}/transfer")
def transfer_student_enrollment(
    enrollment_id: int,
    body: EnrollmentTransferRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("transfer_enrollment")),
):
    enrollment = db.get(StudentEnrollment, enrollment_id)
    if enrollment is None:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    row = transfer_enrollment(db, enrollment, body, user.username)
    return {"id": row.id, "class_name": row.class_name, "academic_class_id": row.academic_class_id, "effective_from": row.effective_from, "effective_to": row.effective_to, "active": row.class_assigned}


@router.post("/{enrollment_id}/end")
def end_student_enrollment(
    enrollment_id: int,
    body: EnrollmentEndRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("end_enrollment")),
):
    enrollment = db.get(StudentEnrollment, enrollment_id)
    if enrollment is None:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    row = end_enrollment(db, enrollment, body, user.username)
    return {"id": row.id, "effective_to": row.effective_to, "active": row.class_assigned}


class AcademicMasterPreviewRequest(BaseModel):
    source_owner: str = Field(min_length=2, max_length=255)
    academic_years: list[AcademicYearMasterProposal] = Field(default_factory=list)
    jenjangs: list[JenjangMasterProposal] = Field(default_factory=list)
    programs: list[ProgramMasterProposal] = Field(default_factory=list)
    grades: list[GradeMasterProposal] = Field(default_factory=list)
    classes: list[ClassMasterProposal] = Field(default_factory=list)


@router.post("/academic-master-preview")
def preview_academic_masters(
    body: AcademicMasterPreviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("import_student_roster")),
):
    return create_academic_master_preview(
        db, body.model_dump(), body.source_owner.strip(), user.username
    )


@router.post("/roster-preview")
async def preview_academic_roster(
    file: UploadFile = File(...),
    source_owner: str = Form(..., min_length=2),
    date_received: date = Form(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("import_student_roster")),
):
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Academic roster must be an .xlsx workbook")
    try:
        batch = create_roster_preview(
            db, await file.read(), file.filename or "roster.xlsx",
            source_owner.strip(), date_received, user.username, file.content_type,
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "preview_id": batch.id, "checksum": batch.checksum, "status": batch.status,
        "preview_checksum": roster_preview_checksum(batch.rows),
        "summary": batch.summary, "rows": batch.rows,
    }


@router.get("/roster-template")
def download_academic_roster_template(
    _user: User = Depends(require_capability("import_student_roster")),
):
    return Response(
        content=roster_template(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="operatoros-student-roster.xlsx"'},
    )


@router.post("/roster-commit")
def commit_academic_roster(
    body: AcademicRosterCommitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("commit_student_roster")),
):
    return commit_roster_preview(
        db, body.preview_id, body.selected_row_ids, body.confirmation, user.username,
        body.preview_checksum,
    )


@router.post("/mapping-preview")
def preview_academic_mappings(
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("import_student_roster")),
):
    """Return reviewed academic mappings without mutating students or enrollments."""
    return build_academic_mapping_preview(db)


@router.post("/populate/preview")
def preview_enrollment_population(
    body: EnrollmentPopulationPreviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("import_student_roster")),
):
    batch = create_enrollment_preview(
        db, body.academic_year_id, body.effective_start_date,
        body.legacy_student_ids, user.username,
    )
    return {
        "preview_id": batch.id,
        "snapshot_checksum": batch.snapshot_checksum,
        "summary": enrollment_summary(batch.rows),
        "rows": batch.rows,
    }


@router.post("/populate/commit")
def commit_enrollment_population(
    body: EnrollmentPopulationCommitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("commit_student_roster")),
):
    return commit_enrollment_preview(
        db, body.preview_id, body.selected_legacy_student_ids,
        body.confirmation, user.username,
    )
