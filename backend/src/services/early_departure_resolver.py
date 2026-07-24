from datetime import date, time, datetime
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session

from models.attendance import Attendance
from models.attendance_review import AttendanceOverride, AttendanceCorrectionRequest, AttendancePeriod
from models.dismissal_policy import DismissalPolicy
from models.early_departure_excuse import EarlyDepartureExcuse
from models.heb_override import HebOverride


def _format_time(t: Optional[time]) -> Optional[str]:
    return t.strftime("%H:%M") if t else None


def _time_to_minutes(t: time) -> int:
    return t.hour * 60 + t.minute


def resolve_departure_status(
    attendance: Attendance,
    override: Optional[AttendanceOverride] = None,
    policy: Optional[DismissalPolicy] = None,
    is_non_effective_day: bool = False,
    active_excuse: Optional[EarlyDepartureExcuse] = None,
    has_pending_correction: bool = False,
    is_period_finalized: bool = False,
) -> Dict[str, Any]:
    """
    Deterministic canonical early-departure resolver.
    Used consistently by REST APIs, reports, exports, and analytics.
    """
    raw_check_out = attendance.check_out
    effective_check_in = override.override_check_in if (override and override.override_check_in) else attendance.check_in
    effective_check_out = override.override_check_out if (override and override.override_check_out) else attendance.check_out

    # Non-school days or excused full-day absence statuses
    status_lower = (attendance.status or "").lower()
    is_full_day_absence = status_lower in ("sakit", "izin", "alfa", "libur")

    if is_non_effective_day or is_full_day_absence:
        return {
            "attendance_id": attendance.id,
            "date": str(attendance.date),
            "student_id": attendance.student_id,
            "classification": "NOT_APPLICABLE",
            "effective_check_in": _format_time(effective_check_in),
            "effective_check_out": _format_time(effective_check_out),
            "raw_check_out": _format_time(raw_check_out),
            "has_override": bool(override and (override.override_check_in or override.override_check_out)),
            "scheduled_dismissal": _format_time(policy.dismissal_time) if policy else None,
            "grace_period_minutes": policy.grace_period_minutes if policy else 0,
            "minutes_early": 0,
            "policy_id": policy.id if policy else None,
            "policy_version": f"policy_{policy.id}" if policy else None,
            "excuse": {
                "id": active_excuse.id,
                "reason_code": active_excuse.reason_code,
                "explanation": active_excuse.explanation,
                "recorded_by": active_excuse.recorded_by,
                "recorded_at": active_excuse.recorded_at.isoformat() if active_excuse.recorded_at else None,
                "state": active_excuse.state,
            } if (active_excuse and active_excuse.state == "ACTIVE") else None,
            "has_pending_correction": has_pending_correction,
            "is_period_finalized": is_period_finalized,
        }

    # Absent or no scans
    if effective_check_in is None and effective_check_out is None:
        classification = "NOT_APPLICABLE"
        minutes_early = 0
    # Checked in but no checkout
    elif effective_check_in is not None and effective_check_out is None:
        classification = "MISSING_CHECKOUT"
        minutes_early = 0
    # Checkout present
    else:
        if not policy:
            classification = "UNKNOWN_POLICY"
            minutes_early = 0
        else:
            check_out_mins = _time_to_minutes(effective_check_out)
            dismissal_mins = _time_to_minutes(policy.dismissal_time)
            threshold_mins = dismissal_mins - policy.grace_period_minutes

            if check_out_mins < threshold_mins:
                minutes_early = max(0, dismissal_mins - check_out_mins)
                if active_excuse and active_excuse.state == "ACTIVE":
                    classification = "EXCUSED_EARLY_DEPARTURE"
                else:
                    classification = "EARLY_DEPARTURE"
            else:
                classification = "ON_TIME_DEPARTURE"
                minutes_early = 0

    return {
        "attendance_id": attendance.id,
        "date": str(attendance.date),
        "student_id": attendance.student_id,
        "classification": classification,
        "effective_check_in": _format_time(effective_check_in),
        "effective_check_out": _format_time(effective_check_out),
        "raw_check_out": _format_time(raw_check_out),
        "has_override": bool(override and (override.override_check_in or override.override_check_out)),
        "scheduled_dismissal": _format_time(policy.dismissal_time) if policy else None,
        "grace_period_minutes": policy.grace_period_minutes if policy else 0,
        "minutes_early": minutes_early,
        "policy_id": policy.id if policy else None,
        "policy_version": f"policy_{policy.id}" if policy else None,
        "excuse": {
            "id": active_excuse.id,
            "reason_code": active_excuse.reason_code,
            "explanation": active_excuse.explanation,
            "recorded_by": active_excuse.recorded_by,
            "recorded_at": active_excuse.recorded_at.isoformat() if active_excuse.recorded_at else None,
            "state": active_excuse.state,
        } if (active_excuse and active_excuse.state == "ACTIVE") else None,
        "has_pending_correction": has_pending_correction,
        "is_period_finalized": is_period_finalized,
    }


def find_applicable_dismissal_policy(
    db: Session,
    jenjang: str,
    target_date: date,
) -> Optional[DismissalPolicy]:
    """Fetch active DismissalPolicy matching jenjang, weekday, and effective date range."""
    weekday = target_date.weekday()  # 0=Monday..6=Sunday
    jenjang_clean = jenjang.strip()

    policies = (
        db.query(DismissalPolicy)
        .filter(
            DismissalPolicy.is_active.is_(True),
            DismissalPolicy.weekday == weekday,
            DismissalPolicy.effective_from <= target_date,
        )
        .all()
    )

    matching = [
        p for p in policies
        if (p.jenjang.strip().lower() == jenjang_clean.lower())
        and (p.effective_to is None or p.effective_to >= target_date)
    ]

    if not matching:
        return None

    # Return most recent effective policy
    matching.sort(key=lambda x: (x.effective_from, x.id), reverse=True)
    return matching[0]
