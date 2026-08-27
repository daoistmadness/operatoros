from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from core.fixture_http import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from models.academic_master import AcademicClass
from models.academic_year import AcademicYear
from models.attendance import Attendance
from models.attendance_followup import (
    AttendanceFollowUp,
    AttendanceFollowUpAudit,
    AttendanceFollowUpNote,
)
from models.attendance_review import (
    AttendanceCorrectionRequest,
    AttendanceOverride,
    AttendancePeriod,
)
from models.early_departure_excuse import EarlyDepartureExcuse
from models.jenjang import Jenjang
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.student_master import StudentDeviceIdentity, StudentMaster
from models.teacher_class_assignment import TeacherClassAssignment
from models.user import User
from services.early_departure_resolver import find_applicable_dismissal_policy, resolve_departure_status
from services.teacher_class_assignment import safe_error

ACTIVE_STATUSES = {"OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "MONITORING", "REOPENED"}
TERMINAL_STATUSES = {"RESOLVED", "DISMISSED"}

ALLOWED_TRANSITIONS = {
    "OPEN": {"ACKNOWLEDGED", "IN_PROGRESS", "DISMISSED"},
    "ACKNOWLEDGED": {"IN_PROGRESS", "MONITORING", "DISMISSED"},
    "IN_PROGRESS": {"MONITORING", "RESOLVED", "DISMISSED"},
    "MONITORING": {"IN_PROGRESS", "RESOLVED", "DISMISSED"},
    "RESOLVED": {"REOPENED"},
    "DISMISSED": {"REOPENED"},
    "REOPENED": {"ACKNOWLEDGED", "IN_PROGRESS", "DISMISSED"},
}


def generate_exception_key(
    exception_kind: str,
    student_master_id: Optional[int],
    date_or_period: Optional[str] = None,
    source_entity_id: Optional[str] = None,
) -> str:
    """Generate deterministic exception key based strictly on backend non-PII identifiers."""
    kind = exception_kind.strip().upper()
    sm_id = str(student_master_id) if student_master_id is not None else "0"
    dp = date_or_period or "no_date"
    src = source_entity_id or "0"
    return f"{kind}:{sm_id}:{dp}:{src}"


def _get_user_assigned_class_ids(db: Session, user: User, target_date: Optional[date] = None) -> Optional[set[int]]:
    """Return set of class_ids assigned to user, or None if user has global admin access."""
    if user.role == "admin" or "manage_all_attendance_followups" in getattr(user, "capabilities", set()):
        return None

    query = (
        db.query(TeacherClassAssignment.academic_class_id)
        .filter(
            TeacherClassAssignment.user_id == user.id,
            TeacherClassAssignment.active.is_(True),
        )
    )
    if target_date:
        query = query.filter(
            or_(TeacherClassAssignment.effective_from.is_(None), TeacherClassAssignment.effective_from <= target_date),
            or_(TeacherClassAssignment.effective_to.is_(None), TeacherClassAssignment.effective_to >= target_date),
        )
    rows = query.all()
    return {r[0] for r in rows}


def audit_followup_event(
    db: Session,
    *,
    actor: str,
    action: str,
    follow_up_id: Optional[int] = None,
    before_summary: Optional[Dict[str, Any]] = None,
    after_summary: Optional[Dict[str, Any]] = None,
    metadata_payload: Optional[Dict[str, Any]] = None,
) -> AttendanceFollowUpAudit:
    audit = AttendanceFollowUpAudit(
        follow_up_id=follow_up_id,
        actor=actor,
        action=action,
        before_summary=before_summary,
        after_summary=after_summary,
        metadata_payload=metadata_payload,
        schema_version=1,
    )
    db.add(audit)
    return audit


def serialize_followup(case: AttendanceFollowUp, include_notes: bool = True) -> Dict[str, Any]:
    notes_data = []
    if include_notes and case.notes:
        for n in case.notes:
            notes_data.append(
                {
                    "id": n.id,
                    "note_type": n.note_type,
                    "body": n.body,
                    "created_by_user_id": n.created_by_user_id,
                    "created_by_username": n.created_by_user.username if n.created_by_user else None,
                    "created_at": n.created_at.isoformat() if n.created_at else None,
                }
            )

    is_overdue = False
    if case.due_at and case.status in ACTIVE_STATUSES:
        now = datetime.now(timezone.utc)
        due = case.due_at if case.due_at.tzinfo else case.due_at.replace(tzinfo=timezone.utc)
        if now > due:
            is_overdue = True

    return {
        "id": case.id,
        "exception_key": case.exception_key,
        "exception_kind": case.exception_kind,
        "student_master_id": case.student_master_id,
        "student_name": case.student_master.full_name if case.student_master else None,
        "student_enrollment_id": case.student_enrollment_id,
        "attendance_id": case.attendance_id,
        "attendance_correction_request_id": case.attendance_correction_request_id,
        "early_departure_excuse_id": case.early_departure_excuse_id,
        "academic_class_id": case.academic_class_id,
        "class_name": case.academic_class.class_name if case.academic_class else None,
        "academic_year_id": case.academic_year_id,
        "exception_date": case.exception_date.isoformat() if case.exception_date else None,
        "period_start": case.period_start.isoformat() if case.period_start else None,
        "period_end": case.period_end.isoformat() if case.period_end else None,
        "source_snapshot": case.source_snapshot,
        "status": case.status,
        "priority": case.priority,
        "assigned_to_user_id": case.assigned_to_user_id,
        "assigned_to_username": case.assigned_to_user.username if case.assigned_to_user else None,
        "created_by_user_id": case.created_by_user_id,
        "acknowledged_by_user_id": case.acknowledged_by_user_id,
        "acknowledged_at": case.acknowledged_at.isoformat() if case.acknowledged_at else None,
        "resolved_by_user_id": case.resolved_by_user_id,
        "resolved_at": case.resolved_at.isoformat() if case.resolved_at else None,
        "resolution_code": case.resolution_code,
        "resolution_note": case.resolution_note,
        "due_at": case.due_at.isoformat() if case.due_at else None,
        "is_overdue": is_overdue,
        "version": case.version,
        "created_at": case.created_at.isoformat() if case.created_at else None,
        "updated_at": case.updated_at.isoformat() if case.updated_at else None,
        "notes": notes_data,
    }


def discover_exception_candidates(
    db: Session,
    user: User,
    *,
    class_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> List[Dict[str, Any]]:
    """Discover actionable attendance exception candidates derived from canonical resolvers."""
    assigned_class_ids = _get_user_assigned_class_ids(db, user)

    # 1. Fetch active materialized followups to attach to candidates
    active_cases = (
        db.query(AttendanceFollowUp)
        .filter(AttendanceFollowUp.status.in_(ACTIVE_STATUSES))
        .all()
    )
    cases_by_key = {c.exception_key: c for c in active_cases}

    candidates = []

    # Query attendance records
    att_query = (
        db.query(Attendance, Student, StudentEnrollment, AcademicClass)
        .join(Student, Student.id == Attendance.student_id)
        .outerjoin(
            StudentEnrollment,
            and_(
                StudentEnrollment.student_id == Student.id,
                StudentEnrollment.lifecycle_state == "ACTIVE",
            ),
        )
        .outerjoin(AcademicClass, AcademicClass.id == StudentEnrollment.academic_class_id)
    )

    if class_id:
        att_query = att_query.filter(StudentEnrollment.academic_class_id == class_id)
    elif assigned_class_ids is not None:
        if not assigned_class_ids:
            return []
        att_query = att_query.filter(StudentEnrollment.academic_class_id.in_(assigned_class_ids))

    if date_from:
        att_query = att_query.filter(Attendance.date >= date_from)
    if date_to:
        att_query = att_query.filter(Attendance.date <= date_to)

    attendance_rows = att_query.order_by(Attendance.date.desc()).all()

    # Pre-fetch overrides, pending corrections, and excuses
    att_ids = [att.id for att, _, _, _ in attendance_rows]
    override_map = {}
    pending_corr_map = {}
    excuse_map = {}

    if att_ids:
        ovrs = db.query(AttendanceOverride).filter(AttendanceOverride.attendance_id.in_(att_ids)).all()
        for o in ovrs:
            override_map[o.attendance_id] = o

        reqs = (
            db.query(AttendanceCorrectionRequest)
            .filter(
                AttendanceCorrectionRequest.attendance_id.in_(att_ids),
                AttendanceCorrectionRequest.state.in_({"DRAFT", "SUBMITTED", "PENDING_APPROVAL"}),
            )
            .all()
        )
        for r in reqs:
            pending_corr_map[r.attendance_id] = r

        excs = db.query(EarlyDepartureExcuse).filter(EarlyDepartureExcuse.attendance_id.in_(att_ids), EarlyDepartureExcuse.state == "ACTIVE").all()
        for e in excs:
            excuse_map[e.attendance_id] = e

    for att, std, enr, ac_class in attendance_rows:
        student_master_id = (enr.student_master_id if (enr and getattr(enr, "student_master_id", None)) else getattr(std, "student_master_id", None)) or str(std.id)
        ovr = override_map.get(att.id)
        pending_corr = pending_corr_map.get(att.id)
        excuse = excuse_map.get(att.id)

        eff_status = ovr.override_status if ovr else att.status
        eff_status_clean = (eff_status or "").lower()

        # Unexplained Absence
        if eff_status_clean in ("alfa", "absent") or (att.is_absent and eff_status_clean not in ("sakit", "izin")):
            key = generate_exception_key("UNEXPLAINED_ABSENCE", student_master_id, str(att.date), str(att.id))
            mat_case = cases_by_key.get(key)
            candidates.append(
                {
                    "exception_key": key,
                    "exception_kind": "UNEXPLAINED_ABSENCE",
                    "student_master_id": student_master_id,
                    "student_name": std.name,
                    "academic_class_id": ac_class.id if ac_class else None,
                    "class_name": ac_class.class_name if ac_class else None,
                    "exception_date": str(att.date),
                    "severity": "HIGH",
                    "evidence_summary": f"Unexplained absence recorded on {att.date}",
                    "source_entity": "attendance",
                    "source_id": att.id,
                    "materialized_case": serialize_followup(mat_case, include_notes=False) if mat_case else None,
                }
            )

        # Late Arrival
        elif eff_status_clean == "late" or (att.late_source and att.late_source != "none"):
            key = generate_exception_key("LATE_ARRIVAL", student_master_id, str(att.date), str(att.id))
            mat_case = cases_by_key.get(key)
            check_in_str = att.check_in.strftime("%H:%M") if att.check_in else "N/A"
            candidates.append(
                {
                    "exception_key": key,
                    "exception_kind": "LATE_ARRIVAL",
                    "student_master_id": student_master_id,
                    "student_name": std.name,
                    "academic_class_id": ac_class.id if ac_class else None,
                    "class_name": ac_class.class_name if ac_class else None,
                    "exception_date": str(att.date),
                    "severity": "MEDIUM",
                    "evidence_summary": f"Late arrival recorded at {check_in_str} on {att.date}",
                    "source_entity": "attendance",
                    "source_id": att.id,
                    "materialized_case": serialize_followup(mat_case, include_notes=False) if mat_case else None,
                }
            )

        # Early Departure or Missing Checkout
        jenjang_str = ac_class.jenjang if (ac_class and hasattr(ac_class, "jenjang")) else "SD"
        policy = find_applicable_dismissal_policy(db, jenjang_str, att.date)
        dep_res = resolve_departure_status(
            att,
            override=ovr,
            policy=policy,
            active_excuse=excuse,
            has_pending_correction=pending_corr is not None,
        )

        if dep_res["classification"] == "MISSING_CHECKOUT":
            key = generate_exception_key("MISSING_CHECKOUT", student_master_id, str(att.date), str(att.id))
            mat_case = cases_by_key.get(key)
            candidates.append(
                {
                    "exception_key": key,
                    "exception_kind": "MISSING_CHECKOUT",
                    "student_master_id": student_master_id,
                    "student_name": std.name,
                    "academic_class_id": ac_class.id if ac_class else None,
                    "class_name": ac_class.class_name if ac_class else None,
                    "exception_date": str(att.date),
                    "severity": "MEDIUM",
                    "evidence_summary": f"Check-in present but missing checkout on {att.date}",
                    "source_entity": "attendance",
                    "source_id": att.id,
                    "materialized_case": serialize_followup(mat_case, include_notes=False) if mat_case else None,
                }
            )

        elif dep_res["classification"] == "EARLY_DEPARTURE":
            key = generate_exception_key("UNEXPLAINED_EARLY_DEPARTURE", student_master_id, str(att.date), str(att.id))
            mat_case = cases_by_key.get(key)
            mins = dep_res.get("minutes_early", 0)
            candidates.append(
                {
                    "exception_key": key,
                    "exception_kind": "UNEXPLAINED_EARLY_DEPARTURE",
                    "student_master_id": student_master_id,
                    "student_name": std.name,
                    "academic_class_id": ac_class.id if ac_class else None,
                    "class_name": ac_class.class_name if ac_class else None,
                    "exception_date": str(att.date),
                    "severity": "HIGH" if mins > 30 else "MEDIUM",
                    "evidence_summary": f"Unexplained early departure by {mins} mins on {att.date}",
                    "source_entity": "attendance",
                    "source_id": att.id,
                    "materialized_case": serialize_followup(mat_case, include_notes=False) if mat_case else None,
                }
            )

        # Pending Correction
        if pending_corr:
            key = generate_exception_key("PENDING_CORRECTION", student_master_id, str(att.date), str(pending_corr.id))
            mat_case = cases_by_key.get(key)
            candidates.append(
                {
                    "exception_key": key,
                    "exception_kind": "PENDING_CORRECTION",
                    "student_master_id": student_master_id,
                    "student_name": std.name,
                    "academic_class_id": ac_class.id if ac_class else None,
                    "class_name": ac_class.class_name if ac_class else None,
                    "exception_date": str(att.date),
                    "severity": "MEDIUM",
                    "evidence_summary": f"Pending attendance correction request #{pending_corr.id} submitted on {att.date}",
                    "source_entity": "attendance_correction_requests",
                    "source_id": pending_corr.id,
                    "materialized_case": serialize_followup(mat_case, include_notes=False) if mat_case else None,
                }
            )

    # 2. Unmatched Device Identities
    unmatched_devices = (
        db.query(StudentDeviceIdentity)
        .filter(or_(StudentDeviceIdentity.student_master_id.is_(None), StudentDeviceIdentity.legacy_student_id.is_(None)), StudentDeviceIdentity.is_active.is_(True))
        .all()
    )
    for dev in unmatched_devices:
        key = generate_exception_key("UNMATCHED_DEVICE_IDENTITY", None, "active", str(dev.id))
        mat_case = cases_by_key.get(key)
        candidates.append(
            {
                "exception_key": key,
                "exception_kind": "UNMATCHED_DEVICE_IDENTITY",
                "student_master_id": None,
                "student_name": "Unmatched Device",
                "academic_class_id": None,
                "class_name": None,
                "exception_date": None,
                "severity": "HIGH",
                "evidence_summary": f"Unmatched card identity #{dev.device_identifier} requires student mapping",
                "source_entity": "student_device_identities",
                "source_id": dev.id,
                "materialized_case": serialize_followup(mat_case, include_notes=False) if mat_case else None,
            }
        )

    return candidates


def create_or_materialize_followup(
    db: Session,
    user: User,
    *,
    exception_key: str,
    exception_kind: str,
    student_master_id: Optional[int] = None,
    student_enrollment_id: Optional[int] = None,
    attendance_id: Optional[int] = None,
    attendance_correction_request_id: Optional[int] = None,
    early_departure_excuse_id: Optional[int] = None,
    academic_class_id: Optional[int] = None,
    academic_year_id: Optional[int] = None,
    exception_date: Optional[date] = None,
    period_start: Optional[date] = None,
    period_end: Optional[date] = None,
    source_snapshot: Optional[Dict[str, Any]] = None,
    priority: str = "MEDIUM",
    assigned_to_user_id: Optional[int] = None,
    due_at: Optional[datetime] = None,
) -> AttendanceFollowUp:
    """Create or materialize a persistent follow-up case."""
    # 1. Scoping check
    assigned_class_ids = _get_user_assigned_class_ids(db, user, target_date=exception_date)
    if assigned_class_ids is not None and academic_class_id and academic_class_id not in assigned_class_ids:
        audit_followup_event(
            db,
            actor=user.username,
            action="ACCESS_DENIED",
            metadata_payload={"reason": "ATTENDANCE_FOLLOWUP_SCOPE_FORBIDDEN", "class_id": academic_class_id},
        )
        db.commit()
        raise safe_error(403, "ATTENDANCE_FOLLOWUP_SCOPE_FORBIDDEN", "You are not assigned to manage follow-ups for this class.")

    # 2. Check for open case duplicate
    existing_open = (
        db.query(AttendanceFollowUp)
        .filter(
            AttendanceFollowUp.exception_key == exception_key,
            AttendanceFollowUp.status.in_(ACTIVE_STATUSES),
        )
        .first()
    )
    if existing_open:
        raise safe_error(
            400,
            "ATTENDANCE_FOLLOWUP_DUPLICATE_OPEN_CASE",
            f"An active follow-up case already exists for exception key '{exception_key}'.",
        )

    # 3. Check assignee user
    if assigned_to_user_id:
        target_user = db.get(User, assigned_to_user_id)
        if not target_user or not target_user.is_active:
            raise safe_error(400, "ATTENDANCE_FOLLOWUP_ASSIGNEE_FORBIDDEN", "Target assignee user was not found or is inactive.")

    case = AttendanceFollowUp(
        exception_key=exception_key,
        exception_kind=exception_kind.upper(),
        student_master_id=student_master_id,
        student_enrollment_id=student_enrollment_id,
        attendance_id=attendance_id,
        attendance_correction_request_id=attendance_correction_request_id,
        early_departure_excuse_id=early_departure_excuse_id,
        academic_class_id=academic_class_id,
        academic_year_id=academic_year_id,
        exception_date=exception_date,
        period_start=period_start,
        period_end=period_end,
        source_snapshot=source_snapshot or {},
        status="OPEN",
        priority=priority.upper(),
        assigned_to_user_id=assigned_to_user_id,
        created_by_user_id=user.id,
        due_at=due_at,
        version=1,
    )
    db.add(case)
    db.flush()

    audit_followup_event(
        db,
        actor=user.username,
        action="CREATE",
        follow_up_id=case.id,
        after_summary=serialize_followup(case, include_notes=False),
    )

    db.commit()
    db.refresh(case)
    return case


def _verify_case_access(db: Session, user: User, case: AttendanceFollowUp, action_name: str = "update") -> None:
    assigned_class_ids = _get_user_assigned_class_ids(db, user, target_date=case.exception_date)
    if assigned_class_ids is not None and case.academic_class_id and case.academic_class_id not in assigned_class_ids:
        audit_followup_event(
            db,
            actor=user.username,
            action="ACCESS_DENIED",
            follow_up_id=case.id,
            metadata_payload={"reason": "ATTENDANCE_FOLLOWUP_SCOPE_FORBIDDEN", "action": action_name},
        )
        db.commit()
        raise safe_error(403, "ATTENDANCE_FOLLOWUP_SCOPE_FORBIDDEN", "You do not have permission to access this follow-up case.")


def update_case_workflow_state(
    db: Session,
    user: User,
    case_id: int,
    *,
    target_status: str,
    version: Optional[int] = None,
    resolution_code: Optional[str] = None,
    resolution_note: Optional[str] = None,
    assigned_to_user_id: Optional[int] = None,
    priority: Optional[str] = None,
    due_at: Optional[datetime] = None,
) -> AttendanceFollowUp:
    case = db.get(AttendanceFollowUp, case_id)
    if not case:
        raise safe_error(404, "ATTENDANCE_FOLLOWUP_NOT_FOUND", f"Follow-up case #{case_id} not found.")

    _verify_case_access(db, user, case, action_name=target_status.lower())

    # Optimistic concurrency check
    if version is not None and case.version != version:
        audit_followup_event(
            db,
            actor=user.username,
            action="STALE_UPDATE_REJECTED",
            follow_up_id=case.id,
            metadata_payload={"expected_version": version, "actual_version": case.version},
        )
        db.commit()
        raise safe_error(409, "ATTENDANCE_FOLLOWUP_STALE_VERSION", f"Stale version conflict on case #{case.id}. Refresh and retry.")

    target_status = target_status.upper()
    if target_status != case.status:
        allowed = ALLOWED_TRANSITIONS.get(case.status, set())
        if target_status not in allowed:
            raise safe_error(
                400,
                "ATTENDANCE_FOLLOWUP_INVALID_TRANSITION",
                f"Cannot transition case #{case.id} from '{case.status}' to '{target_status}'.",
            )

    before_summary = serialize_followup(case, include_notes=False)

    now = datetime.now(timezone.utc)

    # Specific state requirements
    if target_status == "ACKNOWLEDGED" and case.status != "ACKNOWLEDGED":
        case.acknowledged_by_user_id = user.id
        case.acknowledged_at = now
        action_name = "ACKNOWLEDGE"
    elif target_status == "IN_PROGRESS":
        action_name = "START_PROGRESS"
    elif target_status == "MONITORING":
        action_name = "MONITOR"
    elif target_status == "RESOLVED":
        if not resolution_code or not resolution_code.strip():
            raise safe_error(400, "ATTENDANCE_FOLLOWUP_RESOLUTION_REQUIRED", "resolution_code is required to resolve a case.")
        case.resolved_by_user_id = user.id
        case.resolved_at = now
        case.resolution_code = resolution_code.strip().upper()
        case.resolution_note = resolution_note.strip() if resolution_note else None
        action_name = "RESOLVE"
    elif target_status == "DISMISSED":
        if not resolution_note or not resolution_note.strip():
            raise safe_error(400, "ATTENDANCE_FOLLOWUP_RESOLUTION_REQUIRED", "Explanation is required to dismiss a case.")
        case.resolved_by_user_id = user.id
        case.resolved_at = now
        case.resolution_code = resolution_code.strip().upper() if resolution_code else "DISMISSED"
        case.resolution_note = resolution_note.strip()
        action_name = "DISMISS"
    elif target_status == "REOPENED":
        if not resolution_note or not resolution_note.strip():
            raise safe_error(400, "ATTENDANCE_FOLLOWUP_REOPEN_REASON_REQUIRED", "Reopen reason is required to reopen a resolved case.")
        case.resolved_by_user_id = None
        case.resolved_at = None
        case.resolution_code = None
        action_name = "REOPEN"
    else:
        action_name = "UPDATE"

    case.status = target_status

    if assigned_to_user_id is not None and assigned_to_user_id != case.assigned_to_user_id:
        target_user = db.get(User, assigned_to_user_id)
        if not target_user or not target_user.is_active:
            raise safe_error(400, "ATTENDANCE_FOLLOWUP_ASSIGNEE_FORBIDDEN", "Target assignee user not found or inactive.")
        case.assigned_to_user_id = assigned_to_user_id
        action_name = "REASSIGN" if case.assigned_to_user_id else "ASSIGN"

    if priority:
        case.priority = priority.upper()
    if due_at:
        case.due_at = due_at

    case.version += 1
    case.updated_at = now

    after_summary = serialize_followup(case, include_notes=False)

    audit_followup_event(
        db,
        actor=user.username,
        action=action_name,
        follow_up_id=case.id,
        before_summary=before_summary,
        after_summary=after_summary,
    )

    db.commit()
    db.refresh(case)
    return case


def add_case_note(
    db: Session,
    user: User,
    case_id: int,
    *,
    body: str,
    note_type: str = "INTERNAL_NOTE",
) -> AttendanceFollowUpNote:
    case = db.get(AttendanceFollowUp, case_id)
    if not case:
        raise safe_error(404, "ATTENDANCE_FOLLOWUP_NOT_FOUND", f"Follow-up case #{case_id} not found.")

    _verify_case_access(db, user, case, action_name="add_note")

    note = AttendanceFollowUpNote(
        follow_up_id=case.id,
        note_type=note_type.strip().upper(),
        body=body.strip(),
        created_by_user_id=user.id,
    )
    db.add(note)
    db.flush()

    audit_followup_event(
        db,
        actor=user.username,
        action="ADD_NOTE",
        follow_up_id=case.id,
        metadata_payload={"note_id": note.id, "note_type": note.note_type},
    )

    db.commit()
    db.refresh(note)
    return note


def query_followup_cases(
    db: Session,
    user: User,
    *,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    exception_kind: Optional[str] = None,
    assigned_to_user_id: Optional[int] = None,
    academic_class_id: Optional[int] = None,
    is_overdue: Optional[bool] = None,
    unassigned_only: bool = False,
    my_cases_only: bool = False,
) -> List[AttendanceFollowUp]:
    assigned_class_ids = _get_user_assigned_class_ids(db, user)

    query = db.query(AttendanceFollowUp)

    if academic_class_id:
        if assigned_class_ids is not None and academic_class_id not in assigned_class_ids:
            return []
        query = query.filter(AttendanceFollowUp.academic_class_id == academic_class_id)
    elif assigned_class_ids is not None:
        if not assigned_class_ids:
            return []
        query = query.filter(
            or_(
                AttendanceFollowUp.academic_class_id.in_(assigned_class_ids),
                AttendanceFollowUp.academic_class_id.is_(None),
            )
        )

    if status:
        query = query.filter(AttendanceFollowUp.status == status.upper())
    if priority:
        query = query.filter(AttendanceFollowUp.priority == priority.upper())
    if exception_kind:
        query = query.filter(AttendanceFollowUp.exception_kind == exception_kind.upper())

    if unassigned_only:
        query = query.filter(AttendanceFollowUp.assigned_to_user_id.is_(None))
    elif my_cases_only:
        query = query.filter(AttendanceFollowUp.assigned_to_user_id == user.id)
    elif assigned_to_user_id:
        query = query.filter(AttendanceFollowUp.assigned_to_user_id == assigned_to_user_id)

    now = datetime.now(timezone.utc)
    if is_overdue is True:
        query = query.filter(
            AttendanceFollowUp.due_at.isnot(None),
            AttendanceFollowUp.due_at < now,
            AttendanceFollowUp.status.in_(ACTIVE_STATUSES),
        )
    elif is_overdue is False:
        query = query.filter(
            or_(
                AttendanceFollowUp.due_at.is_(None),
                AttendanceFollowUp.due_at >= now,
                AttendanceFollowUp.status.in_(TERMINAL_STATUSES),
            )
        )

    return query.order_by(AttendanceFollowUp.created_at.desc()).all()


def get_followup_metrics(db: Session, user: User) -> Dict[str, Any]:
    cases = query_followup_cases(db, user)
    now = datetime.now(timezone.utc)

    open_cases = 0
    unassigned_cases = 0
    overdue_cases = 0
    reopened_count = 0
    resolved_count = 0
    dismissed_count = 0

    by_kind = {}
    by_priority = {}
    by_class = {}

    ack_times = []
    res_times = []

    for c in cases:
        if c.status in ACTIVE_STATUSES:
            open_cases += 1
            if not c.assigned_to_user_id:
                unassigned_cases += 1
            if c.due_at and c.due_at.replace(tzinfo=timezone.utc) < now:
                overdue_cases += 1

        if c.status == "REOPENED":
            reopened_count += 1
        elif c.status == "RESOLVED":
            resolved_count += 1
        elif c.status == "DISMISSED":
            dismissed_count += 1

        by_kind[c.exception_kind] = by_kind.get(c.exception_kind, 0) + 1
        by_priority[c.priority] = by_priority.get(c.priority, 0) + 1

        cls_label = c.academic_class.class_name if c.academic_class else "Global / Unassigned"
        by_class[cls_label] = by_class.get(cls_label, 0) + 1

        if c.acknowledged_at and c.created_at:
            created_dt = c.created_at if c.created_at.tzinfo else c.created_at.replace(tzinfo=timezone.utc)
            ack_dt = c.acknowledged_at if c.acknowledged_at.tzinfo else c.acknowledged_at.replace(tzinfo=timezone.utc)
            ack_times.append((ack_dt - created_dt).total_seconds())

        if c.resolved_at and c.created_at:
            created_dt = c.created_at if c.created_at.tzinfo else c.created_at.replace(tzinfo=timezone.utc)
            res_dt = c.resolved_at if c.resolved_at.tzinfo else c.resolved_at.replace(tzinfo=timezone.utc)
            res_times.append((res_dt - created_dt).total_seconds())

    avg_ack = sum(ack_times) / len(ack_times) if ack_times else 0.0
    avg_res = sum(res_times) / len(res_times) if res_times else 0.0

    return {
        "open_cases": open_cases,
        "unassigned_cases": unassigned_cases,
        "overdue_cases": overdue_cases,
        "reopened_count": reopened_count,
        "resolved_count": resolved_count,
        "dismissed_count": dismissed_count,
        "by_kind": by_kind,
        "by_priority": by_priority,
        "by_class": by_class,
        "avg_acknowledgement_time_seconds": round(avg_ack, 2),
        "avg_resolution_time_seconds": round(avg_res, 2),
    }
