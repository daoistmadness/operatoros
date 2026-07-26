"""Operator Work Queue Service for Single-Operator Offline Workflow.

Aggregates actionable items across canonical sources:
- Attendance follow-up candidates
- Materialized follow-up cases
- Active correction requests
- Unmatched device identities
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from core.config import settings
from models.attendance import Attendance
from models.attendance_followup import AttendanceFollowUp
from models.attendance_review import AttendanceCorrectionRequest
from models.student import Student
from models.student_master import StudentDeviceIdentity, StudentMaster
from models.user import User
from services.attendance_followup_service import (
    ACTIVE_STATUSES,
    discover_exception_candidates,
)


def derive_due_state(due_at: datetime | None, status: str | None) -> str:
    if status in ("RESOLVED", "DISMISSED", "APPROVED", "REJECTED", "CANCELLED", "COMPLETED"):
        return "COMPLETED"
    if due_at is None:
        return "NO_DUE_DATE"
    now_utc = datetime.now(timezone.utc)
    # Ensure due_at is timezone-aware if comparing with now_utc
    if due_at.tzinfo is None:
        due_at_utc = due_at.replace(tzinfo=timezone.utc)
    else:
        due_at_utc = due_at
    
    if due_at_utc < now_utc and due_at_utc.date() < now_utc.date():
        return "OVERDUE"
    if due_at_utc.date() == now_utc.date():
        return "DUE_TODAY"
    if due_at_utc > now_utc:
        return "DUE_LATER"
    return "OVERDUE"


def build_operator_work_queue(db: Session, user: User) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    is_single_user = settings.resolved_deployment_mode == "single_user_offline"

    # 1. Materialized Follow-Up Cases
    followup_query = db.query(AttendanceFollowUp)
    if not is_single_user and user.role != "admin":
        followup_query = followup_query.filter(
            or_(AttendanceFollowUp.assigned_to_user_id == user.id, AttendanceFollowUp.assigned_to_user_id.is_(None))
        )
    followup_cases = followup_query.order_by(AttendanceFollowUp.created_at.desc()).all()
    
    existing_keys = set()
    for case in followup_cases:
        existing_keys.add(case.exception_key)
        due_state = derive_due_state(case.due_at, case.status)
        student_label = case.student_master.full_name if case.student_master else "Siswa/Tergantung"
        
        # Auto-assign in single-user mode if unassigned
        if is_single_user and case.assigned_to_user_id is None and case.status in ACTIVE_STATUSES:
            case.assigned_to_user_id = user.id
            db.flush()

        items.append({
            "item_type": "FOLLOWUP_CASE",
            "source_id": f"followup-{case.id}",
            "deduplication_key": case.exception_key,
            "student_reference": case.student_master_id,
            "student_display_label": student_label,
            "class_reference": case.academic_class.class_name if case.academic_class else None,
            "jenjang_reference": case.academic_class.grade.jenjang.name if (case.academic_class and case.academic_class.grade and case.academic_class.grade.jenjang) else None,
            "event_date": case.exception_date.isoformat() if case.exception_date else None,
            "title": f"Follow-Up: {case.exception_kind.replace('_', ' ').title()}",
            "evidence_summary": case.source_snapshot.get("summary") if case.source_snapshot else "Kasus follow-up kehadiran.",
            "workflow_status": case.status,
            "priority": case.priority,
            "due_at": case.due_at.isoformat() if case.due_at else None,
            "derived_due_state": due_state,
            "available_actions": ["view_detail", "add_note", "update_status", "set_due_date"],
            "source_route": f"/attendance/followups?case_id={case.id}",
            "last_activity_timestamp": case.updated_at.isoformat() if case.updated_at else None,
            "metadata": {
                "id": case.id,
                "version": case.version,
                "assigned_to_user_id": case.assigned_to_user_id,
            }
        })

    # 2. Derived Candidates (not yet materialized)
    candidates = discover_exception_candidates(db, user)
    for cand in candidates:
        if cand["exception_key"] in existing_keys:
            continue
        items.append({
            "item_type": "FOLLOWUP_CANDIDATE",
            "source_id": f"cand-{cand['exception_key']}",
            "deduplication_key": cand["exception_key"],
            "student_reference": cand.get("student_master_id"),
            "student_display_label": cand.get("student_name") or "Siswa",
            "class_reference": cand.get("class_name"),
            "jenjang_reference": cand.get("jenjang"),
            "event_date": cand.get("exception_date"),
            "title": f"Kandidat: {cand['exception_kind'].replace('_', ' ').title()}",
            "evidence_summary": cand.get("summary", "Eksplorasi kandidat pengecualian kehadiran."),
            "workflow_status": "DISCOVERED",
            "priority": cand.get("priority", "MEDIUM"),
            "due_at": None,
            "derived_due_state": "NO_DUE_DATE",
            "available_actions": ["materialize_case"],
            "source_route": "/attendance/followups",
            "last_activity_timestamp": datetime.now(timezone.utc).isoformat(),
            "metadata": cand,
        })

    # 3. Active Correction Requests
    corrections = db.query(AttendanceCorrectionRequest).filter(
        AttendanceCorrectionRequest.state.in_(("SUBMITTED", "DRAFT"))
    ).all()
    for corr in corrections:
        att = db.get(Attendance, corr.attendance_id)
        student_label = "Siswa"
        class_name = None
        if att and att.student:
            student_label = att.student.name
            class_name = att.student.class_name

        due_state = "DUE_TODAY" if corr.state == "SUBMITTED" else "DUE_LATER"
        items.append({
            "item_type": "CORRECTION_REQUEST",
            "source_id": f"correction-{corr.id}",
            "deduplication_key": f"correction-{corr.id}",
            "student_reference": str(att.student_id) if att else None,
            "student_display_label": student_label,
            "class_reference": class_name,
            "jenjang_reference": None,
            "event_date": att.date.isoformat() if att else None,
            "title": f"Koreksi: Status {corr.proposed_status}",
            "evidence_summary": f"Alasan ({corr.reason_code}): {corr.explanation}",
            "workflow_status": corr.state,
            "priority": "HIGH" if corr.state == "SUBMITTED" else "MEDIUM",
            "due_at": corr.submitted_at.isoformat() if corr.submitted_at else None,
            "derived_due_state": due_state,
            "available_actions": ["self_confirm", "approve", "reject", "cancel"] if is_single_user else ["approve", "reject", "cancel"],
            "source_route": f"/attendance/corrections?id={corr.id}",
            "last_activity_timestamp": corr.updated_at.isoformat() if corr.updated_at else None,
            "metadata": {
                "id": corr.id,
                "version": corr.version,
                "requester": corr.requester,
            }
        })

    # 4. Unmatched Device Identities
    unmatched = db.query(StudentDeviceIdentity).filter(
        or_(StudentDeviceIdentity.student_master_id.is_(None), StudentDeviceIdentity.legacy_student_id.is_(None)),
        StudentDeviceIdentity.is_active.is_(True)
    ).all()
    for dev in unmatched:
        items.append({
            "item_type": "UNMATCHED_DEVICE",
            "source_id": f"device-{dev.id}",
            "deduplication_key": f"device-{dev.id}",
            "student_reference": None,
            "student_display_label": f"Perangkat ({dev.device_identifier})",
            "class_reference": None,
            "jenjang_reference": None,
            "event_date": dev.effective_from.isoformat() if dev.effective_from else None,
            "title": f"Perangkat Belum Terhubung: {dev.device_identifier}",
            "evidence_summary": f"Sumber: {dev.device_source}. Kartu/perangkat rfid belum ditautkan ke siswa.",
            "workflow_status": "UNMATCHED",
            "priority": "HIGH",
            "due_at": None,
            "derived_due_state": "DUE_TODAY",
            "available_actions": ["link_student"],
            "source_route": "/upload-center",
            "last_activity_timestamp": datetime.now(timezone.utc).isoformat(),
            "metadata": {
                "id": dev.id,
                "device_identifier": dev.device_identifier,
            }
        })

    # Sort items: OVERDUE -> DUE_TODAY -> DUE_LATER -> NO_DUE_DATE -> COMPLETED
    state_order = {"OVERDUE": 0, "DUE_TODAY": 1, "DUE_LATER": 2, "NO_DUE_DATE": 3, "COMPLETED": 4}
    items.sort(key=lambda x: (state_order.get(x["derived_due_state"], 5), x["last_activity_timestamp"] or ""), reverse=False)

    return items
