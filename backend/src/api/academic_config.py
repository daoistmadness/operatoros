from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from api.error_responses import raise_internal_error
from core.database import get_db
from models.academic_config import AcademicTermConfig, KkmThreshold
from services.academic_config import (
    effective_term_rows,
    find_duplicate_kkm,
    get_academic_year_or_404,
    resolve_effective_kkm,
    serialize_kkm_threshold,
    serialize_term_config,
    validate_kkm_references,
    validate_term_payload,
)

router = APIRouter()

AssessmentType = Literal["sumatif", "formatif", "overall"]


class KkmThresholdRequest(BaseModel):
    academic_year_id: int = Field(gt=0)
    jenjang_id: int | None = Field(default=None, gt=0)
    subject_id: int | None = Field(default=None, gt=0)
    assessment_type: AssessmentType
    threshold: float = Field(ge=0.0, le=100.0)


class KkmThresholdUpdateRequest(BaseModel):
    academic_year_id: int | None = Field(default=None, gt=0)
    jenjang_id: int | None = Field(default=None, gt=0)
    subject_id: int | None = Field(default=None, gt=0)
    assessment_type: AssessmentType | None = None
    threshold: float | None = Field(default=None, ge=0.0, le=100.0)


class AcademicTermRequest(BaseModel):
    academic_year_id: int = Field(gt=0)
    term_number: int = Field(ge=1, le=4)
    label: str = Field(min_length=1, max_length=80)
    start_date: date
    end_date: date


class AcademicTermUpdateRequest(BaseModel):
    academic_year_id: int | None = Field(default=None, gt=0)
    term_number: int | None = Field(default=None, ge=1, le=4)
    label: str | None = Field(default=None, min_length=1, max_length=80)
    start_date: date | None = None
    end_date: date | None = None


@router.get("/kkm-thresholds")
def list_kkm_thresholds(
    academic_year_id: int | None = Query(None),
    jenjang_id: int | None = Query(None),
    subject_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(KkmThreshold)
    if academic_year_id is not None:
        query = query.filter(KkmThreshold.academic_year_id == academic_year_id)
    if jenjang_id is not None:
        query = query.filter(KkmThreshold.jenjang_id == jenjang_id)
    if subject_id is not None:
        query = query.filter(KkmThreshold.subject_id == subject_id)

    rows = query.order_by(
        KkmThreshold.academic_year_id.asc(),
        KkmThreshold.jenjang_id.asc(),
        KkmThreshold.subject_id.asc(),
        KkmThreshold.assessment_type.asc(),
    ).all()
    return [serialize_kkm_threshold(row) for row in rows]


@router.post("/kkm-thresholds")
def create_kkm_threshold(body: KkmThresholdRequest, db: Session = Depends(get_db)):
    validate_kkm_references(db, body.academic_year_id, body.jenjang_id, body.subject_id)
    if find_duplicate_kkm(
        db,
        body.academic_year_id,
        body.jenjang_id,
        body.subject_id,
        body.assessment_type,
    ):
        raise HTTPException(status_code=409, detail="KKM threshold already exists for this context")

    try:
        row = KkmThreshold(**body.model_dump())
        db.add(row)
        db.commit()
        db.refresh(row)
        return serialize_kkm_threshold(row)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="KKM threshold conflict detected") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise_internal_error("The KKM threshold could not be saved. Retry or contact the system administrator.", exc)


@router.put("/kkm-thresholds/{threshold_id}")
def update_kkm_threshold(threshold_id: int, body: KkmThresholdUpdateRequest, db: Session = Depends(get_db)):
    row = db.query(KkmThreshold).filter(KkmThreshold.id == threshold_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="KKM threshold not found")

    updates = body.model_dump(exclude_unset=True)
    academic_year_id = updates.get("academic_year_id", row.academic_year_id)
    jenjang_id = updates.get("jenjang_id", row.jenjang_id)
    subject_id = updates.get("subject_id", row.subject_id)
    assessment_type = updates.get("assessment_type", row.assessment_type)
    validate_kkm_references(db, academic_year_id, jenjang_id, subject_id)
    duplicate = find_duplicate_kkm(db, academic_year_id, jenjang_id, subject_id, assessment_type, exclude_id=row.id)
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="KKM threshold already exists for this context")

    try:
        for key, value in updates.items():
            setattr(row, key, value)
        db.commit()
        db.refresh(row)
        return serialize_kkm_threshold(row)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="KKM threshold conflict detected") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise_internal_error("The KKM threshold could not be updated. Retry or contact the system administrator.", exc)


@router.delete("/kkm-thresholds/{threshold_id}")
def delete_kkm_threshold(threshold_id: int, db: Session = Depends(get_db)):
    row = db.query(KkmThreshold).filter(KkmThreshold.id == threshold_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="KKM threshold not found")
    try:
        db.delete(row)
        db.commit()
        return {"status": "success", "deleted": 1, "id": threshold_id}
    except SQLAlchemyError as exc:
        db.rollback()
        raise_internal_error("The KKM threshold could not be deleted. Retry or contact the system administrator.", exc)


@router.get("/kkm-effective")
def get_effective_kkm(
    academic_year_id: int = Query(...),
    jenjang_id: int | None = Query(None),
    subject_id: int | None = Query(None),
    assessment_type: AssessmentType = Query(...),
    db: Session = Depends(get_db),
):
    get_academic_year_or_404(db, academic_year_id)
    effective = resolve_effective_kkm(db, academic_year_id, jenjang_id, subject_id, assessment_type)
    return {
        "academic_year_id": academic_year_id,
        "jenjang_id": jenjang_id,
        "subject_id": subject_id,
        "assessment_type": assessment_type,
        "threshold": effective.threshold,
        "threshold_source": effective.source,
        "threshold_id": effective.threshold_id,
    }


@router.get("/terms")
def list_term_configs(academic_year_id: int | None = Query(None), db: Session = Depends(get_db)):
    query = db.query(AcademicTermConfig)
    if academic_year_id is not None:
        query = query.filter(AcademicTermConfig.academic_year_id == academic_year_id)
    rows = query.order_by(AcademicTermConfig.academic_year_id.asc(), AcademicTermConfig.term_number.asc()).all()
    return [serialize_term_config(row) for row in rows]


@router.post("/terms")
def create_term_config(body: AcademicTermRequest, db: Session = Depends(get_db)):
    label = body.label.strip()
    validate_term_payload(db, body.academic_year_id, body.term_number, body.start_date, body.end_date)
    try:
        row = AcademicTermConfig(
            academic_year_id=body.academic_year_id,
            term_number=body.term_number,
            label=label,
            start_date=body.start_date,
            end_date=body.end_date,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return serialize_term_config(row)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Term config already exists for this academic year and term") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise_internal_error("The term configuration could not be saved. Retry or contact the system administrator.", exc)


@router.put("/terms/{term_id}")
def update_term_config(term_id: int, body: AcademicTermUpdateRequest, db: Session = Depends(get_db)):
    row = db.query(AcademicTermConfig).filter(AcademicTermConfig.id == term_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Term config not found")

    updates = body.model_dump(exclude_unset=True)
    academic_year_id = updates.get("academic_year_id", row.academic_year_id)
    term_number = updates.get("term_number", row.term_number)
    start_date = updates.get("start_date", row.start_date)
    end_date = updates.get("end_date", row.end_date)
    validate_term_payload(db, academic_year_id, term_number, start_date, end_date, exclude_id=row.id)

    try:
        for key, value in updates.items():
            setattr(row, key, value.strip() if key == "label" and isinstance(value, str) else value)
        db.commit()
        db.refresh(row)
        return serialize_term_config(row)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Term config conflict detected") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise_internal_error("The term configuration could not be updated. Retry or contact the system administrator.", exc)


@router.delete("/terms/{term_id}")
def delete_term_config(term_id: int, db: Session = Depends(get_db)):
    row = db.query(AcademicTermConfig).filter(AcademicTermConfig.id == term_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Term config not found")
    try:
        db.delete(row)
        db.commit()
        return {"status": "success", "deleted": 1, "id": term_id}
    except SQLAlchemyError as exc:
        db.rollback()
        raise_internal_error("The term configuration could not be deleted. Retry or contact the system administrator.", exc)


@router.get("/terms/effective")
def get_effective_terms(academic_year_id: int = Query(...), db: Session = Depends(get_db)):
    return effective_term_rows(db, academic_year_id)
