from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Session

from models.attendance import Attendance
from models.attendance_review import AttendancePeriod
from models.early_departure_excuse import EarlyDepartureExcuse, EarlyDepartureExcuseAudit


def record_early_departure_excuse(
    db: Session,
    attendance_id: int,
    reason_code: str,
    explanation: Optional[str] = None,
    actor: str = "system",
    is_admin_or_override: bool = False,
) -> EarlyDepartureExcuse:
    attendance = db.query(Attendance).filter(Attendance.id == attendance_id).first()
    if not attendance:
        raise ValueError("ATTENDANCE_NOT_FOUND")

    # Finalized period check
    period = db.query(AttendancePeriod).filter(AttendancePeriod.attendance_date == attendance.date).first()
    if period and period.status == "FINALIZED" and not is_admin_or_override:
        raise ValueError("ATTENDANCE_PERIOD_FINALIZED")

    # Invariant check: only one active excuse allowed
    existing = (
        db.query(EarlyDepartureExcuse)
        .filter(
            EarlyDepartureExcuse.attendance_id == attendance_id,
            EarlyDepartureExcuse.state == "ACTIVE",
        )
        .first()
    )
    if existing:
        raise ValueError("EARLY_DEPARTURE_EXCUSE_ALREADY_ACTIVE")

    excuse = EarlyDepartureExcuse(
        attendance_id=attendance_id,
        reason_code=reason_code.strip(),
        explanation=explanation.strip() if explanation else None,
        state="ACTIVE",
        recorded_by=actor,
        recorded_at=datetime.utcnow(),
    )
    db.add(excuse)
    db.flush()

    audit = EarlyDepartureExcuseAudit(
        excuse_id=excuse.id,
        action="RECORDED",
        actor=actor,
        timestamp=datetime.utcnow(),
        reason_code=excuse.reason_code,
    )
    db.add(audit)
    db.commit()
    db.refresh(excuse)
    return excuse


def revoke_early_departure_excuse(
    db: Session,
    excuse_id: int,
    revocation_reason: str,
    actor: str = "system",
    is_admin_or_override: bool = False,
) -> EarlyDepartureExcuse:
    excuse = db.query(EarlyDepartureExcuse).filter(EarlyDepartureExcuse.id == excuse_id).first()
    if not excuse or excuse.state != "ACTIVE":
        raise ValueError("EARLY_DEPARTURE_EXCUSE_NOT_ACTIVE")

    attendance = db.query(Attendance).filter(Attendance.id == excuse.attendance_id).first()
    if attendance:
        period = db.query(AttendancePeriod).filter(AttendancePeriod.attendance_date == attendance.date).first()
        if period and period.status == "FINALIZED" and not is_admin_or_override:
            raise ValueError("ATTENDANCE_PERIOD_FINALIZED")

    excuse.state = "REVOKED"
    excuse.revoked_by = actor
    excuse.revoked_at = datetime.utcnow()
    excuse.revocation_reason = revocation_reason.strip() if revocation_reason else None

    audit = EarlyDepartureExcuseAudit(
        excuse_id=excuse.id,
        action="REVOKED",
        actor=actor,
        timestamp=datetime.utcnow(),
        reason_code=excuse.reason_code,
        revocation_reason=excuse.revocation_reason,
    )
    db.add(audit)
    db.commit()
    db.refresh(excuse)
    return excuse


def get_active_excuse_for_attendance(
    db: Session,
    attendance_id: int,
) -> Optional[EarlyDepartureExcuse]:
    return (
        db.query(EarlyDepartureExcuse)
        .filter(
            EarlyDepartureExcuse.attendance_id == attendance_id,
            EarlyDepartureExcuse.state == "ACTIVE",
        )
        .first()
    )
