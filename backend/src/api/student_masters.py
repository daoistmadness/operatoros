from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from models.student_master import StudentDeviceIdentity, StudentImportBatch, StudentMaster
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.jenjang import Jenjang
from models.user import User
from schemas.student_master import (
    DeviceIdentitySummary,
    StudentMasterListResponse,
    StudentMasterSummary,
)
from schemas.student_management import (
    DeviceReassignRequest, DeviceReplaceRequest, DeviceRetireRequest, ImportCommitRequest,
    StudentCreateRequest, StudentProfilePatch,
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
from services.student_management import (
    add_or_replace_device, create_student, list_students, quality_summary,
    reassign_device, retire_device, serialize_student_detail, update_student,
)
from services.student_workbook import (
    commit_update_preview, create_update_preview, export_student_workbook,
    result_workbook, serialize_update_batch,
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


@router.get("/management/list")
def list_managed_students(
    search: str | None = None,
    academic_year_id: int | None = Query(default=None, gt=0),
    jenjang_id: int | None = Query(default=None, gt=0),
    class_id: int | None = Query(default=None, gt=0),
    status: str | None = None,
    device_linked: bool | None = None,
    enrollment_status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return list_students(
        db, search=search, academic_year_id=academic_year_id, jenjang_id=jenjang_id,
        class_id=class_id, status=status, device_linked=device_linked,
        enrollment_status=enrollment_status, page=page, page_size=page_size,
    )


@router.get("/management/quality")
def managed_student_quality(db: Session = Depends(get_db)):
    return quality_summary(db)


@router.get("/management/export-template")
def export_managed_students(
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    return Response(
        content=export_student_workbook(db),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="operatoros-student-update.xlsx"'},
    )


@router.post("/management/update-preview")
async def preview_student_update_workbook(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Student update file must be XLSX")
    contents = await file.read()
    if not contents or len(contents) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Student update file must be between 1 byte and 25 MB")
    batch = create_update_preview(db, contents, file.filename or "student-update.xlsx", user.username)
    return serialize_update_batch(db, batch)


@router.post("/management/update-commit/{batch_id}")
def commit_student_update_workbook(
    batch_id: str,
    body: ImportCommitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    return commit_update_preview(
        db, batch_id, body.selected_row_ids, body.confirmation,
        body.preview_checksum, user.username,
    )


@router.get("/management/import-history")
def student_update_import_history(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    query = db.query(StudentImportBatch).filter(StudentImportBatch.source_sheet == "student_update")
    total = query.count()
    rows = query.order_by(StudentImportBatch.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [serialize_update_batch(db, row) for row in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/management/imports/{batch_id}")
def student_update_import_detail(
    batch_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    batch = db.get(StudentImportBatch, batch_id)
    if batch is None or batch.source_sheet != "student_update":
        raise HTTPException(status_code=404, detail="Student update import not found")
    return serialize_update_batch(db, batch)


@router.get("/management/imports/{batch_id}/result.xlsx")
def student_update_result_workbook(
    batch_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    batch = db.get(StudentImportBatch, batch_id)
    if batch is None or batch.source_sheet != "student_update":
        raise HTTPException(status_code=404, detail="Student update import not found")
    return Response(
        content=result_workbook(db, batch),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="student-update-result-{batch.id}.xlsx"'},
    )


@router.post("", status_code=201)
def create_canonical_student(
    body: StudentCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    return serialize_student_detail(db, create_student(db, body, user.username))


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


@router.get("/{student_master_id}/profile")
def get_student_profile(
    student_master_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    student = db.get(StudentMaster, student_master_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student master not found")
    return serialize_student_detail(db, student)


@router.patch("/{student_master_id}/profile")
def patch_student_profile(
    student_master_id: str,
    body: StudentProfilePatch,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    student = db.get(StudentMaster, student_master_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student master not found")
    return serialize_student_detail(db, update_student(db, student, body, user.username))


@router.get("/{student_master_id}/history")
def get_student_change_history(
    student_master_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    if db.get(StudentMaster, student_master_id) is None:
        raise HTTPException(status_code=404, detail="Student master not found")
    from models.student_master import StudentMasterChangeHistory
    rows = db.query(StudentMasterChangeHistory).filter_by(student_master_id=student_master_id).order_by(StudentMasterChangeHistory.changed_at.desc(), StudentMasterChangeHistory.id.desc()).all()
    return [{"id": row.id, "action": row.action, "field_name": row.field_name, "old_value": row.old_value, "new_value": row.new_value, "source": row.source, "changed_by": row.changed_by, "changed_at": row.changed_at, "import_batch_id": row.import_batch_id} for row in rows]


@router.post("/{student_master_id}/device-identities", status_code=201)
def replace_student_device_identity(
    student_master_id: str,
    body: DeviceReplaceRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    student = db.get(StudentMaster, student_master_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student master not found")
    row = add_or_replace_device(db, student, body, user.username)
    return {"id": row.id, "device_identifier": row.device_identifier, "device_source": row.device_source, "effective_from": row.effective_from, "effective_to": row.effective_to, "is_active": row.is_active}


@router.post("/{student_master_id}/device-identities/reassign", status_code=201)
def guarded_reassign_student_device_identity(
    student_master_id: str,
    body: DeviceReassignRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    student = db.get(StudentMaster, student_master_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student master not found")
    row = reassign_device(db, student, body, user.username)
    return {"id": row.id, "device_identifier": row.device_identifier, "device_source": row.device_source, "effective_from": row.effective_from, "effective_to": row.effective_to, "is_active": row.is_active}


@router.post("/{student_master_id}/device-identities/{identity_id}/retire")
def retire_student_device_identity(
    student_master_id: str,
    identity_id: int,
    body: DeviceRetireRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    student = db.get(StudentMaster, student_master_id)
    mapping = db.get(StudentDeviceIdentity, identity_id)
    if student is None or mapping is None:
        raise HTTPException(status_code=404, detail="Student or device identity not found")
    retire_device(db, student, mapping, body, user.username)
    return {"status": "retired", "identity_id": identity_id}


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
