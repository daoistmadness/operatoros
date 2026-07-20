from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.student_import_session import StudentImportAppliedAction, StudentImportSession


SESSION_NAMESPACE = uuid.UUID("9e81c7d8-e73f-4eac-bb72-d55b004297e1")


def legacy_session_uuid(model_type: str, batch_id: str) -> str:
    return str(uuid.uuid5(SESSION_NAMESPACE, f"{model_type}:{batch_id}"))


def backfill_legacy_sessions(db: Session) -> int:
    from models.academic_roster import AcademicRosterImportBatch
    from models.student_master import StudentImportBatch

    created = 0
    for model, import_type, label in (
        (StudentImportBatch, "STUDENT_DATA_UPDATE", "student-update"),
        (AcademicRosterImportBatch, "STUDENT_ROSTER", "academic-roster"),
    ):
        for batch in db.query(model).filter(model.session_id.is_(None)).order_by(model.id).all():
            stable_uuid = legacy_session_uuid(label, batch.id)
            session = db.query(StudentImportSession).filter_by(session_uuid=stable_uuid).first()
            if session is None:
                checksum = getattr(batch, "file_checksum", None) or getattr(batch, "checksum")
                filename = batch.filename
                session = StudentImportSession(
                    session_uuid=stable_uuid, import_type=import_type,
                    status="COMMITTED" if batch.status == "committed" else "ARCHIVED",
                    provenance_status="LEGACY_PROVENANCE_UNAVAILABLE", rollback_state="NOT_AVAILABLE",
                    created_by=batch.created_by, committed_by=getattr(batch, "committed_by", None),
                    committed_at=getattr(batch, "committed_at", None), expires_at=batch.created_at + timedelta(hours=24),
                    source_filename=filename, source_file_checksum=checksum,
                    idempotency_key=None,
                    row_count=getattr(batch, "total_rows", 0) or len(getattr(batch, "rows", []) or []),
                    session_metadata={"legacy_batch_model": model.__tablename__, "legacy_batch_id": batch.id, "migration_revision": "20260722_s39", "backfill_version": "1"},
                )
                db.add(session); db.flush(); created += 1
            batch.session_id = session.id
    db.flush()
    return created


def create_preview_session(db: Session, *, import_type: str, filename: str, file_checksum: str, actor: str) -> StudentImportSession:
    session_uuid = str(uuid.uuid4())
    row = StudentImportSession(
        session_uuid=session_uuid, import_type=import_type, status="PREVIEW_CREATED",
        provenance_status="PROVENANCE_FAILED", rollback_state="NOT_AVAILABLE",
        created_by=actor, expires_at=datetime.now() + timedelta(hours=24),
        source_filename=filename, source_file_checksum=file_checksum,
        idempotency_key=hashlib.sha256(f"{session_uuid}:{file_checksum}".encode()).hexdigest(),
    )
    db.add(row); db.flush(); return row


def mark_preview_ready(session: StudentImportSession, *, checksum: str, row_count: int) -> None:
    if session.status != "PREVIEW_CREATED":
        raise HTTPException(status_code=409, detail="Import session is not awaiting a preview")
    session.preview_checksum = checksum; session.row_count = row_count; session.status = "PREVIEW_READY"


def validate_commit_session(session: StudentImportSession | None, *, import_type: str, actor: str, preview_checksum: str) -> None:
    if session is None or session.import_type != import_type:
        raise HTTPException(status_code=409, detail="Import session ownership is invalid")
    if session.created_by != actor:
        raise HTTPException(status_code=403, detail="Import session belongs to another operator")
    if session.status == "COMMITTED":
        return
    if session.status != "PREVIEW_READY" or session.preview_checksum != preview_checksum:
        raise HTTPException(status_code=409, detail="Import session preview is stale")
    if session.expires_at < datetime.now():
        session.status = "PREVIEW_EXPIRED"
        raise HTTPException(status_code=409, detail="Import session expired")


def state_checksum(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str, separators=(",", ":")).encode()).hexdigest()


def operation_id(session: StudentImportSession, source_row: int, sequence: int, action: str) -> str:
    payload = f"{session.session_uuid}:{source_row}:{sequence}:{action}:{session.preview_checksum}"
    return hashlib.sha256(payload.encode()).hexdigest()


def append_action(db: Session, session: StudentImportSession, *, source_row: int, sequence: int, action_type: str, entity_type: str, entity_id, actor: str, before_state, after_state, compensation_type: str, eligibility: str, student_batch_id: str | None = None, roster_batch_id: str | None = None, parent_action_id: int | None = None) -> StudentImportAppliedAction:
    safe_before = before_state
    safe_after = after_state
    row = StudentImportAppliedAction(
        session_id=session.id, student_import_batch_id=student_batch_id,
        academic_roster_import_batch_id=roster_batch_id, source_row_number=source_row,
        action_sequence=sequence, action_type=action_type, entity_type=entity_type,
        entity_id=str(entity_id), entity_reference=hashlib.sha256(f"{entity_type}:{entity_id}".encode()).hexdigest()[:32],
        operation_id=operation_id(session, source_row, sequence, action_type), parent_action_id=parent_action_id,
        applied_by=actor, before_state=safe_before, after_state=safe_after,
        before_state_checksum=state_checksum(safe_before) if safe_before is not None else None,
        after_state_checksum=state_checksum(safe_after), dependency_checkpoint=safe_after,
        compensation_type=compensation_type, rollback_eligibility=eligibility,
    )
    db.add(row); db.flush(); return row


def mark_committed(session: StudentImportSession, *, actor: str, selected_count: int, action_count: int) -> None:
    session.status = "COMMITTED"; session.provenance_status = "COMPLETE_ACTION_PROVENANCE"
    session.rollback_state = "AVAILABLE"; session.committed_at = datetime.now(); session.committed_by = actor
    session.selected_row_count = selected_count; session.applied_action_count = action_count
    session.commit_checksum = state_checksum({"preview": session.preview_checksum, "selected": selected_count, "actions": action_count})
