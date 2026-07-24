from datetime import date, time, datetime
from typing import Optional, List, Any, Dict
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.database import get_db
from security.dependencies import get_current_user
from security.capabilities import capabilities_for_role
from models.user import User
from models.attendance import Attendance
from models.attendance_review import AttendanceOverride, AttendanceCorrectionRequest, AttendancePeriod
from models.early_departure_excuse import EarlyDepartureExcuse, EarlyDepartureExcuseAudit
from models.dismissal_policy import DismissalPolicy, DismissalPolicyAudit
from models.student import Student
from models.academic_master import AcademicClass
from models.heb_override import HebOverride

from services.dismissal_policy import (
    create_dismissal_policy, deactivate_dismissal_policy, list_dismissal_policies
)
from services.early_departure_excuse import (
    record_early_departure_excuse, revoke_early_departure_excuse, get_active_excuse_for_attendance
)
from services.early_departure_resolver import (
    resolve_departure_status, find_applicable_dismissal_policy
)
from services.teacher_class_assignment import verify_teacher_class_access

router = APIRouter(prefix="/api/attendance", tags=["early-departure"])


# --- Schemas ---

class CreateDismissalPolicyRequest(BaseModel):
    jenjang: str = Field(..., min_length=1)
    weekday: int = Field(..., ge=0, le=6)
    dismissal_time: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    grace_period_minutes: int = Field(0, ge=0)
    effective_from: date
    effective_to: Optional[date] = None
    change_reason: Optional[str] = None
    jenjang_id: Optional[int] = None


class DeactivatePolicyRequest(BaseModel):
    change_reason: Optional[str] = None


class RecordExcuseRequest(BaseModel):
    reason_code: str = Field(..., min_length=1)
    explanation: Optional[str] = None


class RevokeExcuseRequest(BaseModel):
    revocation_reason: str = Field(..., min_length=1)


# --- Helper Security Checks ---

def _require_capability(user: User, capability: str) -> None:
    user_caps = capabilities_for_role(user.role)
    if capability not in user_caps:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User lacks required capability: {capability}",
        )


def _parse_time_str(time_str: str) -> time:
    try:
        parts = time_str.split(":")
        return time(hour=int(parts[0]), minute=int(parts[1]))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid time format. Expected HH:MM")


# --- Endpoints ---

@router.get("/departure-policies")
def get_departure_policies(
    jenjang: Optional[str] = Query(None),
    active_only: bool = Query(False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_capability(user, "view_early_departure")
    policies = list_dismissal_policies(db, jenjang=jenjang, active_only=active_only)
    return [
        {
            "id": p.id,
            "jenjang_id": p.jenjang_id,
            "jenjang": p.jenjang,
            "weekday": p.weekday,
            "dismissal_time": p.dismissal_time.strftime("%H:%M"),
            "grace_period_minutes": p.grace_period_minutes,
            "effective_from": str(p.effective_from),
            "effective_to": str(p.effective_to) if p.effective_to else None,
            "is_active": p.is_active,
            "change_reason": p.change_reason,
            "created_by": p.created_by,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in policies
    ]


@router.post("/departure-policies", status_code=status.HTTP_201_CREATED)
def create_policy_endpoint(
    body: CreateDismissalPolicyRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_capability(user, "manage_early_departure_policy")
    d_time = _parse_time_str(body.dismissal_time)
    try:
        policy = create_dismissal_policy(
            db=db,
            jenjang=body.jenjang,
            weekday=body.weekday,
            dismissal_time=d_time,
            grace_period_minutes=body.grace_period_minutes,
            effective_from=body.effective_from,
            effective_to=body.effective_to,
            change_reason=body.change_reason,
            actor=user.username,
            jenjang_id=body.jenjang_id,
        )
        return {
            "id": policy.id,
            "jenjang": policy.jenjang,
            "weekday": policy.weekday,
            "dismissal_time": policy.dismissal_time.strftime("%H:%M"),
            "grace_period_minutes": policy.grace_period_minutes,
            "effective_from": str(policy.effective_from),
            "effective_to": str(policy.effective_to) if policy.effective_to else None,
            "is_active": policy.is_active,
        }
    except ValueError as e:
        err_msg = str(e)
        if err_msg == "DISMISSAL_POLICY_OVERLAP":
            raise HTTPException(
                status_code=400,
                detail={"code": "DISMISSAL_POLICY_OVERLAP", "message": "An active dismissal policy already exists for this jenjang and weekday with overlapping dates"},
            )
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": err_msg})


@router.post("/departure-policies/{policy_id}/deactivate")
def deactivate_policy_endpoint(
    policy_id: int,
    body: DeactivatePolicyRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_capability(user, "manage_early_departure_policy")
    try:
        policy = deactivate_dismissal_policy(
            db=db,
            policy_id=policy_id,
            change_reason=body.change_reason,
            actor=user.username,
        )
        return {"id": policy.id, "is_active": policy.is_active, "status": "DEACTIVATED"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail={"code": "DISMISSAL_POLICY_NOT_FOUND", "message": str(e)})


@router.get("/classes/{class_id}/dates/{date_val}/departures")
def get_class_date_departures(
    class_id: str,
    date_val: date,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_capability(user, "view_early_departure")

    # Authorization scope check
    is_admin = user.role == "admin" or "manage_all_attendance" in capabilities_for_role(user.role)
    if not is_admin:
        has_access = verify_teacher_class_access(db, user=user, class_id_param=class_id, target_date=date_val)
        if not has_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "EARLY_DEPARTURE_CLASS_SCOPE_FORBIDDEN", "message": "Access to unassigned class early departure is forbidden"},
            )

    # Determine class name string
    class_name = class_id
    if class_id.isdigit():
        ac = db.query(AcademicClass).filter(AcademicClass.id == int(class_id)).first()
        if ac:
            class_name = ac.name

    # Query students in class
    students = db.query(Student).filter(Student.class_name == class_name).all()
    if not students:
        return {"class_id": class_id, "date": str(date_val), "departures": []}

    student_ids = [s.id for s in students]
    attendances = (
        db.query(Attendance)
        .filter(Attendance.student_id.in_(student_ids), Attendance.date == date_val)
        .all()
    )
    att_map = {a.student_id: a for a in attendances}

    att_ids = [a.id for a in attendances]
    overrides = db.query(AttendanceOverride).filter(AttendanceOverride.attendance_id.in_(att_ids)).all() if att_ids else []
    override_map = {o.attendance_id: o for o in overrides}

    excuses = db.query(EarlyDepartureExcuse).filter(EarlyDepartureExcuse.attendance_id.in_(att_ids), EarlyDepartureExcuse.state == "ACTIVE").all() if att_ids else []
    excuse_map = {e.attendance_id: e for e in excuses}

    pending_reqs = db.query(AttendanceCorrectionRequest).filter(AttendanceCorrectionRequest.attendance_id.in_(att_ids), AttendanceCorrectionRequest.state == "SUBMITTED").all() if att_ids else []
    pending_set = {r.attendance_id for r in pending_reqs}

    period = db.query(AttendancePeriod).filter(AttendancePeriod.attendance_date == date_val).first()
    is_period_finalized = bool(period and period.status == "FINALIZED")

    non_effective = db.query(HebOverride).filter(HebOverride.date == date_val).first()
    is_non_effective_day = bool(non_effective)

    results = []
    for s in students:
        att = att_map.get(s.id)
        if not att:
            # Synthetic missing attendance record for student
            results.append({
                "student_id": s.id,
                "student_name": s.name,
                "class_name": s.class_name,
                "attendance_id": None,
                "date": str(date_val),
                "classification": "NOT_APPLICABLE" if is_non_effective_day else "MISSING_CHECKOUT",
                "effective_check_in": None,
                "effective_check_out": None,
                "raw_check_out": None,
                "has_override": False,
                "scheduled_dismissal": None,
                "grace_period_minutes": 0,
                "minutes_early": 0,
                "policy_id": None,
                "excuse": None,
                "has_pending_correction": False,
                "is_period_finalized": is_period_finalized,
            })
            continue

        jenjang = s.jenjang or "Primary"
        policy = find_applicable_dismissal_policy(db, jenjang=jenjang, target_date=date_val)
        ovr = override_map.get(att.id)
        exc = excuse_map.get(att.id)
        has_pending = att.id in pending_set

        resolution = resolve_departure_status(
            attendance=att,
            override=ovr,
            policy=policy,
            is_non_effective_day=is_non_effective_day,
            active_excuse=exc,
            has_pending_correction=has_pending,
            is_period_finalized=is_period_finalized,
        )
        resolution["student_name"] = s.name
        resolution["class_name"] = s.class_name
        results.append(resolution)

    return {
        "class_id": class_id,
        "date": str(date_val),
        "departures": results,
    }


@router.post("/{attendance_id}/departure-excuses", status_code=status.HTTP_201_CREATED)
def record_excuse_endpoint(
    attendance_id: int,
    body: RecordExcuseRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_capability(user, "record_early_departure_excuse")

    att = db.query(Attendance).filter(Attendance.id == attendance_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    is_admin = user.role == "admin" or "manage_all_attendance" in capabilities_for_role(user.role)
    if not is_admin:
        student = db.query(Student).filter(Student.id == att.student_id).first()
        class_param = student.class_name if student else "unknown"
        has_access = verify_teacher_class_access(db, user=user, class_id_param=class_param, target_date=att.date)
        if not has_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "EARLY_DEPARTURE_CLASS_SCOPE_FORBIDDEN", "message": "Cannot record excuse for unassigned class"},
            )

    try:
        excuse = record_early_departure_excuse(
            db=db,
            attendance_id=attendance_id,
            reason_code=body.reason_code,
            explanation=body.explanation,
            actor=user.username,
            is_admin_or_override=is_admin,
        )
        return {
            "id": excuse.id,
            "attendance_id": excuse.attendance_id,
            "reason_code": excuse.reason_code,
            "explanation": excuse.explanation,
            "state": excuse.state,
            "recorded_by": excuse.recorded_by,
            "recorded_at": excuse.recorded_at.isoformat() if excuse.recorded_at else None,
        }
    except ValueError as e:
        code_map = {
            "ATTENDANCE_PERIOD_FINALIZED": 400,
            "EARLY_DEPARTURE_EXCUSE_ALREADY_ACTIVE": 400,
        }
        err_str = str(e)
        status_c = code_map.get(err_str, 400)
        raise HTTPException(status_code=status_c, detail={"code": err_str, "message": f"Operation rejected: {err_str}"})


@router.post("/{attendance_id}/departure-excuses/{excuse_id}/revoke")
def revoke_excuse_endpoint(
    attendance_id: int,
    excuse_id: int,
    body: RevokeExcuseRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_capability(user, "revoke_early_departure_excuse")

    att = db.query(Attendance).filter(Attendance.id == attendance_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    is_admin = user.role == "admin" or "manage_all_attendance" in capabilities_for_role(user.role)
    if not is_admin:
        student = db.query(Student).filter(Student.id == att.student_id).first()
        class_param = student.class_name if student else "unknown"
        has_access = verify_teacher_class_access(db, user=user, class_id_param=class_param, target_date=att.date)
        if not has_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "EARLY_DEPARTURE_CLASS_SCOPE_FORBIDDEN", "message": "Cannot revoke excuse for unassigned class"},
            )

    try:
        excuse = revoke_early_departure_excuse(
            db=db,
            excuse_id=excuse_id,
            revocation_reason=body.revocation_reason,
            actor=user.username,
            is_admin_or_override=is_admin,
        )
        return {
            "id": excuse.id,
            "attendance_id": excuse.attendance_id,
            "state": excuse.state,
            "revoked_by": excuse.revoked_by,
            "revoked_at": excuse.revoked_at.isoformat() if excuse.revoked_at else None,
            "revocation_reason": excuse.revocation_reason,
        }
    except ValueError as e:
        code_map = {
            "ATTENDANCE_PERIOD_FINALIZED": 400,
            "EARLY_DEPARTURE_EXCUSE_NOT_ACTIVE": 400,
        }
        err_str = str(e)
        status_c = code_map.get(err_str, 400)
        raise HTTPException(status_code=status_c, detail={"code": err_str, "message": f"Operation rejected: {err_str}"})


@router.get("/{attendance_id}/departure-history")
def get_departure_history(
    attendance_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_capability(user, "view_early_departure")
    att = db.query(Attendance).filter(Attendance.id == attendance_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    excuses = db.query(EarlyDepartureExcuse).filter(EarlyDepartureExcuse.attendance_id == attendance_id).order_by(EarlyDepartureExcuse.recorded_at.desc()).all()
    excuse_ids = [e.id for e in excuses]

    audits = db.query(EarlyDepartureExcuseAudit).filter(EarlyDepartureExcuseAudit.excuse_id.in_(excuse_ids)).order_by(EarlyDepartureExcuseAudit.timestamp.desc()).all() if excuse_ids else []

    overrides = db.query(AttendanceOverride).filter(AttendanceOverride.attendance_id == attendance_id).all()

    return {
        "attendance_id": attendance_id,
        "excuses": [
            {
                "id": e.id,
                "reason_code": e.reason_code,
                "explanation": e.explanation,
                "state": e.state,
                "recorded_by": e.recorded_by,
                "recorded_at": e.recorded_at.isoformat() if e.recorded_at else None,
                "revoked_by": e.revoked_by,
                "revoked_at": e.revoked_at.isoformat() if e.revoked_at else None,
                "revocation_reason": e.revocation_reason,
            }
            for e in excuses
        ],
        "audit_trail": [
            {
                "id": a.id,
                "excuse_id": a.excuse_id,
                "action": a.action,
                "actor": a.actor,
                "timestamp": a.timestamp.isoformat() if a.timestamp else None,
                "reason_code": a.reason_code,
                "revocation_reason": a.revocation_reason,
            }
            for a in audits
        ],
        "overrides": [
            {
                "id": o.id,
                "override_check_in": o.override_check_in.strftime("%H:%M") if o.override_check_in else None,
                "override_check_out": o.override_check_out.strftime("%H:%M") if o.override_check_out else None,
                "actor": o.actor,
                "timestamp": o.timestamp.isoformat() if o.timestamp else None,
            }
            for o in overrides
        ],
    }
