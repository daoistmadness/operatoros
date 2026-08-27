from __future__ import annotations

from collections import Counter
from datetime import date, datetime, time, timedelta
from typing import Any

from core.fixture_http import HTTPException
from sqlalchemy import case, desc, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.academic_master import AcademicClass, AcademicGrade, AcademicProgram
from models.academic_roster import AcademicRosterImportBatch
from models.academic_year import AcademicYear
from models.attendance import Attendance
from models.attendance_import import AttendanceImportBatch, AttendanceImportRow
from models.attendance_review import AttendanceOverride
from models.jenjang import Jenjang
from models.operations_audit import OperationsAuditEvent
from models.student_enrollment import StudentEnrollment
from models.student_import_session import StudentImportAppliedAction, StudentImportSession
from models.student_master import StudentDeviceIdentity, StudentMaster
from services.academic_roster import roster_preview_checksum
from services.attendance_import_preview import (
    ATTENDANCE_IMPORT_CONFIRMATION,
    COMMITTABLE_CLASSIFICATIONS,
    DEVICE_IDENTITY_UNMATCHED,
    _attendance_payload,
    _proposed_payload,
    _resolve_device_student,
    commit_attendance_preview,
)
from services.excel_parser import _load_cutoff_map
from services.operations_audit_service import log_operations_audit_event
from services.student_import_sessions import create_preview_session, mark_preview_ready
from services.student_management import _audit, _create_legacy_identity, record_version
from services.student_normalization import mask_identifier, normalize_name


ATTENDANCE_PREFIX = "attendance"
ROSTER_PREFIX = "roster"
LINK_CONFIRMATION = "LINK_UNMATCHED_DEVICE_ID"
ROSTER_CONFIRMATION = "RESOLVE_ROSTER_CONFLICT"


def _error(status: int, code: str, message: str):
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


def _technical_code(message: str | None) -> str | None:
    if not message:
        return None
    prefix = message.split(":", 1)[0]
    return prefix if prefix.replace("_", "").isalnum() and prefix.upper() == prefix else None


def attendance_item_id(row_id: int) -> str:
    return f"{ATTENDANCE_PREFIX}:{row_id}"


def roster_item_id(batch_id: str, preview_row_id: int) -> str:
    return f"{ROSTER_PREFIX}:{batch_id}:{preview_row_id}"


def _latest_audit(db: Session, item_id: str) -> OperationsAuditEvent | None:
    return (
        db.query(OperationsAuditEvent)
        .filter(
            OperationsAuditEvent.entity_type == "UPLOAD_CONFLICT",
            OperationsAuditEvent.entity_reference == item_id,
        )
        .order_by(desc(OperationsAuditEvent.occurred_at), desc(OperationsAuditEvent.id))
        .first()
    )


def _resolution_status(latest: OperationsAuditEvent | None, retry_eligible: bool) -> str:
    if latest is None:
        return "UNRESOLVED"
    if latest.operation == "UPLOAD_CONFLICT_RETRY_COMMITTED":
        return "RETRIED_COMMITTED"
    if latest.operation == "UPLOAD_CONFLICT_RETRY_STILL_BLOCKED":
        return "RETRIED_STILL_BLOCKED"
    if latest.operation in {
        "UPLOAD_CONFLICT_DEVICE_LINKED",
        "UPLOAD_CONFLICT_ROSTER_RESOLVED",
        "UPLOAD_CONFLICT_RETRY_PREVIEW",
    }:
        return "RESOLVED_PENDING_RETRY" if retry_eligible else "UNRESOLVED"
    return "UNRESOLVED"


def _attendance_item(db: Session, row: AttendanceImportRow, batch: AttendanceImportBatch) -> dict:
    item_id = attendance_item_id(row.id)
    latest = _latest_audit(db, item_id)
    retry_source = (row.proposed_change or {}).get("_retry_source")
    mapping = (
        db.query(StudentDeviceIdentity)
        .filter_by(
            device_source="attendance_machine",
            device_identifier=row.student_identifier,
            is_active=True,
        )
        .first()
    )
    retry_eligible = bool(
        retry_source
        and row.classification == "CONFLICT"
        and _technical_code(row.validation_error) == DEVICE_IDENTITY_UNMATCHED
        and mapping
        and not row.selected_for_commit
    )
    status = _resolution_status(latest, retry_eligible)
    if row.selected_for_commit:
        status = "RETRIED_COMMITTED"
    student = db.get(StudentMaster, mapping.student_master_id) if mapping else None
    return {
        "resolution_item_id": item_id,
        "workflow_type": "ATTENDANCE",
        "source_session_id": batch.id,
        "source_filename": batch.filename,
        "source_checksum": batch.checksum,
        "source_checksum_prefix": batch.checksum[:12],
        "source_row_number": row.source_row,
        "created_at": batch.uploaded_at,
        "latest_classification": row.classification,
        "operator_message": (
            f"Device ID {row.student_identifier or 'unknown'} is not linked to an active student."
            if _technical_code(row.validation_error) == DEVICE_IDENTITY_UNMATCHED
            else "This attendance row is blocked by validation."
        ),
        "technical_code": _technical_code(row.validation_error) or row.classification,
        "recommended_action": (
            "Link this device ID to a specific active student, then retry preview."
            if _technical_code(row.validation_error) == DEVICE_IDENTITY_UNMATCHED
            else "Correct the source conflict and create a new preview."
        ),
        "resolution_status": status,
        "retry_eligible": retry_eligible,
        "affected_identifiers": {
            "device_identifier": row.student_identifier,
            "attendance_date": row.attendance_date.isoformat() if row.attendance_date else None,
        },
        "student": (
            {
                "id": student.id,
                "full_name": student.full_name,
                "student_status": student.student_status,
            }
            if student
            else None
        ),
        "latest_retry_at": latest.occurred_at if latest and "RETRY" in latest.operation else None,
        "latest_result": latest.audit_metadata if latest else None,
    }


def _roster_item(db: Session, row: dict, batch: AcademicRosterImportBatch) -> dict:
    item_id = roster_item_id(batch.id, row["preview_row_id"])
    latest = _latest_audit(db, item_id)
    resolved_student_id = (latest.audit_metadata or {}).get("student_master_id") if latest else None
    student_id = resolved_student_id or row.get("matched_student_master_id")
    student = db.get(StudentMaster, student_id) if student_id else None
    retry_eligible = bool(
        latest
        and latest.operation == "UPLOAD_CONFLICT_ROSTER_RESOLVED"
        and student
        and student.student_status == "active"
    )
    return {
        "resolution_item_id": item_id,
        "workflow_type": "ROSTER",
        "source_session_id": batch.session_id,
        "source_filename": batch.filename,
        "source_checksum": batch.checksum,
        "source_checksum_prefix": batch.checksum[:12],
        "source_row_number": row["source_row"],
        "created_at": batch.created_at,
        "latest_classification": row["classification"],
        "operator_message": "; ".join(row.get("errors") or []) or "This roster row needs review.",
        "technical_code": row["classification"],
        "recommended_action": _roster_recommendation(row["classification"]),
        "resolution_status": _resolution_status(latest, retry_eligible),
        "retry_eligible": retry_eligible,
        "affected_identifiers": {
            key: row["payload"].get(key)
            for key in ("student_identifier", "student_master_id", "nipd", "nisn")
            if row["payload"].get(key)
        },
        "student": (
            {
                "id": student.id,
                "full_name": student.full_name,
                "student_status": student.student_status,
            }
            if student
            else None
        ),
        "latest_retry_at": latest.occurred_at if latest and "RETRY" in latest.operation else None,
        "latest_result": latest.audit_metadata if latest else None,
    }


def _roster_recommendation(classification: str) -> str:
    return {
        "POSSIBLE_DUPLICATE": "Compare stable identifiers and explicitly select the existing student.",
        "MISSING_JENJANG": "Select an active canonical Jenjang in the source roster.",
        "MISSING_CLASS": "Select an active approved class and program in the source roster.",
        "INVALID": "Correct the invalid or duplicate source data.",
    }.get(classification, "Review the technical details; unknown classifications stay blocked.")


def list_upload_conflicts(
    db: Session,
    *,
    workflow_type: str | None = None,
    technical_code: str | None = None,
    resolution_status: str | None = None,
    source_session_id: str | None = None,
    retry_eligible: bool | None = None,
    created_from: date | None = None,
    created_to: date | None = None,
    page: int = 1,
    page_size: int = 25,
) -> dict:
    items: list[dict] = []
    if workflow_type in (None, "ATTENDANCE"):
        query = (
            db.query(AttendanceImportRow, AttendanceImportBatch)
            .join(AttendanceImportBatch, AttendanceImportBatch.id == AttendanceImportRow.batch_id)
            .filter(
                or_(
                    AttendanceImportRow.classification.in_(["CONFLICT", "INVALID"]),
                    AttendanceImportRow.validation_error.isnot(None),
                )
            )
        )
        if source_session_id:
            query = query.filter(AttendanceImportBatch.id == source_session_id)
        items.extend(_attendance_item(db, row, batch) for row, batch in query.all())
    if workflow_type in (None, "ROSTER"):
        query = db.query(AcademicRosterImportBatch)
        if source_session_id:
            query = query.filter(
                or_(
                    AcademicRosterImportBatch.id == source_session_id,
                    AcademicRosterImportBatch.session_id == source_session_id,
                )
            )
        for batch in query.all():
            committed_source_rows = {
                value
                for (value,) in db.query(StudentImportAppliedAction.source_row_number)
                .filter(StudentImportAppliedAction.academic_roster_import_batch_id == batch.id)
                .all()
            }
            for row in batch.rows:
                if row["classification"] in {"CREATE_ENROLLMENT", "CREATE_NEW_MASTER"}:
                    continue
                if row["source_row"] in committed_source_rows:
                    continue
                items.append(_roster_item(db, row, batch))
    if technical_code:
        items = [item for item in items if item["technical_code"] == technical_code]
    if resolution_status:
        items = [item for item in items if item["resolution_status"] == resolution_status]
    if retry_eligible is not None:
        items = [item for item in items if item["retry_eligible"] is retry_eligible]
    if created_from:
        items = [item for item in items if item["created_at"] and item["created_at"].date() >= created_from]
    if created_to:
        items = [item for item in items if item["created_at"] and item["created_at"].date() <= created_to]
    status_order = {
        "UNRESOLVED": 0,
        "RESOLVED_PENDING_RETRY": 1,
        "RETRIED_STILL_BLOCKED": 2,
        "RETRIED_COMMITTED": 3,
    }
    items.sort(
        key=lambda item: (
            status_order.get(item["resolution_status"], 9),
            -(item["created_at"].timestamp() if item["created_at"] else 0),
            item["source_row_number"] or 0,
        )
    )
    total = len(items)
    start = (page - 1) * page_size
    page_items = items[start : start + page_size]
    return {
        "items": page_items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total else 0,
        "summary": {
            "unresolved": sum(item["resolution_status"] == "UNRESOLVED" for item in items),
            "attendance": sum(item["workflow_type"] == "ATTENDANCE" for item in items),
            "roster": sum(item["workflow_type"] == "ROSTER" for item in items),
            "retry_ready": sum(item["retry_eligible"] for item in items),
        },
    }


def get_upload_conflict(db: Session, item_id: str) -> dict:
    if item_id.startswith(f"{ATTENDANCE_PREFIX}:"):
        try:
            row_id = int(item_id.split(":", 1)[1])
        except ValueError:
            _error(404, "RESOLUTION_ITEM_NOT_FOUND", "Resolution item was not found.")
        row = db.get(AttendanceImportRow, row_id)
        batch = db.get(AttendanceImportBatch, row.batch_id) if row else None
        if row is None or batch is None:
            _error(404, "RESOLUTION_ITEM_NOT_FOUND", "Resolution item was not found.")
        return _attendance_item(db, row, batch)
    if item_id.startswith(f"{ROSTER_PREFIX}:"):
        parts = item_id.split(":")
        if len(parts) != 3:
            _error(404, "RESOLUTION_ITEM_NOT_FOUND", "Resolution item was not found.")
        batch = db.get(AcademicRosterImportBatch, parts[1])
        try:
            row_id = int(parts[2])
        except ValueError:
            row_id = -1
        row = next((value for value in (batch.rows if batch else []) if value["preview_row_id"] == row_id), None)
        if batch is None or row is None:
            _error(404, "RESOLUTION_ITEM_NOT_FOUND", "Resolution item was not found.")
        return _roster_item(db, row, batch)
    _error(404, "RESOLUTION_ITEM_NOT_FOUND", "Resolution item was not found.")


def student_candidates(db: Session, item_id: str, query: str, limit: int = 20) -> list[dict]:
    get_upload_conflict(db, item_id)
    cleaned = query.strip()
    if len(cleaned) < 2:
        _error(400, "STUDENT_SEARCH_TOO_BROAD", "Enter at least two characters or a stable identifier.")
    pattern = f"%{cleaned.casefold()}%"
    device_students = db.query(StudentDeviceIdentity.student_master_id).filter(
        StudentDeviceIdentity.device_identifier.ilike(pattern)
    )
    rows = (
        db.query(StudentMaster)
        .filter(
            or_(
                StudentMaster.id == cleaned,
                StudentMaster.nipd == cleaned,
                StudentMaster.nisn == cleaned,
                StudentMaster.nik == cleaned,
                StudentMaster.id.in_(device_students),
                StudentMaster.normalized_name.like(pattern),
            )
        )
        .order_by(case((StudentMaster.student_status == "active", 0), else_=1), StudentMaster.full_name)
        .limit(limit)
        .all()
    )
    result = []
    for student in rows:
        enrollment = (
            db.query(StudentEnrollment)
            .filter_by(student_master_id=student.id)
            .order_by(desc(StudentEnrollment.effective_from), desc(StudentEnrollment.id))
            .first()
        )
        mapping = (
            db.query(StudentDeviceIdentity)
            .filter_by(student_master_id=student.id, is_active=True)
            .order_by(desc(StudentDeviceIdentity.id))
            .first()
        )
        result.append(
            {
                "id": student.id,
                "record_version": record_version(student),
                "full_name": student.full_name,
                "nipd_masked": mask_identifier(student.nipd),
                "nisn_masked": mask_identifier(student.nisn),
                "student_status": student.student_status,
                "current_class": enrollment.class_name if enrollment else None,
                "jenjang_id": enrollment.jenjang_id if enrollment else None,
                "has_active_device": bool(mapping),
                "active_device_masked": mask_identifier(mapping.device_identifier) if mapping else None,
            }
        )
    return result


def link_attendance_device(
    db: Session,
    *,
    item_id: str,
    expected_checksum: str,
    expected_device_identifier: str,
    student_master_id: str,
    expected_student_version: str,
    confirmation: str,
    actor_id: str,
    actor_role: str,
) -> dict:
    if confirmation != LINK_CONFIRMATION:
        _error(400, "CONFIRMATION_REQUIRED", "The device-link confirmation token is invalid.")
    if not item_id.startswith(f"{ATTENDANCE_PREFIX}:"):
        _error(409, "RESOLUTION_NOT_ELIGIBLE", "Only unmatched attendance devices can use this action.")
    row_id = int(item_id.split(":", 1)[1])
    row = db.get(AttendanceImportRow, row_id)
    batch = db.get(AttendanceImportBatch, row.batch_id) if row else None
    if row is None or batch is None:
        _error(404, "RESOLUTION_ITEM_NOT_FOUND", "Resolution item was not found.")
    if batch.checksum != expected_checksum:
        _error(409, "SOURCE_CHECKSUM_MISMATCH", "The source checksum changed; refresh the conflict.")
    if row.student_identifier != expected_device_identifier:
        _error(409, "RESOLUTION_ITEM_STALE", "The device identifier changed; refresh the conflict.")
    if row.classification != "CONFLICT" or _technical_code(row.validation_error) != DEVICE_IDENTITY_UNMATCHED:
        _error(409, "RESOLUTION_NOT_ELIGIBLE", "This row is no longer an unmatched-device conflict.")
    student = db.get(StudentMaster, student_master_id)
    if student is None:
        _error(404, "TARGET_STUDENT_NOT_FOUND", "The selected student was not found.")
    if student.student_status != "active":
        _error(409, "TARGET_STUDENT_INACTIVE", "Only an active student can receive a device link.")
    if record_version(student) != expected_student_version:
        _error(409, "RESOLUTION_ITEM_STALE", "The selected student changed; search again.")
    if normalize_name(student.full_name) != normalize_name(row.student_name or ""):
        _error(409, "IDENTITY_CONFLICT", "The selected student's name does not match the source identity.")
    existing = (
        db.query(StudentDeviceIdentity)
        .filter_by(
            device_source="attendance_machine",
            device_identifier=expected_device_identifier,
            is_active=True,
        )
        .first()
    )
    if existing:
        if existing.student_master_id == student.id:
            return {"outcome": "ALREADY_LINKED_TO_TARGET", "resolution_item_id": item_id, "student_master_id": student.id}
        _error(409, "DEVICE_ALREADY_ASSIGNED", "This device ID is actively assigned to another student.")
    try:
        mapping = _create_legacy_identity(
            db,
            student,
            {
                "device_identifier": expected_device_identifier,
                "device_source": "attendance_machine",
                "effective_from": row.attendance_date or date.today(),
                "actor": actor_id,
            },
        )
        db.flush()
        _audit(
            db,
            student.id,
            "device_identity_added",
            actor_id,
            "upload_conflict_resolution",
            "device_identifier",
            None,
            expected_device_identifier,
        )
        log_operations_audit_event(
            db,
            actor_id=actor_id,
            actor_role=actor_role,
            capability="manage_device_identity",
            entity_type="UPLOAD_CONFLICT",
            entity_reference=item_id,
            operation="UPLOAD_CONFLICT_DEVICE_LINKED",
            risk_level="HIGH",
            import_session_id=batch.id,
            changed_fields=["device_identity"],
            metadata={
                "student_master_id": student.id,
                "source_row": row.source_row,
                "source_checksum_prefix": batch.checksum[:12],
                "mapping_id": mapping.id,
            },
        )
        db.commit()
        return {"outcome": "LINKED", "resolution_item_id": item_id, "student_master_id": student.id}
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        _error(409, "DEVICE_IDENTITY_CONFLICT", "The device mapping changed before resolution.")
        raise exc


def roster_comparison(db: Session, item_id: str, student_master_id: str | None = None) -> dict:
    item = get_upload_conflict(db, item_id)
    if item["workflow_type"] != "ROSTER":
        _error(409, "ROSTER_RESOLUTION_INVALID", "This item is not a roster conflict.")
    _, batch_id, row_text = item_id.split(":")
    batch = db.get(AcademicRosterImportBatch, batch_id)
    row = next(value for value in batch.rows if value["preview_row_id"] == int(row_text))
    student = db.get(StudentMaster, student_master_id or row.get("matched_student_master_id"))
    fields = []
    incoming = row["payload"]
    existing = {
        "student_name": student.full_name if student else None,
        "nipd": student.nipd if student else None,
        "nisn": student.nisn if student else None,
        "nik": student.nik if student else None,
    }
    immutable = {"nipd", "nisn", "nik"}
    for field in ("student_name", "nipd", "nisn", "nik", "academic_year", "jenjang", "class_name", "program"):
        incoming_value = incoming.get(field)
        existing_value = existing.get(field)
        if incoming_value == existing_value and existing_value is not None:
            classification = "SAME"
            actions = ["KEEP_EXISTING"]
        elif field in immutable and existing_value and incoming_value != existing_value:
            classification = "IMMUTABLE_CONFLICT"
            actions = ["KEEP_EXISTING", "LEAVE_UNRESOLVED"]
        elif field in {"jenjang", "class_name", "program"} and row["classification"] in {"MISSING_JENJANG", "MISSING_CLASS"}:
            classification = "MISSING_REFERENCE"
            actions = ["SELECT_REFERENCE", "LEAVE_UNRESOLVED"]
        elif student and field == "student_name" and incoming_value != existing_value:
            classification = "SENSITIVE_REVIEW"
            actions = ["KEEP_EXISTING", "LEAVE_UNRESOLVED"]
        else:
            classification = "UNSUPPORTED"
            actions = ["LEAVE_UNRESOLVED"]
        fields.append(
            {
                "field": field,
                "incoming_value": mask_identifier(incoming_value) if field in immutable else incoming_value,
                "existing_value": mask_identifier(existing_value) if field in immutable else existing_value,
                "classification": classification,
                "allowed_actions": actions,
                "explanation": "Stable identifiers cannot be overwritten in conflict resolution." if classification == "IMMUTABLE_CONFLICT" else "Review this field before choosing a resolution plan.",
            }
        )
    return {
        "resolution_item_id": item_id,
        "source_filename": batch.filename,
        "source_row": row["source_row"],
        "source_checksum_prefix": batch.checksum[:12],
        "student": {"id": student.id, "full_name": student.full_name, "record_version": record_version(student)} if student else None,
        "fields": fields,
        "allowed_plans": ["LINK_ROW_TO_EXISTING_STUDENT", "LEAVE_UNRESOLVED"] if student else ["LEAVE_UNRESOLVED"],
    }


def resolve_roster_link(
    db: Session,
    *,
    item_id: str,
    expected_checksum: str,
    student_master_id: str,
    expected_student_version: str,
    confirmation: str,
    actor_id: str,
    actor_role: str,
) -> dict:
    if confirmation != ROSTER_CONFIRMATION:
        _error(400, "CONFIRMATION_REQUIRED", "The roster-resolution confirmation token is invalid.")
    if not item_id.startswith(f"{ROSTER_PREFIX}:"):
        _error(409, "ROSTER_RESOLUTION_INVALID", "This item is not a roster conflict.")
    _, batch_id, row_text = item_id.split(":")
    batch = db.get(AcademicRosterImportBatch, batch_id)
    row = next((value for value in (batch.rows if batch else []) if value["preview_row_id"] == int(row_text)), None)
    if batch is None or row is None:
        _error(404, "RESOLUTION_ITEM_NOT_FOUND", "Resolution item was not found.")
    if batch.checksum != expected_checksum:
        _error(409, "SOURCE_CHECKSUM_MISMATCH", "The source checksum changed; refresh the conflict.")
    if row["classification"] != "POSSIBLE_DUPLICATE":
        _error(409, "ROSTER_RESOLUTION_INVALID", "Only ambiguous identity rows can be linked here.")
    student = db.get(StudentMaster, student_master_id)
    if student is None:
        _error(404, "TARGET_STUDENT_NOT_FOUND", "The selected student was not found.")
    if student.student_status != "active":
        _error(409, "TARGET_STUDENT_INACTIVE", "Only an active student can be selected.")
    if record_version(student) != expected_student_version:
        _error(409, "RESOLUTION_ITEM_STALE", "The selected student changed; search again.")
    comparison = roster_comparison(db, item_id, student.id)
    immutable_conflicts = [field["field"] for field in comparison["fields"] if field["classification"] == "IMMUTABLE_CONFLICT"]
    if immutable_conflicts:
        _error(409, "IMMUTABLE_FIELD_CONFLICT", "Stable identifiers conflict with the selected student.")
    log_operations_audit_event(
        db,
        actor_id=actor_id,
        actor_role=actor_role,
        capability="resolve_student_duplicates",
        entity_type="UPLOAD_CONFLICT",
        entity_reference=item_id,
        operation="UPLOAD_CONFLICT_ROSTER_RESOLVED",
        risk_level="HIGH",
        import_session_id=batch.session_id,
        changed_fields=[],
        metadata={
            "student_master_id": student.id,
            "resolution_plan": "LINK_ROW_TO_EXISTING_STUDENT",
            "source_row": row["source_row"],
            "source_checksum_prefix": batch.checksum[:12],
        },
    )
    db.commit()
    return {"outcome": "RESOLVED_PENDING_RETRY", "resolution_item_id": item_id, "student_master_id": student.id}


def _source_to_entry(row: AttendanceImportRow) -> dict:
    source = (row.proposed_change or {}).get("_retry_source")
    if not source:
        _error(409, "RETRY_NOT_ELIGIBLE", "This historical conflict does not retain retry-safe event data.")

    def parse_time(value):
        return time.fromisoformat(value) if value else None

    def parse_duration(value):
        return timedelta(seconds=value) if value is not None else None

    return {
        "student_id": int(row.student_identifier),
        "student_name": row.student_name,
        "date": row.attendance_date,
        "check_in": parse_time(source.get("check_in")),
        "check_out": parse_time(source.get("check_out")),
        "terlambat": parse_duration(source.get("terlambat_seconds")),
        "overtime": parse_duration(source.get("overtime_seconds")),
        "exception": source.get("exception"),
        "week": source.get("week"),
        "excel_row": row.source_row,
    }


def retry_attendance_preview(
    db: Session,
    *,
    item_ids: list[str],
    expected_source_session_id: str,
    expected_source_checksum: str,
    actor_id: str,
    actor_role: str,
) -> dict:
    rows = []
    source_batch = None
    for item_id in dict.fromkeys(item_ids):
        if not item_id.startswith(f"{ATTENDANCE_PREFIX}:"):
            _error(409, "RETRY_NOT_ELIGIBLE", "Attendance and roster conflicts cannot be mixed in one retry.")
        row = db.get(AttendanceImportRow, int(item_id.split(":", 1)[1]))
        batch = db.get(AttendanceImportBatch, row.batch_id) if row else None
        if row is None or batch is None:
            _error(404, "RESOLUTION_ITEM_NOT_FOUND", "Resolution item was not found.")
        if source_batch and source_batch.id != batch.id:
            _error(409, "RETRY_SOURCE_STALE", "All retry rows must belong to the same source preview.")
        source_batch = batch
        if batch.id != expected_source_session_id:
            _error(409, "RETRY_SOURCE_STALE", "The selected rows no longer belong to this source session.")
        if batch.checksum != expected_source_checksum:
            _error(409, "SOURCE_CHECKSUM_MISMATCH", "The retry checksum does not match the original source.")
        if row.selected_for_commit:
            _error(409, "RETRY_ROW_ALREADY_COMMITTED", "A selected row was already committed.")
        if row.classification != "CONFLICT":
            _error(409, "RETRY_NOT_ELIGIBLE", "Only unresolved conflict rows can be retried.")
        rows.append(row)
    if not rows:
        _error(400, "RETRY_NOT_ELIGIBLE", "Select at least one unresolved row.")
    retry_batch = AttendanceImportBatch(
        filename=f"Retry - {source_batch.filename}",
        checksum=source_batch.checksum,
        uploaded_by=actor_id,
        total_rows=len(rows),
        logical_rows=len(rows),
    )
    db.add(retry_batch)
    db.flush()
    cutoff_map = _load_cutoff_map(db)
    keys = Counter((row.student_identifier, row.attendance_date) for row in rows)
    counts = Counter()
    outcomes = []
    for original in rows:
        entry = _source_to_entry(original)
        student = _resolve_device_student(db, entry["student_id"])
        existing = (
            db.query(Attendance)
            .filter_by(student_id=student.id, date=entry["date"])
            .first()
            if student
            else None
        )
        validation_error = None
        warning = None
        if student is None:
            classification = "CONFLICT"
            validation_error = f"{DEVICE_IDENTITY_UNMATCHED}: device identity remains unresolved"
        elif keys[(original.student_identifier, original.attendance_date)] > 1:
            classification = "CONFLICT"
            validation_error = "Divergent duplicate retry rows share the same student/date key"
        elif normalize_name(student.name) != normalize_name(entry["student_name"]):
            classification = "CONFLICT"
            validation_error = "Student identifier belongs to a different existing name"
        else:
            proposed = _proposed_payload(entry, student, existing, cutoff_map)
            before = _attendance_payload(existing) if existing else None
            classification = "NEW" if existing is None else "UNCHANGED" if before == proposed else "DIFFERENCE"
            if existing and db.query(AttendanceOverride).filter_by(attendance_id=existing.id).first():
                warning = "Administrative override exists and remains authoritative"
        proposed_change = (
            {"_retry_source": (original.proposed_change or {}).get("_retry_source")}
            if classification == "CONFLICT"
            else _proposed_payload(entry, student, existing, cutoff_map)
        )
        retry_row = AttendanceImportRow(
            batch_id=retry_batch.id,
            source_row=original.source_row,
            student_identifier=original.student_identifier,
            student_name=original.student_name,
            attendance_date=original.attendance_date,
            existing_attendance_id=existing.id if existing else None,
            classification=classification,
            existing_record=_attendance_payload(existing) if existing else None,
            proposed_change=proposed_change,
            validation_error=validation_error,
            warning=warning,
        )
        db.add(retry_row)
        db.flush()
        counts[classification] += 1
        outcome = "NOW_ELIGIBLE" if classification in COMMITTABLE_CLASSIFICATIONS else "STILL_UNMATCHED"
        outcomes.append(
            {
                "resolution_item_id": attendance_item_id(original.id),
                "retry_row_id": retry_row.id,
                "source_row": original.source_row,
                "classification": classification,
                "outcome": outcome,
            }
        )
        log_operations_audit_event(
            db,
            actor_id=actor_id,
            actor_role=actor_role,
            capability="import_attendance",
            entity_type="UPLOAD_CONFLICT",
            entity_reference=attendance_item_id(original.id),
            operation="UPLOAD_CONFLICT_RETRY_PREVIEW" if outcome == "NOW_ELIGIBLE" else "UPLOAD_CONFLICT_RETRY_STILL_BLOCKED",
            import_session_id=source_batch.id,
            metadata={
                "retry_batch_id": retry_batch.id,
                "retry_row_id": retry_row.id,
                "source_row": original.source_row,
                "source_checksum_prefix": source_batch.checksum[:12],
                "outcome": outcome,
            },
        )
    retry_batch.new_records = counts["NEW"]
    retry_batch.update_records = counts["DIFFERENCE"]
    retry_batch.unchanged_records = counts["UNCHANGED"]
    retry_batch.conflict_records = counts["CONFLICT"]
    retry_batch.invalid_records = counts["INVALID"]
    db.commit()
    return {
        "workflow_type": "ATTENDANCE",
        "source_session_id": source_batch.id,
        "source_checksum": source_batch.checksum,
        "retry_batch_id": retry_batch.id,
        "outcomes": outcomes,
        "summary": dict(counts),
    }


def commit_attendance_retry(
    db: Session,
    *,
    item_ids: list[str],
    source_session_id: str,
    source_checksum: str,
    retry_batch_id: str,
    retry_checksum: str,
    selected_retry_row_ids: list[int],
    confirmation: str,
    actor_id: str,
    actor_role: str,
) -> dict:
    if confirmation != ATTENDANCE_IMPORT_CONFIRMATION:
        _error(400, "CONFIRMATION_REQUIRED", "The attendance commit confirmation token is invalid.")
    retry_batch = db.get(AttendanceImportBatch, retry_batch_id)
    if retry_batch is None or retry_batch.checksum != retry_checksum:
        _error(409, "RETRY_SOURCE_STALE", "The retry preview changed; run retry preview again.")
    selected = (
        db.query(AttendanceImportRow)
        .filter(
            AttendanceImportRow.batch_id == retry_batch.id,
            AttendanceImportRow.id.in_(list(dict.fromkeys(selected_retry_row_ids))),
        )
        .all()
    )
    if not selected_retry_row_ids or len(selected) != len(set(selected_retry_row_ids)):
        _error(400, "RETRY_NOT_ELIGIBLE", "Select retry rows from this preview.")
    original_by_source_row = {}
    for item_id in dict.fromkeys(item_ids):
        if not item_id.startswith(f"{ATTENDANCE_PREFIX}:"):
            _error(409, "RETRY_NOT_ELIGIBLE", "Only attendance conflicts can use attendance retry commit.")
        original = db.get(AttendanceImportRow, int(item_id.split(":", 1)[1]))
        source_batch = db.get(AttendanceImportBatch, original.batch_id) if original else None
        if source_batch is None or source_batch.id != source_session_id or source_batch.checksum != source_checksum:
            _error(409, "RETRY_SOURCE_STALE", "Original conflict provenance no longer matches.")
        latest = _latest_audit(db, item_id)
        metadata = latest.audit_metadata if latest else {}
        if (
            latest is None
            or latest.operation != "UPLOAD_CONFLICT_RETRY_PREVIEW"
            or metadata.get("retry_batch_id") != retry_batch.id
        ):
            _error(409, "RESOLUTION_ITEM_STALE", "Retry preview provenance is stale.")
        original_by_source_row[original.source_row] = item_id
    if any(row.source_row not in original_by_source_row for row in selected):
        _error(409, "RETRY_SOURCE_STALE", "A selected retry row is not part of the original selection.")

    result = commit_attendance_preview(
        db,
        retry_batch.id,
        selected_retry_row_ids,
        confirmation,
        actor_id,
        preview_checksum=retry_checksum,
    )
    for row in selected:
        log_operations_audit_event(
            db,
            actor_id=actor_id,
            actor_role=actor_role,
            capability="import_attendance",
            entity_type="UPLOAD_CONFLICT",
            entity_reference=original_by_source_row[row.source_row],
            operation="UPLOAD_CONFLICT_RETRY_COMMITTED",
            risk_level="HIGH",
            import_session_id=source_session_id,
            metadata={
                "retry_batch_id": retry_batch.id,
                "retry_row_id": row.id,
                "source_row": row.source_row,
                "source_checksum_prefix": source_checksum[:12],
                "outcome": "COMMITTED",
            },
        )
    db.commit()
    return {
        **result,
        "source_session_id": source_session_id,
        "source_checksum_prefix": source_checksum[:12],
        "committed_resolution_item_ids": [original_by_source_row[row.source_row] for row in selected],
    }
