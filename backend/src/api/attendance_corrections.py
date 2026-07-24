from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.database import get_db
from models.attendance import Attendance
from models.attendance_review import AttendanceCorrectionAudit, AttendanceCorrectionRequest, AttendancePeriod, AttendancePeriodAudit
from models.user import User
from security.dependencies import get_current_user, require_capability
from services.attendance_corrections import (
    ACTIVE_REQUEST_STATES,
    append_correction_audit,
    apply_approved_override,
    effective_snapshot,
    finalize_period,
    fingerprint,
    reopen_period,
    safe_error,
)

router = APIRouter(dependencies=[Depends(get_current_user)])
APPROVAL_TOKEN = "APPROVE_ATTENDANCE_CORRECTION"
FINALIZE_TOKEN = "FINALIZE_ATTENDANCE_PERIOD"
REOPEN_TOKEN = "REOPEN_ATTENDANCE_PERIOD"


class CorrectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attendance_id: int
    proposed_status: str
    proposed_check_in: time | None = None
    proposed_check_out: time | None = None
    reason_code: str = Field(min_length=2, max_length=64)
    explanation: str = Field(min_length=5, max_length=2000)


class Confirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmation: str


class Rejection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rejection_reason: str = Field(min_length=5, max_length=1000)


class FinalizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attendance_date: date
    reason: str = Field(min_length=5, max_length=1000)
    confirmation: str


class ReopenRequest(FinalizeRequest):
    expected_version: int = Field(gt=0)


def serialize_request(db, row):
    return {
        "id": row.id, "attendance_id": row.attendance_id, "original_snapshot": row.original_snapshot,
        "proposed_status": row.proposed_status,
        "proposed_check_in": str(row.proposed_check_in) if row.proposed_check_in else None,
        "proposed_check_out": str(row.proposed_check_out) if row.proposed_check_out else None,
        "reason_code": row.reason_code, "explanation": row.explanation, "requester": row.requester,
        "submitted_at": row.submitted_at, "state": row.state, "version": row.version,
        "approver": row.approver, "decided_at": row.decided_at,
        "rejection_reason": row.rejection_reason, "resulting_override_id": row.resulting_override_id,
        "created_at": row.created_at, "updated_at": row.updated_at,
        "audit": [
            {"action": audit.action, "prior_state": audit.prior_state, "new_state": audit.new_state,
             "actor": audit.actor, "reason_code": audit.reason_code, "created_at": audit.created_at}
            for audit in db.query(AttendanceCorrectionAudit).filter_by(request_id=row.id).order_by(AttendanceCorrectionAudit.id).all()
        ],
    }


@router.post("")
def create_request(body: CorrectionCreate, db: Session = Depends(get_db), user: User = Depends(require_capability("request_attendance_correction"))):
    attendance = db.get(Attendance, body.attendance_id)
    if attendance is None:
        raise safe_error(404, "ATTENDANCE_NOT_FOUND", "Attendance record was not found.")
    active = db.query(AttendanceCorrectionRequest).filter(
        AttendanceCorrectionRequest.attendance_id == attendance.id,
        AttendanceCorrectionRequest.state.in_(ACTIVE_REQUEST_STATES),
    ).first()
    if active:
        raise safe_error(409, "ATTENDANCE_CORRECTION_ALREADY_PENDING", "An active correction request already exists.")
    snapshot = effective_snapshot(db, attendance)
    row = AttendanceCorrectionRequest(
        attendance_id=attendance.id, active_key=f"attendance:{attendance.id}",
        original_snapshot=snapshot, original_fingerprint=fingerprint(snapshot),
        proposed_status=body.proposed_status, proposed_check_in=body.proposed_check_in,
        proposed_check_out=body.proposed_check_out, reason_code=body.reason_code.strip(),
        explanation=body.explanation.strip(), requester=user.username,
    )
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise safe_error(409, "ATTENDANCE_CORRECTION_ALREADY_PENDING", "An active correction request already exists.")
    append_correction_audit(db, row, "CREATE", None, user.username)
    db.commit(); db.refresh(row)
    return serialize_request(db, row)


@router.get("")
def list_requests(state: str | None = Query(None), db: Session = Depends(get_db), _user: User = Depends(require_capability("view_attendance_corrections"))):
    expired = db.query(AttendanceCorrectionRequest).filter(
        AttendanceCorrectionRequest.state.in_(ACTIVE_REQUEST_STATES),
        AttendanceCorrectionRequest.updated_at < datetime.utcnow() - timedelta(days=7),
    ).all()
    for row in expired:
        prior = row.state; row.state = "EXPIRED"; row.active_key = None; row.version += 1
        append_correction_audit(db, row, "EXPIRE", prior, "SYSTEM", "Request exceeded the seven-day review window")
    if expired:
        db.commit()
    query = db.query(AttendanceCorrectionRequest)
    if state:
        query = query.filter(AttendanceCorrectionRequest.state == state.upper())
    return [serialize_request(db, row) for row in query.order_by(AttendanceCorrectionRequest.id.desc()).all()]


@router.get("/{request_id:int}")
def get_request(request_id: int, db: Session = Depends(get_db), _user: User = Depends(require_capability("view_attendance_corrections"))):
    row = db.get(AttendanceCorrectionRequest, request_id)
    if row is None: raise safe_error(404, "ATTENDANCE_CORRECTION_NOT_FOUND", "Correction request was not found.")
    return serialize_request(db, row)


@router.post("/{request_id:int}/submit")
def submit_request(request_id: int, db: Session = Depends(get_db), user: User = Depends(require_capability("request_attendance_correction"))):
    row = db.get(AttendanceCorrectionRequest, request_id)
    if row is None or row.state != "DRAFT" or (row.requester != user.username and user.role != "admin"):
        raise safe_error(409, "ATTENDANCE_CORRECTION_NOT_REVIEWABLE", "Correction request cannot be submitted.")
    prior = row.state; row.state = "SUBMITTED"; row.submitted_at = datetime.utcnow(); row.version += 1
    append_correction_audit(db, row, "SUBMIT", prior, user.username); db.commit()
    return serialize_request(db, row)


@router.post("/{request_id:int}/approve")
def approve_request(request_id: int, body: Confirmation, db: Session = Depends(get_db), user: User = Depends(require_capability("approve_attendance_correction"))):
    if body.confirmation != APPROVAL_TOKEN:
        raise safe_error(400, "ATTENDANCE_CONFIRMATION_REQUIRED", "Approval confirmation is required.")
    row = db.query(AttendanceCorrectionRequest).filter(
        AttendanceCorrectionRequest.id == request_id
    ).with_for_update().one_or_none()
    if row is None or row.state != "SUBMITTED":
        raise safe_error(409, "ATTENDANCE_CORRECTION_NOT_REVIEWABLE", "Correction request is not reviewable.")
    if row.requester == user.username:
        raise safe_error(403, "ATTENDANCE_CORRECTION_SELF_APPROVAL_FORBIDDEN", "Requester cannot approve their own correction.")
    attendance = db.query(Attendance).filter(
        Attendance.id == row.attendance_id
    ).with_for_update().one()
    current = effective_snapshot(db, attendance)
    if fingerprint(current) != row.original_fingerprint:
        prior = row.state; row.state = "STALE"; row.active_key = None; row.version += 1
        append_correction_audit(db, row, "MARK_STALE", prior, user.username, "Effective attendance changed after submission")
        db.commit()
        raise safe_error(409, "ATTENDANCE_CORRECTION_STALE", "Attendance changed after the request was created.")
    override = apply_approved_override(
        db, attendance, status=row.proposed_status, check_in=row.proposed_check_in,
        check_out=row.proposed_check_out, note=row.explanation, actor=user.username,
    )
    prior = row.state; row.state = "APPROVED"; row.active_key = None; row.approver = user.username
    row.decided_at = datetime.utcnow(); row.resulting_override_id = override.id; row.version += 1
    append_correction_audit(db, row, "APPROVE", prior, user.username)
    db.commit()
    return serialize_request(db, row)


@router.post("/{request_id:int}/reject")
def reject_request(request_id: int, body: Rejection, db: Session = Depends(get_db), user: User = Depends(require_capability("reject_attendance_correction"))):
    row = db.query(AttendanceCorrectionRequest).filter(
        AttendanceCorrectionRequest.id == request_id
    ).with_for_update().one_or_none()
    if row is None or row.state != "SUBMITTED":
        raise safe_error(409, "ATTENDANCE_CORRECTION_NOT_REVIEWABLE", "Correction request is not reviewable.")
    prior = row.state; row.state = "REJECTED"; row.active_key = None; row.approver = user.username
    row.decided_at = datetime.utcnow(); row.rejection_reason = body.rejection_reason.strip(); row.version += 1
    append_correction_audit(db, row, "REJECT", prior, user.username, row.rejection_reason)
    db.commit(); return serialize_request(db, row)


@router.post("/{request_id:int}/cancel")
def cancel_request(request_id: int, db: Session = Depends(get_db), user: User = Depends(require_capability("cancel_attendance_correction"))):
    row = db.query(AttendanceCorrectionRequest).filter(
        AttendanceCorrectionRequest.id == request_id
    ).with_for_update().one_or_none()
    if row is None or row.state not in ACTIVE_REQUEST_STATES or (row.requester != user.username and user.role != "admin"):
        raise safe_error(409, "ATTENDANCE_CORRECTION_NOT_REVIEWABLE", "Correction request cannot be cancelled.")
    prior = row.state; row.state = "CANCELLED"; row.active_key = None; row.version += 1
    append_correction_audit(db, row, "CANCEL", prior, user.username); db.commit()
    return serialize_request(db, row)


@router.post("/periods/finalize")
def finalize(body: FinalizeRequest, db: Session = Depends(get_db), user: User = Depends(require_capability("finalize_attendance_period"))):
    if body.confirmation != FINALIZE_TOKEN:
        raise safe_error(400, "ATTENDANCE_CONFIRMATION_REQUIRED", "Finalization confirmation is required.")
    period = finalize_period(db, body.attendance_date, user.username, body.reason.strip()); db.commit()
    return {"attendance_date": period.attendance_date, "status": period.status, "version": period.version, "finalized_by": period.finalized_by}


@router.post("/periods/reopen")
def reopen(body: ReopenRequest, db: Session = Depends(get_db), user: User = Depends(require_capability("reopen_attendance_period"))):
    if body.confirmation != REOPEN_TOKEN:
        raise safe_error(400, "ATTENDANCE_CONFIRMATION_REQUIRED", "Reopening confirmation is required.")
    period = reopen_period(db, body.attendance_date, body.expected_version, user.username, body.reason.strip()); db.commit()
    return {"attendance_date": period.attendance_date, "status": period.status, "version": period.version, "reopened_by": period.reopened_by}


@router.get("/periods/status")
def period_status(attendance_date: date, db: Session = Depends(get_db), _user: User = Depends(require_capability("view_attendance_corrections"))):
    row = db.query(AttendancePeriod).filter_by(attendance_date=attendance_date).first()
    if row is None: return {"attendance_date": attendance_date, "status": "OPEN", "version": 0, "audit": []}
    audit = db.query(AttendancePeriodAudit).filter_by(period_id=row.id).order_by(AttendancePeriodAudit.id).all()
    return {"attendance_date": row.attendance_date, "status": row.status, "version": row.version,
            "finalized_by": row.finalized_by, "reopened_by": row.reopened_by,
            "audit": [{"action": item.action, "actor": item.actor, "prior_status": item.prior_status,
                       "new_status": item.new_status, "created_at": item.created_at} for item in audit]}
