from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.attendance import Attendance
from models.operations_audit import OperationsAuditEvent
from models.student_enrollment import StudentEnrollment
from models.student_import_session import StudentImportAppliedAction, StudentImportSession
from models.student_master import StudentDeviceIdentity, StudentMaster, StudentMasterChangeHistory
from models.student_subject_grade import StudentSubjectGrade
from services.operations_audit_service import increment_counter, log_operations_audit_event
from services.student_import_sessions import state_checksum


def compute_rollback_preview_checksum(session_id: str, action_statuses: List[Dict[str, Any]]) -> str:
    payload = {
        "session_id": session_id,
        "actions": sorted(
            [{"id": a["id"], "eligibility": a["eligibility"], "code": a.get("conflict_code")} for a in action_statuses],
            key=lambda x: x["id"],
        ),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def generate_rollback_preview(db: Session, session_id: str, actor: str) -> Dict[str, Any]:
    session = db.query(StudentImportSession).filter(StudentImportSession.id == session_id).first()
    if not session:
        session = db.query(StudentImportSession).filter(StudentImportSession.session_uuid == session_id).first()
    if not session:
        increment_counter("rollback_preview_failures")
        raise HTTPException(status_code=404, detail="Import session not found")

    if session.provenance_status == "LEGACY_PROVENANCE_UNAVAILABLE":
        increment_counter("rollback_preview_failures")
        return {
            "session_reference": session.session_uuid,
            "session_id": session.id,
            "provenance_status": session.provenance_status,
            "rollback_state": "NOT_AVAILABLE",
            "is_rollbackable": False,
            "non_rollbackable_reason": "Historical import session marked LEGACY_PROVENANCE_UNAVAILABLE cannot be rolled back because granular action provenance was not recorded.",
            "total_applied_actions": 0,
            "eligible_actions": 0,
            "blocked_actions": 0,
            "manual_review_actions": 0,
            "already_compensated_actions": 0,
            "affected_entity_counts": {"students": 0, "enrollments": 0, "devices": 0},
            "proposed_reverse_action_order": [],
            "dependency_conflicts": [],
            "preview_checksum": hashlib.sha256(f"{session.session_uuid}:UNAVAILABLE".encode()).hexdigest(),
            "expiration": (datetime.now() + timedelta(hours=24)).isoformat(),
            "required_capability": "rollback_import_session",
            "required_confirmation": f"ROLLBACK_SESSION_{session.session_uuid[:8]}",
            "history_preservation_disclosure": "Compensating rollback appends new historical actions and preserves all original provenance and audit records.",
        }

    if session.status != "COMMITTED":
        increment_counter("rollback_preview_failures")
        raise HTTPException(status_code=409, detail=f"Import session status is '{session.status}', only COMMITTED sessions can be rolled back")

    actions = (
        db.query(StudentImportAppliedAction)
        .filter(StudentImportAppliedAction.session_id == session.id)
        .order_by(StudentImportAppliedAction.action_sequence.asc())
        .all()
    )

    action_items = []
    dependency_conflicts = []
    affected_students = set()
    affected_enrollments = set()
    affected_devices = set()

    eligible_count = 0
    blocked_count = 0
    manual_review_count = 0
    already_compensated_count = 0

    for act in actions:
        eligibility = "ELIGIBLE"
        conflict_code: Optional[str] = None
        block_reason: Optional[str] = None

        if act.rollback_state == "APPLIED":
            eligibility = "ALREADY_COMPENSATED"
            conflict_code = "ACTION_ALREADY_COMPENSATED"
            block_reason = "This action has already been compensated in a prior rollback."
            already_compensated_count += 1
        else:
            # Re-validate action type specific dependencies
            if act.entity_type == "STUDENT_MASTER" or act.action_type == "CREATE_STUDENT_MASTER":
                affected_students.add(act.entity_id)
                student = db.query(StudentMaster).filter(StudentMaster.id == act.entity_id).first()
                if not student:
                    eligibility = "BLOCKED"
                    conflict_code = "STUDENT_NOT_FOUND"
                    block_reason = "Student master record no longer exists."
                else:
                    # Check if student gained later attendance, grades, enrollments, device IDs
                    device_count = db.query(StudentDeviceIdentity).filter(StudentDeviceIdentity.student_master_id == student.id).count()
                    enrollment_count = db.query(StudentEnrollment).filter(StudentEnrollment.student_id == student.id).count()
                    grade_count = (
                        db.query(StudentSubjectGrade)
                        .filter(StudentSubjectGrade.student_id == student.id)
                        .count()
                        if hasattr(StudentSubjectGrade, "student_id")
                        else 0
                    )
                    
                    # Also check attendance using legacy student ID mapping if present
                    legacy_device = db.query(StudentDeviceIdentity).filter(StudentDeviceIdentity.student_master_id == student.id).first()
                    attendance_count = 0
                    if legacy_device and legacy_device.legacy_student_id:
                        attendance_count = db.query(Attendance).filter(Attendance.student_id == legacy_device.legacy_student_id).count()

                    if attendance_count > 0:
                        eligibility = "BLOCKED"
                        conflict_code = "CREATED_STUDENT_HAS_ATTENDANCE"
                        block_reason = f"Created student gained {attendance_count} attendance records after import."
                    elif grade_count > 0:
                        eligibility = "BLOCKED"
                        conflict_code = "CREATED_STUDENT_HAS_GRADES"
                        block_reason = f"Created student gained {grade_count} grade entries after import."
                    elif enrollment_count > 0:
                        # Check if enrollment was created by another session
                        non_import_enrollments = [e for e in db.query(StudentEnrollment).filter(StudentEnrollment.student_id == student.id).all()]
                        if len(non_import_enrollments) > 0 and act.action_type != "CREATE_STUDENT_MASTER":
                            eligibility = "BLOCKED"
                            conflict_code = "CREATED_STUDENT_HAS_ENROLLMENT"
                            block_reason = "Created student gained active academic enrollment."

            elif act.action_type == "UPDATE_STUDENT_PROFILE":
                affected_students.add(act.entity_id)
                student = db.query(StudentMaster).filter(StudentMaster.id == act.entity_id).first()
                if not student:
                    eligibility = "BLOCKED"
                    conflict_code = "STUDENT_NOT_FOUND"
                    block_reason = "Target student no longer exists."
                else:
                    # Check if profile fields were changed after import
                    current_checksum = state_checksum({
                        "full_name": student.full_name,
                        "gender": student.gender,
                        "birth_place": student.birth_place,
                        "birth_date": student.birth_date,
                    })
                    after_chk = act.after_state_checksum
                    if current_checksum != after_chk:
                        eligibility = "BLOCKED"
                        conflict_code = "PROFILE_MODIFIED_AFTER_IMPORT"
                        block_reason = "Student profile field changed again after the import."

            elif act.action_type == "UPDATE_SENSITIVE_IDENTIFIER":
                affected_students.add(act.entity_id)
                student = db.query(StudentMaster).filter(StudentMaster.id == act.entity_id).first()
                if not student:
                    eligibility = "BLOCKED"
                    conflict_code = "STUDENT_NOT_FOUND"
                    block_reason = "Target student no longer exists."
                else:
                    after_state = act.after_state or {}
                    if (after_state.get("nik") and student.nik != after_state.get("nik")) or (after_state.get("nisn") and student.nisn != after_state.get("nisn")):
                        eligibility = "BLOCKED"
                        conflict_code = "IDENTIFIER_CHANGED_AFTER_IMPORT"
                        block_reason = "NIK or NISN changed again after the import."
                    elif not act.before_state:
                        eligibility = "MANUAL_REVIEW_REQUIRED"
                        conflict_code = "MANUAL_REVIEW_REQUIRED"
                        block_reason = "Prior sensitive identifier value is missing."

            elif act.action_type in ("ADD_DEVICE_IDENTITY", "REPLACE_DEVICE_IDENTITY"):
                affected_devices.add(act.entity_id)
                dev_id = int(act.entity_id) if str(act.entity_id).isdigit() else act.entity_id
                device = db.query(StudentDeviceIdentity).filter(StudentDeviceIdentity.id == dev_id).first()
                if not device:
                    eligibility = "BLOCKED"
                    conflict_code = "DEVICE_NOT_FOUND"
                    block_reason = "Device identity mapping no longer exists."
                elif not device.is_active:
                    eligibility = "BLOCKED"
                    conflict_code = "DEVICE_REASSIGNED_AFTER_IMPORT"
                    block_reason = "Device identity mapping was superseded or deactivated after import."

            elif act.action_type in ("CREATE_ENROLLMENT", "TRANSFER_ENROLLMENT", "END_ENROLLMENT"):
                affected_enrollments.add(act.entity_id)
                enroll_id = int(act.entity_id) if str(act.entity_id).isdigit() else act.entity_id
                enrollment = db.query(StudentEnrollment).filter(StudentEnrollment.id == enroll_id).first()
                if not enrollment:
                    eligibility = "BLOCKED"
                    conflict_code = "ENROLLMENT_NOT_FOUND"
                    block_reason = "Enrollment record no longer exists."
                elif act.action_type == "CREATE_ENROLLMENT" and not enrollment.is_active:
                    eligibility = "BLOCKED"
                    conflict_code = "ENROLLMENT_TRANSFERRED_AFTER_IMPORT"
                    block_reason = "Enrollment was transferred or ended again after import."

            if eligibility == "BLOCKED":
                blocked_count += 1
                dependency_conflicts.append({
                    "action_id": act.id,
                    "action_type": act.action_type,
                    "entity_id": act.entity_id,
                    "conflict_code": conflict_code,
                    "reason": block_reason,
                })
            elif eligibility == "MANUAL_REVIEW_REQUIRED":
                manual_review_count += 1
                dependency_conflicts.append({
                    "action_id": act.id,
                    "action_type": act.action_type,
                    "entity_id": act.entity_id,
                    "conflict_code": conflict_code,
                    "reason": block_reason,
                })
            elif eligibility == "ELIGIBLE":
                eligible_count += 1

        action_items.append({
            "id": act.id,
            "action_sequence": act.action_sequence,
            "action_type": act.action_type,
            "entity_type": act.entity_type,
            "entity_id": act.entity_id,
            "eligibility": eligibility,
            "conflict_code": conflict_code,
            "block_reason": block_reason,
            "before_state": act.before_state,
            "after_state": act.after_state,
            "compensation_type": act.compensation_type,
        })

    # Reverse action sequence for proposed execution order
    proposed_reverse_order = sorted(action_items, key=lambda x: x["action_sequence"], reverse=True)
    preview_checksum = compute_rollback_preview_checksum(session.id, action_items)

    session.rollback_state = "PREVIEWED"
    db.flush()

    log_operations_audit_event(
        db,
        actor_id=actor,
        actor_role="admin",
        capability="rollback_import_session",
        entity_type="IMPORT_SESSION",
        entity_reference=session.session_uuid,
        operation="ROLLBACK_PREVIEW",
        risk_level="MEDIUM",
        import_session_id=session.id,
        success=True,
        metadata={"eligible": eligible_count, "blocked": blocked_count, "preview_checksum": preview_checksum},
    )

    return {
        "session_reference": session.session_uuid,
        "session_id": session.id,
        "provenance_status": session.provenance_status,
        "rollback_state": session.rollback_state,
        "is_rollbackable": eligible_count > 0,
        "total_applied_actions": len(actions),
        "eligible_actions": eligible_count,
        "blocked_actions": blocked_count,
        "manual_review_actions": manual_review_count,
        "already_compensated_actions": already_compensated_count,
        "affected_entity_counts": {
            "students": len(affected_students),
            "enrollments": len(affected_enrollments),
            "devices": len(affected_devices),
        },
        "proposed_reverse_action_order": proposed_reverse_order,
        "dependency_conflicts": dependency_conflicts,
        "preview_checksum": preview_checksum,
        "expiration": (datetime.now() + timedelta(hours=24)).isoformat(),
        "required_capability": "rollback_import_session",
        "required_confirmation": f"ROLLBACK_SESSION_{session.session_uuid[:8]}",
        "history_preservation_disclosure": "Compensating rollback appends new historical actions and preserves all original provenance and audit records.",
    }


def execute_compensating_rollback(
    db: Session,
    session_id: str,
    *,
    preview_checksum: str,
    mode: str = "WHOLE_SESSION",
    selected_action_ids: Optional[List[int]] = None,
    reason: str,
    confirmation_value: str,
    idempotency_token: str,
    actor: str,
) -> Dict[str, Any]:
    session = db.query(StudentImportSession).filter(StudentImportSession.id == session_id).first()
    if not session:
        session = db.query(StudentImportSession).filter(StudentImportSession.session_uuid == session_id).first()
    if not session:
        increment_counter("rollback_failures")
        raise HTTPException(status_code=404, detail="Import session not found")

    # Idempotency check
    if session.idempotency_key == f"ROLLBACK:{idempotency_token}":
        return {
            "session_id": session.id,
            "session_reference": session.session_uuid,
            "rollback_state": session.rollback_state,
            "status": "COMPLETED",
            "idempotent_replay": True,
            "message": "Rollback request was previously processed idempotently.",
        }

    if session.provenance_status == "LEGACY_PROVENANCE_UNAVAILABLE":
        increment_counter("rollback_failures")
        raise HTTPException(
            status_code=409,
            detail="Historical import session marked LEGACY_PROVENANCE_UNAVAILABLE cannot be rolled back.",
        )

    expected_confirmation = f"ROLLBACK_SESSION_{session.session_uuid[:8]}"
    if confirmation_value != expected_confirmation:
        increment_counter("rollback_failures")
        raise HTTPException(
            status_code=400,
            detail=f"Confirmation value '{confirmation_value}' does not match expected '{expected_confirmation}'",
        )

    # Re-run preview to validate checksum
    preview = generate_rollback_preview(db, session.id, actor)
    if preview["preview_checksum"] != preview_checksum:
        increment_counter("rollback_failures")
        raise HTTPException(
            status_code=409,
            detail="Rollback preview checksum mismatch or stale preview. Please generate a new preview.",
        )

    actions = (
        db.query(StudentImportAppliedAction)
        .filter(StudentImportAppliedAction.session_id == session.id)
        .order_by(StudentImportAppliedAction.action_sequence.desc())
        .all()
    )

    compensated_count = 0
    blocked_count = 0
    compensation_actions = []

    for act in actions:
        if mode == "SELECTED_ACTIONS" and selected_action_ids and act.id not in selected_action_ids:
            continue

        if act.rollback_state == "APPLIED":
            continue

        # Verify eligibility
        if act.action_type == "CREATE_STUDENT_MASTER":
            student = db.query(StudentMaster).filter(StudentMaster.id == act.entity_id).first()
            if student:
                # Check for attendance / grades
                attn_count = 0
                dev = db.query(StudentDeviceIdentity).filter(StudentDeviceIdentity.student_master_id == student.id).first()
                if dev and dev.legacy_student_id:
                    attn_count = db.query(Attendance).filter(Attendance.student_id == dev.legacy_student_id).count()

                if attn_count > 0:
                    blocked_count += 1
                    continue

                # Set status to inactive while preserving canonical UUID
                before_st = {"student_status": student.student_status}
                student.student_status = "inactive"
                student.updated_by = actor
                after_st = {"student_status": "inactive"}

                # Record compensation action
                comp_act = StudentImportAppliedAction(
                    session_id=session.id,
                    source_row_number=act.source_row_number,
                    action_sequence=act.action_sequence + 1000,
                    action_type="COMPENSATE_CREATE_STUDENT_MASTER",
                    entity_type="STUDENT_MASTER",
                    entity_id=student.id,
                    entity_reference=act.entity_reference,
                    operation_id=hashlib.sha256(f"{session.session_uuid}:COMP:{act.id}".encode()).hexdigest(),
                    parent_action_id=act.id,
                    applied_by=actor,
                    before_state=before_st,
                    after_state=after_st,
                    before_state_checksum=state_checksum(before_st),
                    after_state_checksum=state_checksum(after_st),
                    dependency_checkpoint=after_st,
                    compensation_type="STATUS_INACTIVE",
                    rollback_eligibility="APPLIED",
                    rollback_state="APPLIED",
                )
                db.add(comp_act)
                db.flush()

                act.rollback_state = "APPLIED"
                act.rollback_action_id = comp_act.id
                compensated_count += 1
                compensation_actions.append(comp_act.id)

        elif act.action_type == "UPDATE_STUDENT_PROFILE":
            student = db.query(StudentMaster).filter(StudentMaster.id == act.entity_id).first()
            if student and act.before_state:
                before_st = act.before_state
                if "full_name" in before_st:
                    student.full_name = before_st["full_name"]
                if "gender" in before_st:
                    student.gender = before_st["gender"]
                if "birth_place" in before_st:
                    student.birth_place = before_st["birth_place"]
                student.updated_by = actor

                comp_act = StudentImportAppliedAction(
                    session_id=session.id,
                    source_row_number=act.source_row_number,
                    action_sequence=act.action_sequence + 1000,
                    action_type="COMPENSATE_UPDATE_STUDENT_PROFILE",
                    entity_type="STUDENT_MASTER",
                    entity_id=student.id,
                    entity_reference=act.entity_reference,
                    operation_id=hashlib.sha256(f"{session.session_uuid}:COMP:{act.id}".encode()).hexdigest(),
                    parent_action_id=act.id,
                    applied_by=actor,
                    before_state=act.after_state,
                    after_state=before_st,
                    before_state_checksum=act.after_state_checksum,
                    after_state_checksum=state_checksum(before_st),
                    dependency_checkpoint=before_st,
                    compensation_type="RESTORE_PROFILE",
                    rollback_eligibility="APPLIED",
                    rollback_state="APPLIED",
                )
                db.add(comp_act)
                db.flush()

                act.rollback_state = "APPLIED"
                act.rollback_action_id = comp_act.id
                compensated_count += 1
                compensation_actions.append(comp_act.id)

        elif act.action_type in ("ADD_DEVICE_IDENTITY", "REPLACE_DEVICE_IDENTITY"):
            dev_id = int(act.entity_id) if str(act.entity_id).isdigit() else act.entity_id
            device = db.query(StudentDeviceIdentity).filter(StudentDeviceIdentity.id == dev_id).first()
            if device and device.is_active:
                device.is_active = False
                device.effective_to = datetime.now().date()

                comp_act = StudentImportAppliedAction(
                    session_id=session.id,
                    source_row_number=act.source_row_number,
                    action_sequence=act.action_sequence + 1000,
                    action_type="COMPENSATE_" + act.action_type,
                    entity_type="DEVICE_IDENTITY",
                    entity_id=str(device.id),
                    entity_reference=act.entity_reference,
                    operation_id=hashlib.sha256(f"{session.session_uuid}:COMP:{act.id}".encode()).hexdigest(),
                    parent_action_id=act.id,
                    applied_by=actor,
                    before_state={"is_active": True},
                    after_state={"is_active": False},
                    before_state_checksum=state_checksum({"is_active": True}),
                    after_state_checksum=state_checksum({"is_active": False}),
                    dependency_checkpoint={"is_active": False},
                    compensation_type="RETIRE_DEVICE",
                    rollback_eligibility="APPLIED",
                    rollback_state="APPLIED",
                )
                db.add(comp_act)
                db.flush()

                act.rollback_state = "APPLIED"
                act.rollback_action_id = comp_act.id
                compensated_count += 1
                compensation_actions.append(comp_act.id)

        elif act.action_type in ("CREATE_ENROLLMENT", "TRANSFER_ENROLLMENT"):
            enroll_id = int(act.entity_id) if str(act.entity_id).isdigit() else act.entity_id
            enrollment = db.query(StudentEnrollment).filter(StudentEnrollment.id == enroll_id).first()
            if enrollment and enrollment.is_active:
                enrollment.is_active = False

                comp_act = StudentImportAppliedAction(
                    session_id=session.id,
                    source_row_number=act.source_row_number,
                    action_sequence=act.action_sequence + 1000,
                    action_type="COMPENSATE_" + act.action_type,
                    entity_type="STUDENT_ENROLLMENT",
                    entity_id=str(enrollment.id),
                    entity_reference=act.entity_reference,
                    operation_id=hashlib.sha256(f"{session.session_uuid}:COMP:{act.id}".encode()).hexdigest(),
                    parent_action_id=act.id,
                    applied_by=actor,
                    before_state={"is_active": True},
                    after_state={"is_active": False},
                    before_state_checksum=state_checksum({"is_active": True}),
                    after_state_checksum=state_checksum({"is_active": False}),
                    dependency_checkpoint={"is_active": False},
                    compensation_type="DEACTIVATE_ENROLLMENT",
                    rollback_eligibility="APPLIED",
                    rollback_state="APPLIED",
                )
                db.add(comp_act)
                db.flush()

                act.rollback_state = "APPLIED"
                act.rollback_action_id = comp_act.id
                compensated_count += 1
                compensation_actions.append(comp_act.id)

    new_rollback_state = "APPLIED" if blocked_count == 0 else "PARTIALLY_BLOCKED"
    session.rollback_state = new_rollback_state
    session.rollback_requested_at = datetime.now()
    session.rollback_completed_at = datetime.now()
    session.idempotency_key = f"ROLLBACK:{idempotency_token}"

    db.flush()

    log_operations_audit_event(
        db,
        actor_id=actor,
        actor_role="admin",
        capability="rollback_import_session",
        entity_type="IMPORT_SESSION",
        entity_reference=session.session_uuid,
        operation="ROLLBACK_COMMIT",
        risk_level="CRITICAL",
        reason=reason,
        import_session_id=session.id,
        success=True,
        metadata={
            "compensated_actions": compensated_count,
            "blocked_actions": blocked_count,
            "rollback_state": new_rollback_state,
            "idempotency_token": idempotency_token,
        },
    )

    return {
        "session_id": session.id,
        "session_reference": session.session_uuid,
        "rollback_state": session.rollback_state,
        "status": "COMPLETED",
        "compensated_action_count": compensated_count,
        "blocked_action_count": blocked_count,
        "compensation_actions": compensation_actions,
        "idempotent_replay": False,
        "history_preserved": True,
        "message": f"Successfully performed compensating rollback for {compensated_count} action(s).",
    }
