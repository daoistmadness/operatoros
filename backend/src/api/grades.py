from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from core.database import get_db
from models.academic_year import AcademicYear
from models.assessment_component import AssessmentComponent
from models.jenjang import Jenjang
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.student_subject_grade import StudentSubjectGrade
from models.subject import Subject


router = APIRouter()


class GradeLineItem(BaseModel):
    subject_id: int
    component_id: int
    score: float | None = Field(default=None, ge=0.0, le=100.0)


class GradeGridSaveRequest(BaseModel):
    enrollment_id: int
    grades: list[GradeLineItem] = Field(min_length=1)


class EnrollmentBulkRequest(BaseModel):
    academic_year_id: int = Field(gt=0)
    jenjang_id: int = Field(gt=0)
    class_name: str | None = Field(default=None, max_length=120)
    student_ids: list[int] = Field(min_length=1)


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
    return {
        "enrollment_id": enrollment.id,
        "student_id": student.id,
        "student_name": student.name,
        "jenjang": student.jenjang,
        "student_class_name": student.class_name,
        "academic_year_id": enrollment.academic_year_id,
        "jenjang_id": enrollment.jenjang_id,
        "class_name": enrollment.class_name,
        "class_assigned": enrollment.class_assigned,
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
    enrolled_student_ids = (
        select(StudentEnrollment.student_id)
        .filter(StudentEnrollment.academic_year_id == academic_year_id)
    )
    query = (
        db.query(Student)
        .filter(~Student.id.in_(enrolled_student_ids))
    )
    if source_class:
        query = query.filter(Student.class_name == source_class)

    students = query.order_by(Student.name.asc(), Student.id.asc()).all()
    return [_serialize_student(student) for student in students]


@router.get("/enrollment/source-classes")
def get_enrollment_source_classes(
    academic_year_id: int = Query(..., gt=0),
    jenjang_id: int = Query(..., gt=0),
    db: Session = Depends(get_db),
):
    _require_academic_context(db, academic_year_id, jenjang_id)
    enrolled_student_ids = (
        select(StudentEnrollment.student_id)
        .filter(StudentEnrollment.academic_year_id == academic_year_id)
    )
    rows = (
        db.query(Student.class_name)
        .filter(
            ~Student.id.in_(enrolled_student_ids),
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
        query = query.filter(StudentEnrollment.class_name == class_name)

    rows = query.order_by(StudentEnrollment.class_name.asc(), Student.name.asc(), Student.id.asc()).all()
    return [_serialize_enrollment(enrollment, student) for enrollment, student in rows]


@router.post("/enrollment/bulk")
def bulk_enroll_students(body: EnrollmentBulkRequest, db: Session = Depends(get_db)):
    try:
        _require_academic_context(db, body.academic_year_id, body.jenjang_id)
        normalized_student_ids = list(dict.fromkeys(body.student_ids))
        existing_students = {
            student_id
            for (student_id,) in db.query(Student.id).filter(Student.id.in_(normalized_student_ids)).all()
        }
        missing_student_ids = sorted(set(normalized_student_ids) - existing_students)
        if missing_student_ids:
            raise HTTPException(
                status_code=404,
                detail=f"Student not found for id(s): {', '.join(str(value) for value in missing_student_ids)}",
            )

        existing_enrollment_student_ids = {
            student_id
            for (student_id,) in (
                db.query(StudentEnrollment.student_id)
                .filter(
                    StudentEnrollment.academic_year_id == body.academic_year_id,
                    StudentEnrollment.student_id.in_(normalized_student_ids),
                )
                .all()
            )
        }

        class_name = body.class_name.strip() if body.class_name else None
        created_rows: list[StudentEnrollment] = []
        for student_id in normalized_student_ids:
            if student_id in existing_enrollment_student_ids:
                continue
            enrollment = StudentEnrollment(
                student_id=student_id,
                academic_year_id=body.academic_year_id,
                jenjang_id=body.jenjang_id,
                class_name=class_name,
                class_assigned=class_name is not None,
            )
            db.add(enrollment)
            created_rows.append(enrollment)

        db.commit()
        for row in created_rows:
            db.refresh(row)

        enrollments = get_enrollments(
            academic_year_id=body.academic_year_id,
            jenjang_id=body.jenjang_id,
            class_name=class_name,
            db=db,
        )
        return {
            "status": "success",
            "created": len(created_rows),
            "skipped_existing": len(existing_enrollment_student_ids),
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
