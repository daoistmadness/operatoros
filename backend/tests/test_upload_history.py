from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.database import Base
from models.academic_roster import AcademicRosterImportBatch
from models.attendance_import import AttendanceImportBatch, AttendanceImportRow
from models.operations_audit import OperationsAuditEvent
from models.student_import_session import StudentImportAppliedAction, StudentImportSession
from services.upload_history import (
    evidence_csv,
    evidence_json,
    get_upload_record,
    list_upload_history,
    upload_rows,
    upload_timeline,
)


@pytest.fixture
def history_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    yield db
    db.close()
    Base.metadata.drop_all(engine)


def attendance_batch(db, *, status="preview", filename="attendance.xlsx"):
    batch = AttendanceImportBatch(
        filename=filename,
        checksum="a" * 64,
        uploaded_by="operator",
        status=status,
        total_rows=3,
        logical_rows=3,
        commit_result=(
            {"rows_inserted": 1, "rows_updated": 0, "rows_unchanged": 1, "new_students": 0}
            if status == "committed" else None
        ),
        committed_at=datetime.utcnow() if status == "committed" else None,
    )
    db.add(batch)
    db.flush()
    rows = [
        AttendanceImportRow(batch_id=batch.id, source_row=2, student_identifier="00123456", classification="NEW", selected_for_commit=status == "committed"),
        AttendanceImportRow(batch_id=batch.id, source_row=3, student_identifier="00999999", classification="UNCHANGED", selected_for_commit=status == "committed"),
        AttendanceImportRow(batch_id=batch.id, source_row=4, student_identifier="00111111", classification="CONFLICT", validation_error="DEVICE_IDENTITY_UNMATCHED: blocked"),
    ]
    db.add_all(rows)
    db.commit()
    return batch, rows


def roster_batch(db, *, committed=True, rollback_state="AVAILABLE"):
    session = StudentImportSession(
        import_type="STUDENT_ROSTER",
        status="COMMITTED" if committed else "PREVIEW_READY",
        provenance_status="COMPLETE_ACTION_PROVENANCE",
        created_by="roster-admin",
        expires_at=datetime.utcnow() + timedelta(days=1),
        source_filename="C:\\private\\=unsafe-roster.xlsx",
        source_file_checksum="b" * 64,
        row_count=2,
        selected_row_count=1 if committed else 0,
        applied_action_count=1 if committed else 0,
        rollback_state=rollback_state,
    )
    db.add(session)
    db.flush()
    batch = AcademicRosterImportBatch(
        session_id=session.id,
        filename="C:\\private\\=unsafe-roster.xlsx",
        checksum="b" * 64,
        source_owner="school",
        date_received=date.today(),
        created_by="roster-admin",
        status="committed" if committed else "preview",
        rows=[
            {"preview_row_id": 1, "source_row": 2, "classification": "CREATE_ENROLLMENT", "payload": {"student_identifier": "00001234"}, "errors": []},
            {"preview_row_id": 2, "source_row": 3, "classification": "POSSIBLE_DUPLICATE", "payload": {"student_identifier": "=unsafe"}, "errors": ["Identity match is ambiguous"]},
        ],
        summary={"total": 2},
        commit_result={"status": "committed", "created": 1, "students_created": 0} if committed else None,
        committed_at=datetime.utcnow() if committed else None,
    )
    db.add(batch)
    db.flush()
    if committed:
        db.add(StudentImportAppliedAction(
            session_id=session.id,
            academic_roster_import_batch_id=batch.id,
            source_row_number=2,
            action_sequence=1,
            action_type="CREATE_ENROLLMENT",
            entity_type="STUDENT_ENROLLMENT",
            entity_id="1",
            entity_reference="enrollment:1",
            operation_id="operation-roster-1",
            applied_by="roster-admin",
            before_state=None,
            after_state={"id": 1},
            after_state_checksum="c" * 64,
            dependency_checkpoint={},
            compensation_type="END_ENROLLMENT",
            rollback_eligibility="ELIGIBLE",
        ))
    db.commit()
    return session, batch


def test_preview_only_attendance_is_truthfully_incomplete(history_db):
    batch, _ = attendance_batch(history_db)
    record = get_upload_record(history_db, f"attendance:{batch.id}")
    assert record["status"] == "UNRESOLVED"
    assert record["preview_total"] == 3
    assert record["preview_eligible"] == 2
    assert record["selected_total"] is None
    assert record["reconciliation_state"] == "INCOMPLETE"


def test_committed_attendance_balances_without_counting_blocked_row(history_db):
    batch, _ = attendance_batch(history_db, status="committed")
    record = get_upload_record(history_db, f"attendance:{batch.id}")
    assert record["selected_total"] == 2
    assert record["committed_total"] == 2
    assert record["unresolved_total"] == 1
    assert record["reconciliation_state"] == "BALANCED_WITH_UNRESOLVED"


def test_retry_totals_are_isolated_and_latest_conflict_is_resolved(history_db):
    batch, rows = attendance_batch(history_db, status="committed")
    conflict = rows[-1]
    history_db.add_all([
        OperationsAuditEvent(
            actor_id="operator", actor_role="admin", capability="import_attendance",
            entity_type="UPLOAD_CONFLICT", entity_reference=f"attendance:{conflict.id}",
            operation="UPLOAD_CONFLICT_RETRY_PREVIEW", import_session_id=batch.id,
            audit_metadata={"retry_batch_id": "retry-1", "retry_row_id": 10, "source_row": 4},
        ),
        OperationsAuditEvent(
            actor_id="operator", actor_role="admin", capability="import_attendance",
            entity_type="UPLOAD_CONFLICT", entity_reference=f"attendance:{conflict.id}",
            operation="UPLOAD_CONFLICT_RETRY_COMMITTED", import_session_id=batch.id,
            audit_metadata={"retry_batch_id": "retry-1", "retry_row_id": 10, "source_row": 4},
        ),
    ])
    history_db.commit()
    record = get_upload_record(history_db, f"attendance:{batch.id}")
    assert record["committed_total"] == 2
    assert record["retry_committed_total"] == 1
    assert record["unresolved_total"] == 0
    assert record["status"] == "RETRIED"


def test_roster_commit_and_rollback_truthfulness(history_db):
    session, batch = roster_batch(history_db, rollback_state="APPLIED")
    record = get_upload_record(history_db, f"roster:{batch.id}")
    assert record["status"] == "ROLLED_BACK"
    assert record["committed_total"] == 0
    assert record["created_total"] == 0
    assert record["rollback_attempted"] is True
    assert record["rollback_succeeded"] is True
    assert session.id


def test_history_filters_paginate_and_strip_local_paths(history_db):
    attendance_batch(history_db, filename="/home/operator/private/attendance.xlsx")
    roster_batch(history_db)
    result = list_upload_history(history_db, page=1, page_size=1, workflow_type="ROSTER", filename="roster")
    assert result["total"] == 1
    assert result["pages"] == 1
    assert result["items"][0]["source_filename"] == "=unsafe-roster.xlsx"
    assert "/" not in result["items"][0]["source_filename"]


def test_unknown_event_is_retained_and_fails_closed(history_db):
    batch, _ = attendance_batch(history_db)
    history_db.add(OperationsAuditEvent(
        actor_id="operator", actor_role="admin", capability="import_attendance",
        entity_type="UPLOAD", entity_reference=batch.id, operation="FUTURE_SECRET_EVENT",
        import_session_id=batch.id, audit_metadata={"password": "never-export", "path": "/private/file"},
    ))
    history_db.commit()
    record = get_upload_record(history_db, f"attendance:{batch.id}")
    timeline = upload_timeline(history_db, f"attendance:{batch.id}")
    assert record["reconciliation_state"] == "INCOMPLETE"
    assert any(item["event"] == "ADDITIONAL_HISTORICAL_ACTIVITY" for item in timeline)
    assert "never-export" not in str(timeline)
    assert "/private/file" not in str(timeline)


def test_row_outcomes_use_stable_refs_mask_identifiers_and_filter(history_db):
    batch, _ = attendance_batch(history_db, status="committed")
    result = upload_rows(history_db, f"attendance:{batch.id}", page=1, page_size=10, outcome="committed")
    assert result["total"] == 2
    assert all(item["stable_row_reference"].startswith("attendance:") for item in result["items"])
    assert all(item["masked_identifier"].endswith(("3456", "9999")) for item in result["items"])
    assert "00123456" not in str(result)


def test_exports_are_deterministic_sanitized_and_formula_safe(history_db):
    _, batch = roster_batch(history_db)
    upload_id = f"roster:{batch.id}"
    csv_bytes = evidence_csv(history_db, upload_id)
    json_bytes = evidence_json(history_db, upload_id)
    assert b"'=unsafe-roster.xlsx" in csv_bytes
    assert b"C:\\\\private" not in csv_bytes
    assert b"00001234" not in csv_bytes
    payload = json_bytes.decode()
    assert '"format_version": "1.0"' in payload
    assert '"content_sha256"' in payload
    assert "private audit metadata" in payload
    assert "C:\\\\private" not in payload
