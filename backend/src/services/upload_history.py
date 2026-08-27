from __future__ import annotations

import csv
import hashlib
import io
import json
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import PurePath
from typing import Any

from core.fixture_http import HTTPException
from sqlalchemy.orm import Session

from models.academic_roster import AcademicRosterImportBatch
from models.attendance_import import AttendanceImportBatch, AttendanceImportRow
from models.operations_audit import OperationsAuditEvent
from models.student_import_session import StudentImportAppliedAction, StudentImportSession


HISTORY_FORMAT_VERSION = "1.0"
ATTENDANCE_ELIGIBLE = {"NEW", "DIFFERENCE", "UNCHANGED"}
ATTENDANCE_KNOWN = ATTENDANCE_ELIGIBLE | {"CONFLICT", "INVALID"}
ROSTER_ELIGIBLE = {"CREATE_ENROLLMENT", "CREATE_NEW_MASTER"}
ROSTER_BLOCKED = {"POSSIBLE_DUPLICATE", "MISSING_JENJANG", "MISSING_CLASS"}
ROSTER_KNOWN = ROSTER_ELIGIBLE | ROSTER_BLOCKED | {"INVALID"}
KNOWN_AUDIT_OPERATIONS = {
    "UPLOAD_CONFLICT_DEVICE_LINKED": "DEVICE_IDENTITY_LINKED",
    "UPLOAD_CONFLICT_ROSTER_RESOLVED": "ROSTER_RESOLUTION_APPLIED",
    "UPLOAD_CONFLICT_RETRY_PREVIEW": "RETRY_PREVIEW_CREATED",
    "UPLOAD_CONFLICT_RETRY_STILL_BLOCKED": "RETRY_PREVIEW_CREATED",
    "UPLOAD_CONFLICT_RETRY_COMMITTED": "RETRY_COMMIT_COMPLETED",
}


def _iso(value: datetime | date | None) -> str | None:
    return value.isoformat() if value else None


def _safe_filename(value: str | None) -> str:
    if not value:
        return "unknown"
    return PurePath(value.replace("\\", "/")).name[:255] or "unknown"


def _mask(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text if len(text) <= 4 else f"{'*' * min(len(text) - 4, 8)}{text[-4:]}"


def _page(items: list[dict], page: int, page_size: int) -> dict:
    total = len(items)
    start = (page - 1) * page_size
    return {
        "items": items[start:start + page_size],
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": (total + page_size - 1) // page_size if total else 0,
    }


def _audit_events(db: Session, session_id: str) -> list[OperationsAuditEvent]:
    return (
        db.query(OperationsAuditEvent)
        .filter(OperationsAuditEvent.import_session_id == session_id)
        .order_by(OperationsAuditEvent.occurred_at.asc(), OperationsAuditEvent.id.asc())
        .all()
    )


def _retry_evidence(events: list[OperationsAuditEvent]) -> dict:
    retry_events = [event for event in events if event.operation.startswith("UPLOAD_CONFLICT_RETRY_")]
    previews = [
        event for event in retry_events
        if event.operation in {"UPLOAD_CONFLICT_RETRY_PREVIEW", "UPLOAD_CONFLICT_RETRY_STILL_BLOCKED"}
    ]
    committed = [event for event in retry_events if event.operation == "UPLOAD_CONFLICT_RETRY_COMMITTED"]
    attempts = {
        (event.audit_metadata or {}).get("retry_batch_id")
        for event in previews
        if (event.audit_metadata or {}).get("retry_batch_id")
    }
    resolved_refs = {event.entity_reference for event in committed}
    return {
        "retried_total": len(previews),
        "retry_selected_total": len(committed) if committed else (0 if previews else 0),
        "retry_committed_total": len(committed),
        "retry_attempt_count": len(attempts),
        "resolved_references": resolved_refs,
    }


def _state(record: dict, unknown_classification: bool = False, unknown_event: bool = False) -> tuple[str, list[str]]:
    messages: list[str] = []
    inconsistent = False
    incomplete = False
    preview_parts = [record["preview_eligible"], record["conflict_total"], record["invalid_total"]]
    if unknown_classification:
        incomplete = True
        messages.append("An unknown preview classification prevents complete reconciliation.")
    elif all(value is not None for value in preview_parts) and sum(preview_parts) != record["preview_total"]:
        inconsistent = True
        messages.append("Preview classification totals do not reconcile with the recorded row count.")

    selected = record["selected_total"]
    if record["status"] in {"COMMITTED", "RETRIED"}:
        if selected is None:
            incomplete = True
            messages.append("Selected-row evidence was not recorded.")
        elif record["preview_eligible"] is not None and selected > record["preview_eligible"]:
            inconsistent = True
            messages.append("Selected rows exceed the eligible preview rows.")
        commit_parts = (
            [record["created_total"], record["updated_total"], record["skipped_total"], record["failed_total"]]
            if record["workflow_type"] == "ROSTER"
            else [record["committed_total"], record["skipped_total"], record["protected_total"], record["failed_total"]]
        )
        if selected is not None and all(value is not None for value in commit_parts):
            if sum(commit_parts) != selected:
                inconsistent = True
                messages.append("Commit totals do not reconcile with the recorded selection.")
        elif selected is not None:
            incomplete = True
            messages.append("Commit outcome evidence is incomplete.")
    elif selected is None:
        incomplete = True
        messages.append("Selection was not recorded because this upload was not committed.")

    if record["rollback_succeeded"]:
        messages.append("The commit was rolled back; no rows are counted as successfully imported.")
    if unknown_event:
        incomplete = True
        messages.append("Additional historical activity was recorded but cannot be displayed by this version.")
    if inconsistent:
        return "INCONSISTENT", messages
    if incomplete:
        return "INCOMPLETE", messages
    if record["unresolved_total"]:
        return "BALANCED_WITH_UNRESOLVED", messages
    return "BALANCED", messages


def _attendance_record(db: Session, batch: AttendanceImportBatch) -> dict:
    rows = (
        db.query(AttendanceImportRow)
        .filter(AttendanceImportRow.batch_id == batch.id)
        .order_by(AttendanceImportRow.id.asc())
        .all()
    )
    counts = Counter(row.classification for row in rows)
    events = _audit_events(db, batch.id)
    retry = _retry_evidence(events)
    conflict_refs = {f"attendance:{row.id}" for row in rows if row.classification == "CONFLICT"}
    unresolved = len(conflict_refs - retry["resolved_references"])
    committed = batch.status == "committed"
    result = batch.commit_result if isinstance(batch.commit_result, dict) else {}
    inserted = result.get("rows_inserted") if committed else None
    updated = result.get("rows_updated") if committed else None
    unchanged = result.get("rows_unchanged") if committed else None
    selected = sum(bool(row.selected_for_commit) for row in rows) if committed else None
    committed_total = (
        sum(value for value in (inserted, updated, unchanged) if isinstance(value, int))
        if committed and all(isinstance(value, int) for value in (inserted, updated, unchanged))
        else None
    )
    latest = max([batch.committed_at, batch.uploaded_at, *[event.occurred_at for event in events]], key=lambda x: x or datetime.min)
    status = {
        "failed": "FAILED",
        "preview": "UNRESOLVED" if unresolved else "PREVIEWED",
        "expired": "INCOMPLETE_PROVENANCE",
        "committing": "UNKNOWN",
    }.get(batch.status, "COMMITTED")
    if retry["retry_attempt_count"]:
        status = "RETRIED"
    record = {
        "upload_id": f"attendance:{batch.id}",
        "workflow_type": "ATTENDANCE",
        "source_filename": _safe_filename(batch.filename),
        "source_checksum": batch.checksum,
        "checksum_prefix": batch.checksum[:12],
        "first_activity_at": _iso(batch.uploaded_at),
        "latest_activity_at": _iso(latest),
        "actor": batch.uploaded_by,
        "status": status,
        "preview_total": len(rows),
        "preview_eligible": sum(counts[name] for name in ATTENDANCE_ELIGIBLE),
        "preview_blocked": counts["CONFLICT"],
        "selected_total": selected,
        "committed_total": committed_total,
        "created_total": inserted,
        "updated_total": updated,
        "unchanged_total": unchanged if committed else counts["UNCHANGED"],
        "skipped_total": 0 if committed else None,
        "duplicate_total": 0 if committed else None,
        "conflict_total": counts["CONFLICT"],
        "invalid_total": counts["INVALID"],
        "protected_total": 0 if committed else None,
        "failed_total": 0 if committed else None,
        "unresolved_total": unresolved,
        "retried_total": retry["retried_total"],
        "retry_selected_total": retry["retry_selected_total"],
        "retry_committed_total": retry["retry_committed_total"],
        "rollback_attempted": False,
        "rollback_succeeded": False,
        "resolution_item_count": len(conflict_refs - {ref for ref in conflict_refs if ref not in retry["resolved_references"]}),
        "retry_attempt_count": retry["retry_attempt_count"],
        "operation_references": sorted({event.event_id for event in events}),
    }
    unknown_event = any(event.operation not in KNOWN_AUDIT_OPERATIONS for event in events)
    record["reconciliation_state"], record["reconciliation_messages"] = _state(
        record,
        any(row.classification not in ATTENDANCE_KNOWN for row in rows),
        unknown_event,
    )
    return record


def _roster_record(db: Session, batch: AcademicRosterImportBatch) -> dict:
    session = db.get(StudentImportSession, batch.session_id)
    rows = batch.rows if isinstance(batch.rows, list) else []
    counts = Counter(row.get("classification") for row in rows)
    events = _audit_events(db, batch.session_id)
    retry = _retry_evidence(events)
    blocked_rows = [row for row in rows if row.get("classification") in ROSTER_BLOCKED]
    conflict_refs = {f"roster:{batch.id}:{row.get('preview_row_id')}" for row in blocked_rows}
    resolved = {
        event.entity_reference for event in events
        if event.operation in {"UPLOAD_CONFLICT_ROSTER_RESOLVED", "UPLOAD_CONFLICT_RETRY_COMMITTED"}
    }
    unresolved = len(conflict_refs - resolved)
    committed = batch.status == "committed"
    rolled_back = bool(session and session.rollback_state == "APPLIED")
    result = batch.commit_result if isinstance(batch.commit_result, dict) else {}
    selected = session.selected_row_count if committed and session else None
    created = result.get("created") if committed else None
    if rolled_back:
        created = 0
    latest_values = [batch.committed_at, batch.created_at]
    if session:
        latest_values.extend([session.updated_at, session.rollback_completed_at])
    latest_values.extend(event.occurred_at for event in events)
    latest = max(latest_values, key=lambda x: x or datetime.min)
    if rolled_back:
        status = "ROLLED_BACK"
    elif batch.status == "failed" or (session and session.status == "COMMIT_FAILED"):
        status = "FAILED"
    elif retry["retry_attempt_count"]:
        status = "RETRIED"
    elif committed:
        status = "COMMITTED"
    else:
        status = "UNRESOLVED" if unresolved else "PREVIEWED"
    record = {
        "upload_id": f"roster:{batch.id}",
        "workflow_type": "ROSTER",
        "source_filename": _safe_filename(batch.filename),
        "source_checksum": batch.checksum,
        "checksum_prefix": batch.checksum[:12],
        "first_activity_at": _iso(batch.created_at),
        "latest_activity_at": _iso(latest),
        "actor": batch.created_by,
        "status": status,
        "preview_total": len(rows),
        "preview_eligible": sum(counts[name] for name in ROSTER_ELIGIBLE),
        "preview_blocked": sum(counts[name] for name in ROSTER_BLOCKED),
        "selected_total": selected,
        "committed_total": created,
        "created_total": created,
        "updated_total": 0 if committed else None,
        "unchanged_total": 0 if committed else None,
        "skipped_total": 0 if committed else None,
        "duplicate_total": counts["POSSIBLE_DUPLICATE"],
        "conflict_total": len(blocked_rows),
        "invalid_total": counts["INVALID"],
        "protected_total": 0 if committed else None,
        "failed_total": 0 if committed else None,
        "unresolved_total": unresolved,
        "retried_total": retry["retried_total"],
        "retry_selected_total": retry["retry_selected_total"],
        "retry_committed_total": retry["retry_committed_total"],
        "rollback_attempted": bool(session and session.rollback_state not in {"NOT_AVAILABLE", "AVAILABLE"}),
        "rollback_succeeded": rolled_back,
        "resolution_item_count": len(conflict_refs & resolved),
        "retry_attempt_count": retry["retry_attempt_count"],
        "operation_references": sorted({
            *[event.event_id for event in events],
            *(
                action.operation_id
                for action in db.query(StudentImportAppliedAction).filter_by(session_id=batch.session_id).all()
            ),
        }),
    }
    unknown_event = any(event.operation not in KNOWN_AUDIT_OPERATIONS and "ROLLBACK" not in event.operation for event in events)
    record["reconciliation_state"], record["reconciliation_messages"] = _state(
        record,
        any(row.get("classification") not in ROSTER_KNOWN for row in rows),
        unknown_event,
    )
    if session and session.provenance_status != "COMPLETE_ACTION_PROVENANCE":
        record["reconciliation_state"] = "INCOMPLETE"
        record["reconciliation_messages"].append("Preview evidence is incomplete for this historical upload.")
    return record


def all_records(db: Session) -> list[dict]:
    records = [
        *[_attendance_record(db, item) for item in db.query(AttendanceImportBatch).all()],
        *[_roster_record(db, item) for item in db.query(AcademicRosterImportBatch).all()],
    ]
    return sorted(records, key=lambda item: (item["latest_activity_at"] or "", item["upload_id"]), reverse=True)


def list_upload_history(
    db: Session,
    *,
    page: int,
    page_size: int,
    workflow_type: str | None = None,
    status: str | None = None,
    reconciliation_state: str | None = None,
    actor: str | None = None,
    filename: str | None = None,
    checksum_prefix: str | None = None,
    unresolved_only: bool = False,
    retry_activity: bool = False,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    records = all_records(db)
    if workflow_type:
        records = [item for item in records if item["workflow_type"] == workflow_type.upper()]
    if status:
        records = [item for item in records if item["status"] == status.upper()]
    if reconciliation_state:
        records = [item for item in records if item["reconciliation_state"] == reconciliation_state.upper()]
    if actor:
        term = actor.casefold()
        records = [item for item in records if term in (item["actor"] or "").casefold()]
    if filename:
        term = filename.casefold()
        records = [item for item in records if term in item["source_filename"].casefold()]
    if checksum_prefix:
        records = [item for item in records if item["source_checksum"].startswith(checksum_prefix.casefold())]
    if unresolved_only:
        records = [item for item in records if (item["unresolved_total"] or 0) > 0]
    if retry_activity:
        records = [item for item in records if item["retry_attempt_count"] > 0]
    if date_from:
        records = [item for item in records if item["latest_activity_at"] and item["latest_activity_at"][:10] >= date_from.isoformat()]
    if date_to:
        records = [item for item in records if item["latest_activity_at"] and item["latest_activity_at"][:10] <= date_to.isoformat()]
    return _page(records, page, page_size)


def get_upload_record(db: Session, upload_id: str) -> dict:
    workflow, separator, raw_id = upload_id.partition(":")
    if not separator or workflow not in {"attendance", "roster"}:
        raise HTTPException(status_code=404, detail="Upload history record not found")
    if workflow == "attendance":
        batch = db.get(AttendanceImportBatch, raw_id)
        if batch:
            return _attendance_record(db, batch)
    else:
        batch = db.get(AcademicRosterImportBatch, raw_id)
        if batch:
            return _roster_record(db, batch)
    raise HTTPException(status_code=404, detail="Upload history record not found")


def upload_timeline(db: Session, upload_id: str) -> list[dict]:
    record = get_upload_record(db, upload_id)
    raw_id = upload_id.split(":", 1)[1]
    if record["workflow_type"] == "ROSTER":
        batch = db.get(AcademicRosterImportBatch, raw_id)
        session_id = batch.session_id
    else:
        session_id = raw_id
    events = _audit_events(db, session_id)
    timeline = [
        {
            "timestamp": record["first_activity_at"],
            "event": "FILE_RECEIVED",
            "actor": record["actor"],
            "reference_id": upload_id,
            "counts": {"preview_total": record["preview_total"]},
            "reason_code": None,
            "message": "The source file was received and retained as a checksum-backed preview.",
        },
        {
            "timestamp": record["first_activity_at"],
            "event": "PREVIEW_CREATED",
            "actor": record["actor"],
            "reference_id": upload_id,
            "counts": {
                "eligible": record["preview_eligible"],
                "blocked": record["preview_blocked"],
                "invalid": record["invalid_total"],
            },
            "reason_code": None,
            "message": "Preview validation completed without changing live records.",
        },
    ]
    if record["selected_total"] is not None:
        timeline.append({
            "timestamp": record["latest_activity_at"],
            "event": "ROWS_SELECTED",
            "actor": record["actor"],
            "reference_id": upload_id,
            "counts": {"selected": record["selected_total"]},
            "reason_code": None,
            "message": "Stable preview row references were selected for commit.",
        })
    if record["status"] in {"COMMITTED", "RETRIED", "ROLLED_BACK"}:
        timeline.append({
            "timestamp": record["latest_activity_at"],
            "event": "COMMIT_COMPLETED" if not record["rollback_succeeded"] else "COMMIT_ROLLED_BACK",
            "actor": record["actor"],
            "reference_id": upload_id,
            "counts": {"committed": record["committed_total"]},
            "reason_code": None,
            "message": (
                "The recorded commit was later rolled back; successful totals are not claimed."
                if record["rollback_succeeded"]
                else "The selected rows completed the canonical commit workflow."
            ),
        })
    for event in events:
        label = KNOWN_AUDIT_OPERATIONS.get(event.operation)
        metadata = event.audit_metadata if isinstance(event.audit_metadata, dict) else {}
        safe_counts = {
            key: value for key, value in metadata.items()
            if key in {"source_row", "outcome"} and isinstance(value, (str, int, float, bool, type(None)))
        }
        timeline.append({
            "timestamp": _iso(event.occurred_at),
            "event": label or "ADDITIONAL_HISTORICAL_ACTIVITY",
            "actor": event.actor_id,
            "reference_id": event.event_id,
            "counts": safe_counts,
            "reason_code": event.failure_code,
            "message": (
                "Additional historical activity was recorded but cannot be displayed by this version."
                if label is None
                else label.replace("_", " ").title() + "."
            ),
        })
    return sorted(timeline, key=lambda item: (item["timestamp"] or "", item["reference_id"]))


def upload_rows(db: Session, upload_id: str, *, page: int, page_size: int, outcome: str | None = None) -> dict:
    record = get_upload_record(db, upload_id)
    raw_id = upload_id.split(":", 1)[1]
    roster_batch = db.get(AcademicRosterImportBatch, raw_id) if record["workflow_type"] == "ROSTER" else None
    events = _audit_events(db, roster_batch.session_id if roster_batch else raw_id)
    latest_by_ref = {}
    for event in events:
        if event.entity_type == "UPLOAD_CONFLICT":
            latest_by_ref[event.entity_reference] = event
    items = []
    if record["workflow_type"] == "ATTENDANCE":
        rows = db.query(AttendanceImportRow).filter_by(batch_id=raw_id).order_by(AttendanceImportRow.id.asc()).all()
        for row in rows:
            reference = f"attendance:{row.id}"
            latest = latest_by_ref.get(reference)
            retried = bool(latest and "RETRY" in latest.operation)
            committed = bool(row.selected_for_commit)
            unresolved = row.classification == "CONFLICT" and not (latest and latest.operation == "UPLOAD_CONFLICT_RETRY_COMMITTED")
            state = "committed" if committed else "retried" if retried else "unresolved" if unresolved else row.classification.casefold()
            items.append({
                "source_row_number": row.source_row,
                "stable_row_reference": reference,
                "preview_classification": row.classification,
                "selection_state": "SELECTED" if committed else ("NOT_SELECTED" if record["selected_total"] is not None else "UNKNOWN"),
                "commit_outcome": "COMMITTED" if committed else ("NOT_COMMITTED" if record["selected_total"] is not None else "UNKNOWN"),
                "retry_outcome": (
                    "COMMITTED" if latest and latest.operation == "UPLOAD_CONFLICT_RETRY_COMMITTED"
                    else "ATTEMPTED" if retried else "NOT_RETRIED"
                ),
                "technical_code": (row.validation_error or row.classification).split(":", 1)[0],
                "explanation": row.validation_error or row.warning or f"Preview classified this row as {row.classification}.",
                "recommended_action": "Open Needs Attention to resolve and revalidate this row." if unresolved else "No historical action is required.",
                "masked_identifier": _mask(row.student_identifier),
                "resolution_status": "UNRESOLVED" if unresolved else "RESOLVED" if retried else "NOT_APPLICABLE",
                "_filter": state,
            })
    else:
        batch = db.get(AcademicRosterImportBatch, raw_id)
        session = db.get(StudentImportSession, batch.session_id)
        actions = db.query(StudentImportAppliedAction).filter_by(session_id=batch.session_id).all()
        selected_sources = {action.source_row_number for action in actions}
        for row in batch.rows if isinstance(batch.rows, list) else []:
            reference = f"roster:{batch.id}:{row.get('preview_row_id')}"
            latest = latest_by_ref.get(reference)
            selected = row.get("source_row") in selected_sources
            blocked = row.get("classification") in ROSTER_BLOCKED
            resolved = bool(latest and latest.operation in {"UPLOAD_CONFLICT_ROSTER_RESOLVED", "UPLOAD_CONFLICT_RETRY_COMMITTED"})
            state = "committed" if selected else "retried" if latest and "RETRY" in latest.operation else "unresolved" if blocked and not resolved else row.get("classification", "unknown").casefold()
            payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
            items.append({
                "source_row_number": row.get("source_row"),
                "stable_row_reference": reference,
                "preview_classification": row.get("classification") or "UNKNOWN",
                "selection_state": "SELECTED" if selected else ("NOT_SELECTED" if session and session.status == "COMMITTED" else "UNKNOWN"),
                "commit_outcome": "COMMITTED" if selected and not record["rollback_succeeded"] else "ROLLED_BACK" if selected else "UNKNOWN",
                "retry_outcome": "ATTEMPTED" if latest and "RETRY" in latest.operation else "NOT_RETRIED",
                "technical_code": row.get("classification") or "UNKNOWN",
                "explanation": "; ".join(row.get("errors") or []) or "Roster preview classification retained.",
                "recommended_action": "Open Needs Attention to resolve this row." if blocked and not resolved else "No historical action is required.",
                "masked_identifier": _mask(payload.get("student_identifier")),
                "resolution_status": "RESOLVED" if resolved else "UNRESOLVED" if blocked else "NOT_APPLICABLE",
                "_filter": state,
            })
    if outcome:
        normalized = outcome.casefold()
        items = [item for item in items if item["_filter"] == normalized]
    for item in items:
        item.pop("_filter", None)
    return _page(items, page, page_size)


def evidence_document(db: Session, upload_id: str) -> dict:
    summary = get_upload_record(db, upload_id)
    timeline = upload_timeline(db, upload_id)
    rows = upload_rows(db, upload_id, page=1, page_size=10_000)["items"]
    generated_at = datetime.now(timezone.utc).isoformat()
    payload = {
        "format_version": HISTORY_FORMAT_VERSION,
        "generated_at": generated_at,
        "application": "OperatorOS",
        "upload_id": upload_id,
        "workflow_type": summary["workflow_type"],
        "source_checksum": summary["source_checksum"],
        "sanitization_statement": "Local paths, raw rows, secrets, private audit metadata, and unmasked identifiers are excluded.",
        "reconciliation": summary,
        "timeline": timeline,
        "row_outcomes": rows,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    payload["manifest"] = {
        "included_sections": ["reconciliation", "timeline", "row_outcomes"],
        "content_sha256": hashlib.sha256(canonical).hexdigest(),
    }
    return payload


def evidence_json(db: Session, upload_id: str) -> bytes:
    return (json.dumps(evidence_document(db, upload_id), sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def _csv_safe(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        value = json.dumps(value, sort_keys=True, ensure_ascii=False)
    text = str(value)
    if text.startswith(("=", "+", "-", "@")):
        text = "'" + text
    return text


def evidence_csv(db: Session, upload_id: str) -> bytes:
    evidence = evidence_document(db, upload_id)
    headers = ["section", "key", "value", "timestamp", "event", "actor", "reference_id", "source_row", "classification", "selection", "commit_outcome", "retry_outcome", "masked_identifier", "message"]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=headers, lineterminator="\r\n")
    writer.writeheader()
    for key in sorted(evidence["reconciliation"]):
        writer.writerow({"section": "reconciliation", "key": key, "value": _csv_safe(evidence["reconciliation"][key])})
    for event in evidence["timeline"]:
        writer.writerow({
            "section": "timeline", "timestamp": event["timestamp"], "event": event["event"],
            "actor": _csv_safe(event["actor"]), "reference_id": event["reference_id"], "message": _csv_safe(event["message"]),
        })
    for row in evidence["row_outcomes"]:
        writer.writerow({
            "section": "row_outcome", "source_row": row["source_row_number"],
            "reference_id": row["stable_row_reference"], "classification": row["preview_classification"],
            "selection": row["selection_state"], "commit_outcome": row["commit_outcome"],
            "retry_outcome": row["retry_outcome"], "masked_identifier": _csv_safe(row["masked_identifier"]),
            "message": _csv_safe(row["explanation"]),
        })
    return output.getvalue().encode("utf-8")
