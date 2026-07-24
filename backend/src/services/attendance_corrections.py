from __future__ import annotations

import hashlib
import json
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.attendance import Attendance
from models.attendance_review import (
    AttendanceCorrectionAudit,
    AttendanceCorrectionRequest,
    AttendanceOverride,
    AttendanceOverrideHistory,
    AttendancePeriod,
    AttendancePeriodAudit,
)

ALLOWED_STATUSES = {"on-time", "late", "absent", "incomplete"}
ACTIVE_REQUEST_STATES = {"DRAFT", "SUBMITTED"}


def safe_error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def effective_snapshot(db: Session, attendance: Attendance) -> dict:
    override = db.query(AttendanceOverride).filter_by(attendance_id=attendance.id).first()
    check_in = override.override_check_in if override and override.override_check_in else attendance.check_in
    check_out = override.override_check_out if override and override.override_check_out else attendance.check_out
    return {
        "attendance_id": attendance.id,
        "status": override.override_status if override else attendance.status,
        "check_in": str(check_in) if check_in else None,
        "check_out": str(check_out) if check_out else None,
        "override_id": override.id if override else None,
        "override_reviewed_at": override.reviewed_at.isoformat() if override else None,
    }


def fingerprint(snapshot: dict) -> str:
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def period_for_date(db: Session, attendance_date):
    return db.query(AttendancePeriod).filter_by(attendance_date=attendance_date).first()


def ensure_period_open(db: Session, attendance_date) -> None:
    period = period_for_date(db, attendance_date)
    if period and period.status == "FINALIZED":
        raise safe_error(409, "ATTENDANCE_PERIOD_FINALIZED", "Attendance period is finalized and must be reopened.")


def apply_approved_override(
    db: Session,
    attendance: Attendance,
    *,
    status: str,
    check_in,
    check_out,
    note: str,
    actor: str,
) -> AttendanceOverride:
    ensure_period_open(db, attendance.date)
    if status not in ALLOWED_STATUSES:
        raise safe_error(400, "ATTENDANCE_CORRECTION_INVALID_STATUS", "Proposed attendance status is invalid.")
    now = datetime.utcnow()
    existing = db.query(AttendanceOverride).filter_by(attendance_id=attendance.id).first()
    previous = effective_snapshot(db, attendance)
    if existing is None:
        existing = AttendanceOverride(
            attendance_id=attendance.id,
            original_status=attendance.status,
            override_status=status,
            override_check_in=check_in,
            override_check_out=check_out,
            note=note,
            reviewed_by=actor,
            reviewed_at=now,
        )
        db.add(existing)
        db.flush()
    else:
        existing.override_status = status
        existing.override_check_in = check_in
        existing.override_check_out = check_out
        existing.note = note
        existing.reviewed_by = actor
        existing.reviewed_at = now
    current = {
        "attendance_id": attendance.id,
        "status": status,
        "check_in": str(check_in) if check_in else previous["check_in"],
        "check_out": str(check_out) if check_out else previous["check_out"],
        "override_id": existing.id,
    }
    db.add(AttendanceOverrideHistory(
        override_id=existing.id,
        attendance_id=attendance.id,
        previous_status=previous["status"],
        new_status=status,
        previous_values=previous,
        new_values=current,
        note=note,
        reviewed_by=actor,
        timestamp=now,
    ))
    return existing


def append_correction_audit(db, request, action, prior_state, actor, summary=None):
    attendance = db.get(Attendance, request.attendance_id)
    db.add(AttendanceCorrectionAudit(
        request_id=request.id,
        action=action,
        prior_state=prior_state,
        new_state=request.state,
        actor=actor,
        effective_date=attendance.date,
        reason_code=request.reason_code,
        explanation_summary=(summary or request.explanation)[:255],
    ))


def finalize_period(db, attendance_date, actor, reason):
    now = datetime.utcnow()
    period = db.query(AttendancePeriod).filter_by(
        attendance_date=attendance_date
    ).with_for_update().one_or_none()
    if period and period.status == "FINALIZED":
        return period
    if period is None:
        period = AttendancePeriod(attendance_date=attendance_date, status="OPEN")
        db.add(period)
        db.flush()
    prior_status, prior_version = period.status, period.version
    period.status = "FINALIZED"
    period.finalized_by = actor
    period.finalized_at = now
    period.reason = reason
    period.version += 1
    db.add(AttendancePeriodAudit(
        period_id=period.id, action="FINALIZE" if prior_version == 1 else "REFINALIZE",
        prior_status=prior_status, new_status="FINALIZED", actor=actor, reason=reason,
        prior_version=prior_version, new_version=period.version,
    ))
    return period


def reopen_period(db, attendance_date, expected_version, actor, reason):
    period = db.query(AttendancePeriod).filter_by(
        attendance_date=attendance_date
    ).with_for_update().one_or_none()
    if period is None or period.status != "FINALIZED":
        raise safe_error(409, "ATTENDANCE_PERIOD_NOT_FINALIZED", "Attendance period is not finalized.")
    if period.version != expected_version:
        raise safe_error(409, "ATTENDANCE_CORRECTION_STALE", "Attendance period changed; refresh and retry.")
    prior_version = period.version
    period.status = "OPEN"
    period.reopened_by = actor
    period.reopened_at = datetime.utcnow()
    period.version += 1
    db.add(AttendancePeriodAudit(
        period_id=period.id, action="REOPEN", prior_status="FINALIZED", new_status="OPEN",
        actor=actor, reason=reason, prior_version=prior_version, new_version=period.version,
    ))
    return period
