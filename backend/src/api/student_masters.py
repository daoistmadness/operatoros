from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from models.student_master import StudentDeviceIdentity, StudentMaster
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.jenjang import Jenjang
from models.user import User
from schemas.student_master import (
    DeviceIdentitySummary,
    StudentMasterListResponse,
    StudentMasterSummary,
)
from security.dependencies import get_current_user, require_role
from services.student_normalization import mask_identifier
from services.student_linking import (
    build_legacy_link_rows,
    commit_legacy_preview,
    create_legacy_preview,
    resolve_legacy_student,
    summarize,
)


router = APIRouter(dependencies=[Depends(get_current_user)])


class LegacyLinkCommitRequest(BaseModel):
    preview_id: str
    selected_legacy_student_ids: list[int] = Field(min_length=1)
    confirmation: str


class LegacyLinkResolutionRequest(BaseModel):
    action: Literal["link_existing", "create_new", "defer", "mark_invalid"]
    student_master_id: str | None = None
    reason: str = Field(min_length=3, max_length=1000)
    confirmation: str


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
    linked_legacy_ids = {
        legacy_id for (legacy_id,) in db.query(StudentDeviceIdentity.legacy_student_id)
        .filter(StudentDeviceIdentity.is_active.is_(True), StudentDeviceIdentity.legacy_student_id.isnot(None))
        .distinct().all()
    }
    legacy_without_master = db.query(Student).filter(~Student.id.in_(linked_legacy_ids)).count()
    masters_with_identity = {
        master_id for (master_id,) in db.query(StudentDeviceIdentity.student_master_id)
        .filter(StudentDeviceIdentity.is_active.is_(True)).distinct().all()
    }
    masters_without_device_identity = db.query(StudentMaster).filter(~StudentMaster.id.in_(masters_with_identity)).count()
    enrolled_master_ids = {
        master_id for (master_id,) in db.query(StudentEnrollment.student_master_id)
        .filter(StudentEnrollment.student_master_id.isnot(None)).distinct().all()
    }
    masters_without_enrollment = db.query(StudentMaster).filter(~StudentMaster.id.in_(enrolled_master_ids)).count()
    enrollments_without_class = db.query(StudentEnrollment).filter(
        (StudentEnrollment.class_name.is_(None)) | (StudentEnrollment.class_name == "")
    ).count()
    canonical_jenjang_names = {row.name.casefold() for row in db.query(Jenjang).all()}
    missing_jenjang_mappings = sum(
        1 for (value,) in db.query(Student.jenjang).all()
        if not value or not value.strip() or value.strip().casefold() not in canonical_jenjang_names
    )
    duplicate_active_device_identities = len(
        db.query(StudentDeviceIdentity.device_source, StudentDeviceIdentity.device_identifier)
        .filter(StudentDeviceIdentity.is_active.is_(True))
        .group_by(StudentDeviceIdentity.device_source, StudentDeviceIdentity.device_identifier)
        .having(func.count(StudentDeviceIdentity.id) > 1).all()
    )
    link_rows = build_legacy_link_rows(db)
    ambiguous_legacy_links = sum(row["proposed_action"] == "REVIEW_REQUIRED" for row in link_rows)
    cross_jenjang_conflicts = (
        db.query(StudentEnrollment)
        .join(Student, Student.id == StudentEnrollment.student_id)
        .join(Jenjang, Jenjang.id == StudentEnrollment.jenjang_id)
        .filter(Student.jenjang.isnot(None), func.lower(Student.jenjang) != func.lower(Jenjang.name))
        .count()
    )
    return {
        "total": total,
        "pending_review": pending_review,
        "missing_nisn": missing_nisn,
        "missing_nik": missing_nik,
        "active_device_identities": active_device_identities,
        "legacy_students_without_canonical_master": legacy_without_master,
        "canonical_masters_without_device_identity": masters_without_device_identity,
        "canonical_masters_without_enrollment": masters_without_enrollment,
        "enrollments_without_class": enrollments_without_class,
        "missing_jenjang_mappings": missing_jenjang_mappings,
        "duplicate_active_device_identities": duplicate_active_device_identities,
        "ambiguous_legacy_links": ambiguous_legacy_links,
        "cross_jenjang_conflicts": cross_jenjang_conflicts,
    }


@router.post("/legacy-link/preview")
def preview_legacy_student_links(
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    batch = create_legacy_preview(db, user.username)
    return {
        "preview_id": batch.id,
        "snapshot_checksum": batch.snapshot_checksum,
        "summary": summarize(batch.rows),
        "rows": batch.rows,
    }


@router.post("/legacy-link/commit")
def commit_legacy_student_links(
    body: LegacyLinkCommitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    return commit_legacy_preview(
        db, body.preview_id, body.selected_legacy_student_ids, body.confirmation, user.username
    )


@router.post("/legacy-link/{legacy_student_id}/resolve")
def resolve_legacy_student_link(
    legacy_student_id: int,
    body: LegacyLinkResolutionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    return resolve_legacy_student(
        db, legacy_student_id, body.action, body.student_master_id,
        body.reason, body.confirmation, user.username,
    )


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
