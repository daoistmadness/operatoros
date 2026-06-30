from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from core.database import get_db
from models.academic_intervention import AcademicIntervention
from models.academic_year import AcademicYear
from models.jenjang import Jenjang
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.subject import Subject

router = APIRouter()

AssessmentType = Literal["sumatif", "formatif", "overall"]
InterventionStatus = Literal["open", "in_progress", "monitoring", "resolved", "closed"]
InterventionPriority = Literal["low", "medium", "high", "urgent"]

ACTIVE_STATUSES = ("open", "in_progress", "monitoring")


class AcademicInterventionCreateRequest(BaseModel):
    student_id: int = Field(gt=0)
    enrollment_id: int | None = Field(default=None, gt=0)
    academic_year_id: int = Field(gt=0)
    jenjang_id: int | None = Field(default=None, gt=0)
    subject_id: int = Field(gt=0)
    assessment_type: AssessmentType | None = None
    term: str | None = Field(default=None, max_length=40)
    class_name: str | None = Field(default=None, max_length=80)
    student_name: str = Field(min_length=1, max_length=255)
    subject_name: str = Field(min_length=1, max_length=255)
    effective_threshold: float = Field(ge=0.0, le=100.0)
    threshold_source: str = Field(min_length=1, max_length=80)
    current_average: float | None = Field(default=None, ge=0.0, le=100.0)
    status: InterventionStatus = "open"
    priority: InterventionPriority = "medium"
    owner_name: str | None = Field(default=None, max_length=120)
    planned_action: str | None = None
    notes: str | None = None
    follow_up_date: str | None = None
    outcome: str | None = None


class AcademicInterventionUpdateRequest(BaseModel):
    status: InterventionStatus | None = None
    priority: InterventionPriority | None = None
    owner_name: str | None = Field(default=None, max_length=120)
    planned_action: str | None = None
    notes: str | None = None
    follow_up_date: str | None = None
    outcome: str | None = None


def _parse_date(value: str | None):
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="follow_up_date must use YYYY-MM-DD format") from exc


def _serialize_intervention(row: AcademicIntervention) -> dict:
    return {
        "id": row.id,
        "student_id": row.student_id,
        "enrollment_id": row.enrollment_id,
        "academic_year_id": row.academic_year_id,
        "jenjang_id": row.jenjang_id,
        "subject_id": row.subject_id,
        "assessment_type": row.assessment_type,
        "term": row.term,
        "class_name": row.class_name,
        "student_name": row.student_name,
        "subject_name": row.subject_name,
        "effective_threshold": row.effective_threshold,
        "threshold_source": row.threshold_source,
        "current_average": row.current_average,
        "status": row.status,
        "priority": row.priority,
        "owner_name": row.owner_name,
        "planned_action": row.planned_action,
        "notes": row.notes,
        "follow_up_date": row.follow_up_date.isoformat() if row.follow_up_date else None,
        "outcome": row.outcome,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
    }


def _validate_references(
    db: Session,
    *,
    student_id: int,
    academic_year_id: int,
    subject_id: int,
    jenjang_id: int | None,
    enrollment_id: int | None,
) -> None:
    if db.query(Student).filter(Student.id == student_id).first() is None:
        raise HTTPException(status_code=404, detail="Student not found")
    if db.query(AcademicYear).filter(AcademicYear.id == academic_year_id).first() is None:
        raise HTTPException(status_code=404, detail="Academic year not found")
    if db.query(Subject).filter(Subject.id == subject_id).first() is None:
        raise HTTPException(status_code=404, detail="Subject not found")
    if jenjang_id is not None and db.query(Jenjang).filter(Jenjang.id == jenjang_id).first() is None:
        raise HTTPException(status_code=404, detail="Jenjang not found")
    if enrollment_id is not None:
        enrollment = db.query(StudentEnrollment).filter(StudentEnrollment.id == enrollment_id).first()
        if enrollment is None:
            raise HTTPException(status_code=404, detail="Student enrollment not found")
        if enrollment.student_id != student_id or enrollment.academic_year_id != academic_year_id:
            raise HTTPException(status_code=400, detail="Enrollment does not match student and academic year")


def _same_context_filters(model, student_id: int, academic_year_id: int, subject_id: int, assessment_type: str | None, term: str | None):
    filters = [
        model.student_id == student_id,
        model.academic_year_id == academic_year_id,
        model.subject_id == subject_id,
    ]
    filters.append(model.assessment_type.is_(None) if assessment_type is None else model.assessment_type == assessment_type)
    filters.append(model.term.is_(None) if term is None else model.term == term)
    return filters


def _find_active_duplicate(
    db: Session,
    *,
    student_id: int,
    academic_year_id: int,
    subject_id: int,
    assessment_type: str | None,
    term: str | None,
    exclude_id: int | None = None,
) -> AcademicIntervention | None:
    query = db.query(AcademicIntervention).filter(
        *_same_context_filters(AcademicIntervention, student_id, academic_year_id, subject_id, assessment_type, term),
        AcademicIntervention.status.in_(ACTIVE_STATUSES),
    )
    if exclude_id is not None:
        query = query.filter(AcademicIntervention.id != exclude_id)
    return query.order_by(AcademicIntervention.updated_at.desc(), AcademicIntervention.id.desc()).first()


@router.get("")
def list_interventions(
    academic_year_id: int | None = Query(None),
    jenjang_id: int | None = Query(None),
    class_name: str | None = Query(None),
    student_id: int | None = Query(None),
    subject_id: int | None = Query(None),
    term: str | None = Query(None),
    status: InterventionStatus | None = Query(None),
    priority: InterventionPriority | None = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(AcademicIntervention)
    if academic_year_id is not None:
        query = query.filter(AcademicIntervention.academic_year_id == academic_year_id)
    if jenjang_id is not None:
        query = query.filter(AcademicIntervention.jenjang_id == jenjang_id)
    if class_name:
        query = query.filter(AcademicIntervention.class_name == class_name)
    if student_id is not None:
        query = query.filter(AcademicIntervention.student_id == student_id)
    if subject_id is not None:
        query = query.filter(AcademicIntervention.subject_id == subject_id)
    if term:
        query = query.filter(AcademicIntervention.term == term)
    if status:
        query = query.filter(AcademicIntervention.status == status)
    if priority:
        query = query.filter(AcademicIntervention.priority == priority)

    rows = query.order_by(AcademicIntervention.updated_at.desc(), AcademicIntervention.id.desc()).all()
    return [_serialize_intervention(row) for row in rows]


def _create_intervention(body: AcademicInterventionCreateRequest, db: Session):
    follow_up_date = _parse_date(body.follow_up_date)
    _validate_references(
        db,
        student_id=body.student_id,
        academic_year_id=body.academic_year_id,
        subject_id=body.subject_id,
        jenjang_id=body.jenjang_id,
        enrollment_id=body.enrollment_id,
    )
    duplicate = _find_active_duplicate(
        db,
        student_id=body.student_id,
        academic_year_id=body.academic_year_id,
        subject_id=body.subject_id,
        assessment_type=body.assessment_type,
        term=body.term,
    )
    if duplicate is not None and body.status in ACTIVE_STATUSES:
        raise HTTPException(status_code=409, detail="Active intervention already exists for this context")

    try:
        row = AcademicIntervention(
            **body.model_dump(exclude={"follow_up_date"}),
            follow_up_date=follow_up_date,
            resolved_at=datetime.utcnow() if body.status in ("resolved", "closed") else None,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _serialize_intervention(row)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error during intervention create: {exc}") from exc


@router.post("")
def create_intervention(body: AcademicInterventionCreateRequest, db: Session = Depends(get_db)):
    return _create_intervention(body, db)


@router.post("/from-alert")
def create_intervention_from_alert(body: AcademicInterventionCreateRequest, db: Session = Depends(get_db)):
    return _create_intervention(body, db)


@router.get("/{intervention_id}")
def get_intervention(intervention_id: int, db: Session = Depends(get_db)):
    row = db.query(AcademicIntervention).filter(AcademicIntervention.id == intervention_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Academic intervention not found")
    return _serialize_intervention(row)


@router.patch("/{intervention_id}")
def update_intervention(
    intervention_id: int,
    body: AcademicInterventionUpdateRequest,
    db: Session = Depends(get_db),
):
    row = db.query(AcademicIntervention).filter(AcademicIntervention.id == intervention_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Academic intervention not found")

    updates = body.model_dump(exclude_unset=True)
    if "follow_up_date" in updates:
        updates["follow_up_date"] = _parse_date(updates["follow_up_date"])

    try:
        for key, value in updates.items():
            setattr(row, key, value)
        if updates.get("status") in ("resolved", "closed") and row.resolved_at is None:
            row.resolved_at = datetime.utcnow()
        row.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(row)
        return _serialize_intervention(row)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error during intervention update: {exc}") from exc


@router.delete("/{intervention_id}")
def close_intervention(intervention_id: int, db: Session = Depends(get_db)):
    row = db.query(AcademicIntervention).filter(AcademicIntervention.id == intervention_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Academic intervention not found")

    try:
        row.status = "closed"
        row.resolved_at = row.resolved_at or datetime.utcnow()
        row.updated_at = datetime.utcnow()
        db.commit()
        return {"status": "success", "closed": 1, "id": intervention_id}
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error during intervention close: {exc}") from exc
