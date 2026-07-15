from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from models.student_master import StudentDeviceIdentity, StudentMaster
from models.user import User
from schemas.student_master import (
    DeviceIdentitySummary,
    StudentMasterListResponse,
    StudentMasterSummary,
)
from security.dependencies import get_current_user, require_role
from services.student_normalization import mask_identifier


router = APIRouter(dependencies=[Depends(get_current_user)])


def _student_summary(student: StudentMaster) -> StudentMasterSummary:
    return StudentMasterSummary(
        id=student.id,
        full_name=student.full_name,
        preferred_name=student.preferred_name,
        nipd_masked=mask_identifier(student.nipd),
        nisn_masked=mask_identifier(student.nisn),
        nik_masked=mask_identifier(student.nik),
        gender=student.gender,
        birth_date=student.birth_date,
        religion=student.religion,
        student_status=student.student_status,
        created_at=student.created_at,
        updated_at=student.updated_at,
    )


@router.get("", response_model=StudentMasterListResponse)
def list_student_masters(
    search: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    query = db.query(StudentMaster)
    if search and search.strip():
        pattern = f"%{search.strip().casefold()}%"
        query = query.filter(func.lower(StudentMaster.full_name).like(pattern))

    total = query.count()
    rows = (
        query.order_by(StudentMaster.full_name.asc(), StudentMaster.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return StudentMasterListResponse(
        items=[_student_summary(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/data-quality-summary")
def student_master_data_quality_summary(db: Session = Depends(get_db)):
    total = db.query(StudentMaster).count()
    pending_review = db.query(StudentMaster).filter(StudentMaster.student_status == "pending_review").count()
    missing_nisn = db.query(StudentMaster).filter(StudentMaster.nisn.is_(None)).count()
    missing_nik = db.query(StudentMaster).filter(StudentMaster.nik.is_(None)).count()
    active_device_identities = (
        db.query(StudentDeviceIdentity).filter(StudentDeviceIdentity.is_active.is_(True)).count()
    )
    return {
        "total": total,
        "pending_review": pending_review,
        "missing_nisn": missing_nisn,
        "missing_nik": missing_nik,
        "active_device_identities": active_device_identities,
    }


@router.get("/{student_master_id}", response_model=StudentMasterSummary)
def get_student_master(student_master_id: str, db: Session = Depends(get_db)):
    student = db.get(StudentMaster, student_master_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student master not found")
    return _student_summary(student)


@router.get("/{student_master_id}/device-identities", response_model=list[DeviceIdentitySummary])
def list_student_device_identities(
    student_master_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    if db.get(StudentMaster, student_master_id) is None:
        raise HTTPException(status_code=404, detail="Student master not found")
    rows = (
        db.query(StudentDeviceIdentity)
        .filter(StudentDeviceIdentity.student_master_id == student_master_id)
        .order_by(StudentDeviceIdentity.effective_from.desc(), StudentDeviceIdentity.id.desc())
        .all()
    )
    return [
        DeviceIdentitySummary(
            id=row.id,
            legacy_student_id=row.legacy_student_id,
            device_identifier_masked=mask_identifier(row.device_identifier) or "",
            device_source=row.device_source,
            effective_from=row.effective_from,
            effective_to=row.effective_to,
            is_active=row.is_active,
        )
        for row in rows
    ]
