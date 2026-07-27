import io
from copy import deepcopy
from datetime import date
from uuid import uuid4

import pytest
from fastapi import HTTPException
from openpyxl import Workbook
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.database import Base
from core.schema_migrations import initialize_fresh_sqlite_database
from models.academic_roster import AcademicRosterImportBatch
from models.attendance import Attendance
from models.attendance_import import AttendanceImportRow
from models.operations_audit import OperationsAuditEvent
from models.student import Student
from models.student_import_session import StudentImportSession
from models.student_master import StudentDeviceIdentity, StudentMaster
from services.academic_roster import roster_preview_checksum
from services.attendance_import_preview import (
    ATTENDANCE_IMPORT_CONFIRMATION,
    create_attendance_preview,
)
from services.student_import_sessions import create_preview_session, mark_preview_ready
from services.student_management import record_version
from services.upload_conflicts import (
    LINK_CONFIRMATION,
    ROSTER_CONFIRMATION,
    attendance_item_id,
    commit_attendance_retry,
    get_upload_conflict,
    link_attendance_device,
    list_upload_conflicts,
    resolve_roster_link,
    retry_attendance_preview,
    roster_comparison,
    roster_item_id,
    student_candidates,
)


HEADERS = [
    "No. ID",
    "Nama",
    "Tanggal",
    "Scan Masuk",
    "Scan Pulang",
    "Terlambat",
    "Lembur",
    "Pengecualian",
    "week",
]


def workbook_bytes(rows):
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(HEADERS)
    for row in rows:
        sheet.append(row)
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


@pytest.fixture
def conflict_db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def enable_fks(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    yield db
    db.close()
    Base.metadata.drop_all(engine)


def create_unmatched(db, identifier=9101, name="Queue Student"):
    batch = create_attendance_preview(
        db,
        workbook_bytes(
            [[identifier, name, "01/07/2026", "07:05", "14:00", "", "", "", "Wednesday"]]
        ),
        "unmatched.xlsx",
        "admin",
    )
    row = db.query(AttendanceImportRow).filter_by(batch_id=batch.id).one()
    return batch, row


def create_target(db, name="Queue Student", status="active", nipd=None):
    student = StudentMaster(
        full_name=name,
        normalized_name=name.casefold(),
        student_status=status,
        nipd=nipd or f"NIPD-{uuid4().hex[:8]}",
    )
    db.add(student)
    db.commit()
    db.refresh(student)
    return student


def test_queue_derives_safe_attendance_provenance_and_filters(conflict_db):
    db = conflict_db
    batch, row = create_unmatched(db)

    result = list_upload_conflicts(
        db,
        workflow_type="ATTENDANCE",
        technical_code="DEVICE_IDENTITY_UNMATCHED",
        page=1,
        page_size=10,
    )

    assert result["total"] == 1
    item = result["items"][0]
    assert item["resolution_item_id"] == attendance_item_id(row.id)
    assert item["source_session_id"] == batch.id
    assert item["source_checksum_prefix"] == batch.checksum[:12]
    assert item["source_row_number"] == 2
    assert item["resolution_status"] == "UNRESOLVED"
    assert item["retry_eligible"] is False
    assert "path" not in item
    assert "student_name" not in item["affected_identifiers"]


def test_fresh_database_bootstrap_supports_upload_conflict_queue(tmp_path):
    target = (tmp_path / "fresh-upload-conflicts.db").resolve()
    assert initialize_fresh_sqlite_database(target) == "MIGRATION_COMPLETE"

    engine = create_engine(f"sqlite:///{target}")
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        columns = {
            row[1]
            for row in db.connection().exec_driver_sql(
                "PRAGMA table_info(operations_audit_events)"
            )
        }
        assert {
            "id",
            "event_id",
            "occurred_at",
            "actor_id",
            "entity_type",
            "entity_reference",
            "operation",
            "metadata",
        } <= columns
        indexes = {
            row[1]
            for row in db.connection().exec_driver_sql(
                "PRAGMA index_list(operations_audit_events)"
            )
        }
        assert "ix_ops_audit_operation_occurred" in indexes
        _, row = create_unmatched(db, identifier=991001, name="Fresh Queue Student")
        result = list_upload_conflicts(db, page=1, page_size=10)
        assert result["total"] == 1
        assert result["items"][0]["resolution_item_id"] == attendance_item_id(row.id)
    finally:
        db.close()
        engine.dispose()


def test_student_search_uses_explicit_stable_result_and_masks_identifiers(conflict_db):
    db = conflict_db
    _, row = create_unmatched(db)
    target = create_target(db)

    candidates = student_candidates(db, attendance_item_id(row.id), target.nipd)

    assert len(candidates) == 1
    assert candidates[0]["id"] == target.id
    assert candidates[0]["record_version"] == record_version(target)
    assert candidates[0]["nipd_masked"] != target.nipd
    assert "nik" not in candidates[0]


def test_link_device_requires_active_versioned_target_and_writes_audit(conflict_db):
    db = conflict_db
    batch, row = create_unmatched(db)
    target = create_target(db)

    result = link_attendance_device(
        db,
        item_id=attendance_item_id(row.id),
        expected_checksum=batch.checksum,
        expected_device_identifier=row.student_identifier,
        student_master_id=target.id,
        expected_student_version=record_version(target),
        confirmation=LINK_CONFIRMATION,
        actor_id="admin",
        actor_role="admin",
    )

    assert result["outcome"] == "LINKED"
    mapping = db.query(StudentDeviceIdentity).filter_by(device_identifier="9101", is_active=True).one()
    assert mapping.student_master_id == target.id
    audit = db.query(OperationsAuditEvent).filter_by(entity_reference=attendance_item_id(row.id)).one()
    assert audit.operation == "UPLOAD_CONFLICT_DEVICE_LINKED"
    assert audit.actor_id == "admin"
    assert audit.audit_metadata["source_row"] == 2


@pytest.mark.parametrize(
    "mutation,expected_code",
    [
        ("inactive", "TARGET_STUDENT_INACTIVE"),
        ("stale", "RESOLUTION_ITEM_STALE"),
        ("checksum", "SOURCE_CHECKSUM_MISMATCH"),
        ("device", "RESOLUTION_ITEM_STALE"),
    ],
)
def test_link_device_fails_closed_for_stale_or_invalid_requests(conflict_db, mutation, expected_code):
    db = conflict_db
    batch, row = create_unmatched(db)
    target = create_target(db, status="inactive" if mutation == "inactive" else "active")
    version = "0" * 64 if mutation == "stale" else record_version(target)
    checksum = "0" * 64 if mutation == "checksum" else batch.checksum
    device = "9999" if mutation == "device" else row.student_identifier

    with pytest.raises(HTTPException) as exc:
        link_attendance_device(
            db,
            item_id=attendance_item_id(row.id),
            expected_checksum=checksum,
            expected_device_identifier=device,
            student_master_id=target.id,
            expected_student_version=version,
            confirmation=LINK_CONFIRMATION,
            actor_id="admin",
            actor_role="admin",
        )

    assert exc.value.detail["code"] == expected_code
    assert db.query(StudentDeviceIdentity).count() == 0


def test_link_device_never_silently_reassigns(conflict_db):
    db = conflict_db
    batch, row = create_unmatched(db)
    target = create_target(db)
    other = create_target(db, name="Other Student")
    legacy = Student(id=9101, name="Other Student")
    db.add(legacy)
    db.flush()
    db.add(
        StudentDeviceIdentity(
            student_master_id=other.id,
            legacy_student_id=legacy.id,
            device_identifier="9101",
            device_source="attendance_machine",
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
    )
    db.commit()

    with pytest.raises(HTTPException) as exc:
        link_attendance_device(
            db,
            item_id=attendance_item_id(row.id),
            expected_checksum=batch.checksum,
            expected_device_identifier="9101",
            student_master_id=target.id,
            expected_student_version=record_version(target),
            confirmation=LINK_CONFIRMATION,
            actor_id="admin",
            actor_role="admin",
        )

    assert exc.value.detail["code"] == "DEVICE_ALREADY_ASSIGNED"
    assert db.query(StudentDeviceIdentity).filter_by(is_active=True).one().student_master_id == other.id


def test_retry_preview_preserves_source_and_never_auto_commits(conflict_db):
    db = conflict_db
    batch, row = create_unmatched(db)
    target = create_target(db)
    link_attendance_device(
        db,
        item_id=attendance_item_id(row.id),
        expected_checksum=batch.checksum,
        expected_device_identifier="9101",
        student_master_id=target.id,
        expected_student_version=record_version(target),
        confirmation=LINK_CONFIRMATION,
        actor_id="admin",
        actor_role="admin",
    )

    result = retry_attendance_preview(
        db,
        item_ids=[attendance_item_id(row.id)],
        expected_source_session_id=batch.id,
        expected_source_checksum=batch.checksum,
        actor_id="admin",
        actor_role="admin",
    )

    assert result["source_session_id"] == batch.id
    assert result["source_checksum"] == batch.checksum
    assert result["outcomes"][0]["source_row"] == row.source_row
    assert result["outcomes"][0]["classification"] == "NEW"
    assert result["outcomes"][0]["outcome"] == "NOW_ELIGIBLE"
    assert db.query(Attendance).count() == 0
    retry_row = db.get(AttendanceImportRow, result["outcomes"][0]["retry_row_id"])
    commit_result = commit_attendance_retry(
        db,
        item_ids=[attendance_item_id(row.id)],
        source_session_id=batch.id,
        source_checksum=batch.checksum,
        retry_batch_id=result["retry_batch_id"],
        retry_checksum=batch.checksum,
        selected_retry_row_ids=[retry_row.id],
        confirmation=ATTENDANCE_IMPORT_CONFIRMATION,
        actor_id="admin",
        actor_role="admin",
    )
    assert db.query(Attendance).count() == 1
    assert retry_row.source_row == 2
    assert commit_result["committed_resolution_item_ids"] == [attendance_item_id(row.id)]
    assert get_upload_conflict(db, attendance_item_id(row.id))["resolution_status"] == "RETRIED_COMMITTED"
    assert (
        db.query(OperationsAuditEvent)
        .filter_by(
            entity_reference=attendance_item_id(row.id),
            operation="UPLOAD_CONFLICT_RETRY_COMMITTED",
        )
        .count()
        == 1
    )


def test_retry_rejects_already_committed_or_wrong_source(conflict_db):
    db = conflict_db
    batch, row = create_unmatched(db)
    row.selected_for_commit = True
    db.commit()

    with pytest.raises(HTTPException) as exc:
        retry_attendance_preview(
            db,
            item_ids=[attendance_item_id(row.id)],
            expected_source_session_id=batch.id,
            expected_source_checksum=batch.checksum,
            actor_id="admin",
            actor_role="admin",
        )

    assert exc.value.detail["code"] == "RETRY_ROW_ALREADY_COMMITTED"


def create_roster_conflict(db, student):
    session = create_preview_session(
        db,
        import_type="STUDENT_ROSTER",
        filename="roster.xlsx",
        file_checksum="a" * 64,
        actor="admin",
    )
    rows = [
        {
            "preview_row_id": 1,
            "source_sheet": "Roster",
            "source_row": 2,
            "classification": "POSSIBLE_DUPLICATE",
            "matched_student_master_id": None,
            "match_rule": "ambiguous_name_birth_date",
            "payload": {
                "student_identifier": "9201",
                "student_name": student.full_name,
                "student_master_id": None,
                "nipd": student.nipd,
                "nisn": student.nisn,
                "nik": student.nik,
                "academic_year": "2026/2027",
                "jenjang": "Primary",
                "class_name": "P1A",
                "program": "Primary",
                "status": "active",
            },
            "errors": ["Identity match is ambiguous"],
        }
    ]
    batch = AcademicRosterImportBatch(
        session_id=session.id,
        filename="roster.xlsx",
        checksum="a" * 64,
        source_owner="Registrar",
        date_received=date(2026, 7, 1),
        created_by="admin",
        rows=rows,
        summary={"total": 1, "possible_duplicate": 1},
    )
    db.add(batch)
    db.flush()
    mark_preview_ready(session, checksum=roster_preview_checksum(rows), row_count=1)
    db.commit()
    return batch


def test_roster_queue_comparison_and_explicit_stable_link(conflict_db):
    db = conflict_db
    target = create_target(db)
    batch = create_roster_conflict(db, target)
    item_id = roster_item_id(batch.id, 1)

    queue = list_upload_conflicts(db, workflow_type="ROSTER")
    assert queue["total"] == 1
    assert queue["items"][0]["technical_code"] == "POSSIBLE_DUPLICATE"

    comparison = roster_comparison(db, item_id, target.id)
    assert comparison["student"]["id"] == target.id
    assert any(field["classification"] == "SAME" for field in comparison["fields"])

    result = resolve_roster_link(
        db,
        item_id=item_id,
        expected_checksum=batch.checksum,
        student_master_id=target.id,
        expected_student_version=record_version(target),
        confirmation=ROSTER_CONFIRMATION,
        actor_id="admin",
        actor_role="admin",
    )

    assert result["outcome"] == "RESOLVED_PENDING_RETRY"
    audit = db.query(OperationsAuditEvent).filter_by(entity_reference=item_id).one()
    assert audit.audit_metadata["resolution_plan"] == "LINK_ROW_TO_EXISTING_STUDENT"
    assert "nipd" not in audit.audit_metadata


def test_roster_immutable_identifier_conflict_remains_blocked(conflict_db):
    db = conflict_db
    target = create_target(db)
    batch = create_roster_conflict(db, target)
    rows = deepcopy(batch.rows)
    rows[0]["payload"]["nipd"] = "OTHER-NIPD"
    batch.rows = rows
    db.commit()

    with pytest.raises(HTTPException) as exc:
        resolve_roster_link(
            db,
            item_id=roster_item_id(batch.id, 1),
            expected_checksum=batch.checksum,
            student_master_id=target.id,
            expected_student_version=record_version(target),
            confirmation=ROSTER_CONFIRMATION,
            actor_id="admin",
            actor_role="admin",
        )

    assert exc.value.detail["code"] == "IMMUTABLE_FIELD_CONFLICT"
    assert db.query(OperationsAuditEvent).count() == 0
