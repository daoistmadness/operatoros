from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from security.dependencies import get_current_user, require_role
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from core.database import get_db
from models.user import User
from models.academic_year import AcademicYear
from models.assessment_component import AssessmentComponent
from models.jenjang import Jenjang
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.student_subject_grade import StudentSubjectGrade
from models.subject import Subject
from models.academic_master import AcademicClass
from models.student_master import StudentMaster, StudentDeviceIdentity


router = APIRouter(dependencies=[Depends(get_current_user), Depends(require_role("admin"))])


class GradeLineItem(BaseModel):
    subject_id: int
    component_id: int
    score: float | None = Field(default=None, ge=0.0, le=100.0)


class GradeGridSaveRequest(BaseModel):
    enrollment_id: int
    grades: list[GradeLineItem] = Field(min_length=1)


class EnrollmentBulkRequest(BaseModel):
    academic_year_id: int = Field(gt=0)
    academic_class_id: int = Field(gt=0)
    student_master_ids: list[str] = Field(min_length=1)


class AcademicYearCreateRequest(BaseModel):
    label: str = Field(min_length=1, max_length=32)
    start_date: date
    end_date: date
    status: Literal["upcoming", "active", "closed"] = "active"
    is_default: bool = False


class SubjectCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    jenjang_id: int = Field(gt=0)
    supports_sumatif: bool = True
    supports_formatif: bool = True


def _serialize_grade(row: StudentSubjectGrade) -> dict:
    return {
        "id": row.id,
        "enrollment_id": row.enrollment_id,
        "subject_id": row.subject_id,
        "component_id": row.component_id,
        "score": row.score,
    }


def _verify_grade_references(db: Session, body: GradeGridSaveRequest) -> StudentEnrollment:
    enrollment = db.query(StudentEnrollment).filter(StudentEnrollment.id == body.enrollment_id).first()
    if enrollment is None:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    subject_ids = {item.subject_id for item in body.grades}
    component_ids = {item.component_id for item in body.grades}

    existing_subject_ids = {
        subject_id
        for (subject_id,) in db.query(Subject.id).filter(Subject.id.in_(subject_ids)).all()
    }
    missing_subject_ids = sorted(subject_ids - existing_subject_ids)
    if missing_subject_ids:
        raise HTTPException(
            status_code=404,
            detail=f"Subject not found for id(s): {', '.join(str(value) for value in missing_subject_ids)}",
        )

    components = (
        db.query(AssessmentComponent)
        .filter(AssessmentComponent.id.in_(component_ids))
        .all()
    )
    components_by_id = {component.id: component for component in components}
    missing_component_ids = sorted(component_ids - set(components_by_id))
    if missing_component_ids:
        raise HTTPException(
            status_code=404,
            detail=f"Assessment component not found for id(s): {', '.join(str(value) for value in missing_component_ids)}",
        )

    for item in body.grades:
        component = components_by_id[item.component_id]
        if component.subject_id is not None and component.subject_id != item.subject_id:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Component {item.component_id} is scoped to subject "
                    f"{component.subject_id}, not subject {item.subject_id}"
                ),
            )

    duplicate_keys = set()
    seen_keys = set()
    for item in body.grades:
        key = (item.subject_id, item.component_id)
        if key in seen_keys:
            duplicate_keys.add(key)
        seen_keys.add(key)
    if duplicate_keys:
        raise HTTPException(status_code=400, detail="Duplicate subject_id and component_id pair in payload")

    return enrollment


def _serialize_student(row: Student) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "jenjang": row.jenjang,
        "class_name": row.class_name,
    }


def _serialize_enrollment(enrollment: StudentEnrollment, student: Student) -> dict:
    resolved_class_name = enrollment.academic_class.class_name if enrollment.academic_class_id and enrollment.academic_class else enrollment.class_name
    return {
        "enrollment_id": enrollment.id,
        "student_id": student.id,
        "student_name": student.name,
        "jenjang": student.jenjang,
        "student_class_name": student.class_name,
        "academic_year_id": enrollment.academic_year_id,
        "jenjang_id": enrollment.jenjang_id,
        "class_name": resolved_class_name,
        "class_assigned": enrollment.class_assigned,
        "student_master_id": enrollment.student_master_id,
    }


def _serialize_academic_year(row: AcademicYear) -> dict:
    return {
        "id": row.id,
        "label": row.label,
        "start_date": row.start_date.isoformat() if row.start_date else None,
        "end_date": row.end_date.isoformat() if row.end_date else None,
        "status": row.status,
        "is_default": row.is_default,
    }


def _serialize_subject(row: Subject) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "jenjang_id": row.jenjang_id,
        "supports_sumatif": row.supports_sumatif,
        "supports_formatif": row.supports_formatif,
    }


def _require_academic_context(db: Session, academic_year_id: int, jenjang_id: int) -> None:
    academic_year = db.query(AcademicYear.id).filter(AcademicYear.id == academic_year_id).first()
    if academic_year is None:
        raise HTTPException(status_code=404, detail="Academic year not found")

    jenjang = db.query(Jenjang.id).filter(Jenjang.id == jenjang_id).first()
    if jenjang is None:
        raise HTTPException(status_code=404, detail="Jenjang not found")


@router.get("/ledger")
def get_grade_ledger(
    academic_year_id: int = Query(...),
    jenjang_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    query = (
        db.query(StudentEnrollment, Student, Jenjang)
        .join(Student, Student.id == StudentEnrollment.student_id)
        .join(Jenjang, Jenjang.id == StudentEnrollment.jenjang_id)
        .filter(StudentEnrollment.academic_year_id == academic_year_id)
    )
    if jenjang_id is not None:
        query = query.filter(StudentEnrollment.jenjang_id == jenjang_id)

    rows = query.order_by(Student.name.asc()).all()
    enrollment_ids = [enrollment.id for enrollment, _, _ in rows]
    grade_rows = (
        db.query(StudentSubjectGrade)
        .filter(StudentSubjectGrade.enrollment_id.in_(enrollment_ids))
        .all()
        if enrollment_ids
        else []
    )
    grades_by_enrollment: dict[int, list[dict]] = {}
    for grade in grade_rows:
        grades_by_enrollment.setdefault(grade.enrollment_id, []).append(_serialize_grade(grade))

    return [
        {
            "enrollment_id": enrollment.id,
            "student_id": student.id,
            "student_name": student.name,
            "academic_year_id": enrollment.academic_year_id,
            "jenjang_id": enrollment.jenjang_id,
            "jenjang": jenjang.name,
            "class_name": enrollment.class_name,
            "class_assigned": enrollment.class_assigned,
            "grades": grades_by_enrollment.get(enrollment.id, []),
        }
        for enrollment, student, jenjang in rows
    ]


@router.get("/enrollment/candidates")
def get_enrollment_candidates(
    academic_year_id: int = Query(..., gt=0),
    jenjang_id: int = Query(..., gt=0),
    source_class: str | None = None,
    db: Session = Depends(get_db),
):
    _require_academic_context(db, academic_year_id, jenjang_id)
    enrolled_master_ids = (
        select(StudentEnrollment.student_master_id)
        .filter(
            StudentEnrollment.academic_year_id == academic_year_id,
            StudentEnrollment.student_master_id.isnot(None)
        )
    )
    query = (
        db.query(StudentMaster, Student)
        .join(StudentDeviceIdentity, StudentDeviceIdentity.student_master_id == StudentMaster.id)
        .join(Student, Student.id == StudentDeviceIdentity.legacy_student_id)
        .filter(StudentDeviceIdentity.is_active.is_(True))
        .filter(~StudentMaster.id.in_(enrolled_master_ids))
    )
    if source_class:
        query = query.filter(Student.class_name == source_class)

    results = query.order_by(StudentMaster.full_name.asc(), StudentMaster.id.asc()).all()
    return [
        {
            "id": master.id,
            "student_id": student.id,
            "name": master.full_name,
            "jenjang": student.jenjang,
            "class_name": student.class_name,
        }
        for master, student in results
    ]


@router.get("/enrollment/source-classes")
def get_enrollment_source_classes(
    academic_year_id: int = Query(..., gt=0),
    jenjang_id: int = Query(..., gt=0),
    db: Session = Depends(get_db),
):
    _require_academic_context(db, academic_year_id, jenjang_id)
    enrolled_master_ids = (
        select(StudentEnrollment.student_master_id)
        .filter(
            StudentEnrollment.academic_year_id == academic_year_id,
            StudentEnrollment.student_master_id.isnot(None)
        )
    )
    rows = (
        db.query(Student.class_name)
        .join(StudentDeviceIdentity, StudentDeviceIdentity.legacy_student_id == Student.id)
        .filter(
            StudentDeviceIdentity.is_active.is_(True),
            ~StudentDeviceIdentity.student_master_id.in_(enrolled_master_ids),
            Student.class_name.isnot(None),
            Student.class_name != "",
        )
        .distinct()
        .order_by(Student.class_name.asc())
        .all()
    )
    return [class_name for (class_name,) in rows]


@router.get("/enrollment")
def get_enrollments(
    academic_year_id: int = Query(..., gt=0),
    jenjang_id: int = Query(..., gt=0),
    class_name: str | None = None,
    db: Session = Depends(get_db),
):
    _require_academic_context(db, academic_year_id, jenjang_id)
    query = (
        db.query(StudentEnrollment, Student)
        .join(Student, Student.id == StudentEnrollment.student_id)
        .filter(
            StudentEnrollment.academic_year_id == academic_year_id,
            StudentEnrollment.jenjang_id == jenjang_id,
        )
    )
    if class_name:
        query = query.outerjoin(AcademicClass, AcademicClass.id == StudentEnrollment.academic_class_id)
        query = query.filter(
            func.coalesce(AcademicClass.class_name, StudentEnrollment.class_name) == class_name
        )

    rows = query.order_by(StudentEnrollment.class_name.asc(), Student.name.asc(), Student.id.asc()).all()
    return [_serialize_enrollment(enrollment, student) for enrollment, student in rows]


@router.post("/enrollment/bulk")
def bulk_enroll_students(body: EnrollmentBulkRequest, db: Session = Depends(get_db)):
    try:
        academic_class = db.query(AcademicClass).filter(AcademicClass.id == body.academic_class_id).first()
        if not academic_class:
            raise HTTPException(status_code=404, detail="Academic class not found")
        if not academic_class.active:
            raise HTTPException(status_code=400, detail="Academic class is not active")
        if academic_class.academic_year_id != body.academic_year_id:
            raise HTTPException(status_code=400, detail="Academic class does not belong to the selected academic year")

        academic_year = db.query(AcademicYear).filter(AcademicYear.id == body.academic_year_id).first()
        if not academic_year:
            raise HTTPException(status_code=404, detail="Academic year not found")

        from models.academic_master import AcademicGrade
        grade = db.query(AcademicGrade).filter(AcademicGrade.id == academic_class.grade_id).first()
        if not grade:
            raise HTTPException(status_code=400, detail="Grade config not found for this class")
        jenjang_id = grade.jenjang_id

        _require_academic_context(db, body.academic_year_id, jenjang_id)

        normalized_master_ids = list(dict.fromkeys(body.student_master_ids))
        existing_masters = {
            master.id: master
            for master in db.query(StudentMaster).filter(StudentMaster.id.in_(normalized_master_ids)).all()
        }
        missing_master_ids = sorted(set(normalized_master_ids) - set(existing_masters.keys()))
        if missing_master_ids:
            raise HTTPException(
                status_code=404,
                detail=f"Student master not found for id(s): {', '.join(missing_master_ids)}",
            )

        device_mappings = (
            db.query(StudentDeviceIdentity)
            .filter(
                StudentDeviceIdentity.student_master_id.in_(normalized_master_ids),
                StudentDeviceIdentity.is_active.is_(True)
            )
            .all()
        )
        master_to_legacy = {
            m.student_master_id: m.legacy_student_id
            for m in device_mappings if m.legacy_student_id is not None
        }

        for master_id in normalized_master_ids:
            if master_id not in master_to_legacy:
                raise HTTPException(
                    status_code=400,
                    detail=f"No active legacy student mapping found for master student {master_id}"
                )

        existing_enrollments_by_master = {
            enrollment.student_master_id
            for enrollment in db.query(StudentEnrollment).filter(
                StudentEnrollment.academic_year_id == body.academic_year_id,
                StudentEnrollment.student_master_id.in_(normalized_master_ids)
            ).all()
        }

        to_enroll_master_ids = [
            m_id for m_id in normalized_master_ids if m_id not in existing_enrollments_by_master
        ]
        skipped_count = len(existing_enrollments_by_master)

        created_rows: list[StudentEnrollment] = []
        for master_id in to_enroll_master_ids:
            legacy_id = master_to_legacy[master_id]
            enrollment = StudentEnrollment(
                student_id=legacy_id,
                student_master_id=master_id,
                academic_year_id=body.academic_year_id,
                jenjang_id=jenjang_id,
                academic_class_id=academic_class.id,
                class_name=academic_class.class_name,
                class_assigned=True,
                effective_from=academic_year.start_date
            )
            db.add(enrollment)
            created_rows.append(enrollment)

        db.commit()
        for row in created_rows:
            db.refresh(row)

        enrollments = get_enrollments(
            academic_year_id=body.academic_year_id,
            jenjang_id=jenjang_id,
            class_name=academic_class.class_name,
            db=db,
        )
        return {
            "status": "success",
            "created": len(created_rows),
            "skipped_existing": skipped_count,
            "enrollment_ids": [row.id for row in created_rows],
            "enrollments": enrollments,
        }
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Enrollment conflict detected") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error during enrollment: {exc}") from exc


@router.delete("/enrollment/{enrollment_id}")
def delete_enrollment(enrollment_id: int, db: Session = Depends(get_db)):
    enrollment = db.query(StudentEnrollment).filter(StudentEnrollment.id == enrollment_id).first()
    if enrollment is None:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    student_id = enrollment.student_id
    try:
        db.delete(enrollment)
        db.commit()
        return {"status": "success", "deleted": 1, "enrollment_id": enrollment_id, "student_id": student_id}
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Enrollment cannot be deleted while referenced") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error during enrollment delete: {exc}") from exc


@router.post("/save")
def save_grade_ledger(body: GradeGridSaveRequest, db: Session = Depends(get_db)):
    try:
        _verify_grade_references(db, body)
        keys = {(item.subject_id, item.component_id) for item in body.grades}
        existing_rows = (
            db.query(StudentSubjectGrade)
            .filter(
                StudentSubjectGrade.enrollment_id == body.enrollment_id,
                StudentSubjectGrade.subject_id.in_({subject_id for subject_id, _ in keys}),
                StudentSubjectGrade.component_id.in_({component_id for _, component_id in keys}),
            )
            .all()
        )
        existing_by_key = {
            (row.subject_id, row.component_id): row
            for row in existing_rows
            if (row.subject_id, row.component_id) in keys
        }

        inserted = 0
        updated = 0
        saved_rows: list[StudentSubjectGrade] = []
        for item in body.grades:
            key = (item.subject_id, item.component_id)
            grade = existing_by_key.get(key)
            if grade is None:
                grade = StudentSubjectGrade(
                    enrollment_id=body.enrollment_id,
                    subject_id=item.subject_id,
                    component_id=item.component_id,
                )
                db.add(grade)
                inserted += 1
            else:
                updated += 1

            grade.score = item.score
            saved_rows.append(grade)

        db.commit()
        for row in saved_rows:
            db.refresh(row)

        return {
            "status": "success",
            "inserted": inserted,
            "updated": updated,
            "saved": inserted + updated,
            "grades": [_serialize_grade(row) for row in saved_rows],
        }
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error during grade save: {exc}") from exc


@router.get("/analytics")
def get_grade_analytics(
    academic_year_id: int = Query(...),
    jenjang_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    academic_year = db.query(AcademicYear).filter(AcademicYear.id == academic_year_id).first()
    if academic_year is None:
        raise HTTPException(status_code=404, detail="Academic year not found")

    query = (
        db.query(
            func.count(StudentSubjectGrade.id).label("grade_count"),
            func.avg(StudentSubjectGrade.score).label("average_score"),
        )
        .select_from(StudentEnrollment)
        .join(StudentSubjectGrade, StudentSubjectGrade.enrollment_id == StudentEnrollment.id)
        .filter(StudentEnrollment.academic_year_id == academic_year_id)
    )
    if jenjang_id is not None:
        query = query.filter(StudentEnrollment.jenjang_id == jenjang_id)
    summary = query.one()

    cohort_query = (
        db.query(
            Jenjang.id.label("jenjang_id"),
            Jenjang.name.label("jenjang"),
            func.count(StudentSubjectGrade.id).label("grade_count"),
            func.avg(StudentSubjectGrade.score).label("average_score"),
        )
        .select_from(StudentEnrollment)
        .join(Jenjang, Jenjang.id == StudentEnrollment.jenjang_id)
        .join(StudentSubjectGrade, StudentSubjectGrade.enrollment_id == StudentEnrollment.id)
        .filter(StudentEnrollment.academic_year_id == academic_year_id)
        .group_by(Jenjang.id, Jenjang.name)
        .order_by(Jenjang.name.asc())
    )
    if jenjang_id is not None:
        cohort_query = cohort_query.filter(StudentEnrollment.jenjang_id == jenjang_id)

    return {
        "academic_year_id": academic_year.id,
        "academic_year": academic_year.label,
        "jenjang_id": jenjang_id,
        "grade_count": int(summary.grade_count or 0),
        "average_score": round(summary.average_score, 2) if summary.average_score is not None else None,
        "cohorts": [
            {
                "jenjang_id": row.jenjang_id,
                "jenjang": row.jenjang,
                "grade_count": int(row.grade_count or 0),
                "average_score": round(row.average_score, 2) if row.average_score is not None else None,
            }
            for row in cohort_query.all()
        ],
    }


@router.get("/academic-years")
def get_academic_years(db: Session = Depends(get_db)):
    years = (
        db.query(AcademicYear)
        .order_by(AcademicYear.start_date.asc(), AcademicYear.id.asc())
        .all()
    )
    return [_serialize_academic_year(year) for year in years]


@router.post("/academic-years")
def create_academic_year(body: AcademicYearCreateRequest, db: Session = Depends(get_db)):
    label = body.label.strip()
    if not label:
        raise HTTPException(status_code=400, detail="Academic year label is required")
    if body.end_date < body.start_date:
        raise HTTPException(status_code=400, detail="Academic year end_date must be on or after start_date")

    existing = db.query(AcademicYear.id).filter(AcademicYear.label == label).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Academic year label already exists")

    try:
        if body.is_default:
            db.query(AcademicYear).filter(AcademicYear.is_default.is_(True)).update(
                {AcademicYear.is_default: False},
                synchronize_session=False,
            )

        academic_year = AcademicYear(
            label=label,
            start_date=body.start_date,
            end_date=body.end_date,
            status=body.status,
            is_default=body.is_default,
        )
        db.add(academic_year)
        db.commit()
        db.refresh(academic_year)
        return _serialize_academic_year(academic_year)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Academic year conflict detected") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error during academic year create: {exc}") from exc


@router.get("/subjects")
def get_subjects(jenjang_id: int = Query(...), db: Session = Depends(get_db)):
    subjects = (
        db.query(Subject)
        .filter(Subject.jenjang_id == jenjang_id)
        .order_by(Subject.name.asc(), Subject.id.asc())
        .all()
    )
    return [_serialize_subject(subject) for subject in subjects]


@router.post("/subjects")
def create_subject(body: SubjectCreateRequest, db: Session = Depends(get_db)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Subject name is required")

    jenjang = db.query(Jenjang.id).filter(Jenjang.id == body.jenjang_id).first()
    if jenjang is None:
        raise HTTPException(status_code=404, detail="Jenjang not found")

    existing = (
        db.query(Subject.id)
        .filter(Subject.name == name, Subject.jenjang_id == body.jenjang_id)
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="Subject already exists for this jenjang")

    try:
        subject = Subject(
            name=name,
            jenjang_id=body.jenjang_id,
            supports_sumatif=body.supports_sumatif,
            supports_formatif=body.supports_formatif,
        )
        db.add(subject)
        db.commit()
        db.refresh(subject)
        return _serialize_subject(subject)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Subject conflict detected") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error during subject create: {exc}") from exc


@router.get("/jenjangs")
def get_jenjangs(db: Session = Depends(get_db)):
    jenjangs = db.query(Jenjang).order_by(Jenjang.name.asc(), Jenjang.id.asc()).all()
    return [{"id": row.id, "name": row.name} for row in jenjangs]


@router.get("/components")
def get_components(db: Session = Depends(get_db)):
    components = (
        db.query(AssessmentComponent)
        .order_by(AssessmentComponent.name.asc(), AssessmentComponent.id.asc())
        .all()
    )
    return [
        {
            "id": c.id,
            "name": c.name,
            "assessment_type": c.assessment_type,
            "subject_id": c.subject_id,
        }
        for c in components
    ]
