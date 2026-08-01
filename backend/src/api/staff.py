"""Read-only employee directory and redacted import audit endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from core.database import get_db
from models.staff import StaffContactDetail, StaffIdentifier, StaffImportBatch, StaffImportIssue, StaffMember
from models.user import User
from security.dependencies import get_current_user, require_capability

router = APIRouter(dependencies=[Depends(get_current_user)])


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    return "*" * max(0, len(value) - 4) + value[-4:]


def _available(db: Session) -> None:
    try:
        db.query(StaffMember.id).limit(1).all()
    except OperationalError as error:
        raise HTTPException(status_code=503, detail="Employee master extension is not installed") from error


def _summary(member: StaffMember) -> dict[str, object]:
    return {
        "id": member.id, "source_staff_id": member.source_staff_id, "full_name": member.full_name,
        "employment_status": member.employment_status, "job_title": member.job_title_normalized or member.job_title_raw,
        "birth_place": member.birth_place, "birth_date": member.birth_date,
        "employment_start_date": member.employment_start_date, "dapodik_status": member.dapodik_status_normalized,
    }


@router.get("")
def list_staff(
    search: str | None = None,
    status: str | None = Query(default=None, pattern="^(ACTIVE|FORMER|UNKNOWN|REVIEW_REQUIRED)$"),
    job_title: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("view_staff")),
):
    _available(db)
    query = db.query(StaffMember)
    if search and search.strip():
        pattern = f"%{search.strip().casefold()}%"
        query = query.filter(or_(func.lower(StaffMember.full_name).like(pattern), func.lower(StaffMember.source_staff_id).like(pattern)))
    if status:
        query = query.filter(StaffMember.employment_status == status)
    if job_title:
        query = query.filter(func.lower(StaffMember.job_title_raw).like(f"%{job_title.casefold()}%"))
    total = query.count()
    rows = query.order_by(StaffMember.full_name.asc(), StaffMember.id.asc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [_summary(row) for row in rows], "total": total, "page": page, "page_size": page_size, "total_pages": (total + page_size - 1) // page_size}


@router.get("/{staff_id}")
def staff_detail(staff_id: str, db: Session = Depends(get_db), _user: User = Depends(require_capability("view_staff"))):
    _available(db)
    member = db.get(StaffMember, staff_id)
    if not member:
        raise HTTPException(status_code=404, detail="Staff member not found")
    return _summary(member) | {"identifiers": [], "contact": None}


@router.get("/{staff_id}/sensitive")
def staff_sensitive_detail(staff_id: str, db: Session = Depends(get_db), _user: User = Depends(require_capability("view_staff_sensitive"))):
    _available(db)
    member = db.get(StaffMember, staff_id)
    if not member:
        raise HTTPException(status_code=404, detail="Staff member not found")
    identifiers = db.query(StaffIdentifier).filter_by(staff_member_id=staff_id).all()
    contact = db.query(StaffContactDetail).filter_by(staff_member_id=staff_id).first()
    return _summary(member) | {
        "identifiers": [{"type": item.identifier_type, "value_masked": _mask(item.normalized_value), "verification_status": item.verification_status} for item in identifiers],
        "contact": {"email": contact.email, "phone": _mask(contact.phone), "address": contact.address} if contact else None,
    }


@router.get("/imports/history")
def staff_import_history(db: Session = Depends(get_db), _user: User = Depends(require_capability("view_staff_audit"))):
    _available(db)
    rows = db.query(StaffImportBatch).order_by(StaffImportBatch.imported_at.desc()).limit(100).all()
    return {"items": [{"id": row.id, "source_filename": row.source_filename, "source_sheet": row.source_sheet, "file_sha256": row.file_sha256, "imported_at": row.imported_at, "actor": row.actor, "total_rows": row.total_rows, "active_count": row.active_count, "former_count": row.former_count, "review_count": row.review_count, "issue_count": row.issue_count, "status": row.status} for row in rows]}


@router.get("/imports/{batch_id}")
def staff_import_detail(batch_id: str, db: Session = Depends(get_db), _user: User = Depends(require_capability("view_staff_audit"))):
    _available(db)
    batch = db.get(StaffImportBatch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Staff import batch not found")
    issue_counts = dict(db.query(StaffImportIssue.issue_code, func.count(StaffImportIssue.id)).filter_by(batch_id=batch_id).group_by(StaffImportIssue.issue_code).all())
    return {"id": batch.id, "source_filename": batch.source_filename, "source_sheet": batch.source_sheet, "file_sha256": batch.file_sha256, "imported_at": batch.imported_at, "status": batch.status, "total_rows": batch.total_rows, "active_count": batch.active_count, "former_count": batch.former_count, "review_count": batch.review_count, "issue_count": batch.issue_count, "issue_counts": issue_counts}
