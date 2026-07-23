import io
from datetime import date, time

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.database import Base
from core.database import get_db
from api.uploads import router as uploads_router
from models.attendance import Attendance
from models.attendance_import import AttendanceImportBatch, AttendanceImportRow
from models.attendance_review import AttendanceOverride
from models.student import Student
from models.student_master import StudentDeviceIdentity, StudentMaster
from models.upload_log import UploadLog
from models.user import User
from security.dependencies import get_current_user
from services.attendance_import_preview import (
    ATTENDANCE_IMPORT_CONFIRMATION,
    commit_attendance_preview,
    create_attendance_preview,
)


HEADERS = [
    "No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang",
    "Terlambat", "Absent", "Lembur", "Pengecualian", "week",
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


def source_row(student_id, name, day="01/07/2026", check_in="07:00", check_out="14:00"):
    return [student_id, name, day, check_in, check_out, "", "", "", "", "Wednesday"]


def add_device_identity(db, student_id, name):
    student = Student(id=student_id, name=name)
    master = StudentMaster(
        full_name=name,
        normalized_name=name.lower(),
        student_status="active",
    )
    db.add_all([student, master])
    db.flush()
    db.add(StudentDeviceIdentity(
        student_master_id=master.id,
        legacy_student_id=student.id,
        device_identifier=str(student_id),
        device_source="attendance_device",
        effective_from=date(2026, 1, 1),
        is_active=True,
    ))
    db.commit()
    return student


@pytest.fixture
def preview_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def enable_fks(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    yield db
    db.close()
    Base.metadata.drop_all(engine)


def test_preview_keeps_unmatched_identity_unresolved_without_creating_records(preview_db):
    db = preview_db
    payload = source_row(9101, "New Student")
    batch = create_attendance_preview(db, workbook_bytes([payload, payload]), "term4.xlsx", "admin")

    assert db.query(Student).count() == 0
    assert db.query(Attendance).count() == 0
    assert db.query(UploadLog).count() == 0
    assert batch.total_rows == 2
    assert batch.logical_rows == 1
    assert batch.new_records == 0
    assert batch.new_students == 0
    row = db.query(AttendanceImportRow).filter_by(batch_id=batch.id).one()
    assert row.classification == "CONFLICT"
    assert row.validation_error.startswith("DEVICE_IDENTITY_UNMATCHED")
    assert "duplicate" in row.warning.lower()
    assert db.query(StudentMaster).count() == 0


def test_preview_retains_invalid_source_rows_in_staging(preview_db):
    db = preview_db
    invalid = source_row(None, "Missing Identifier")
    batch = create_attendance_preview(db, workbook_bytes([invalid]), "invalid.xlsx", "admin")
    row = db.query(AttendanceImportRow).filter_by(batch_id=batch.id).one()
    assert batch.invalid_records == 1
    assert row.classification == "INVALID"
    assert row.source_row == 2
    assert db.query(Student).count() == 0
    assert db.query(Attendance).count() == 0


def test_preview_endpoint_requires_authentication_and_admin_role(preview_db):
    db = preview_db
    app = FastAPI()
    app.include_router(uploads_router, prefix="/api/uploads")
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    files = {"file": ("preview.xlsx", workbook_bytes([source_row(9150, "Endpoint")]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}

    assert client.post("/api/uploads/preview", files=files).status_code == 401
    assert client.post(
        "/api/uploads/preview/not-a-batch/commit",
        json={"selected_row_ids": [1], "confirmation": ATTENDANCE_IMPORT_CONFIRMATION},
    ).status_code == 401
    app.dependency_overrides[get_current_user] = lambda: User(id=2, username="staff", role="staff", is_active=True)
    assert client.post("/api/uploads/preview", files=files).status_code == 403
    assert client.post(
        "/api/uploads/preview/not-a-batch/commit",
        json={"selected_row_ids": [1], "confirmation": ATTENDANCE_IMPORT_CONFIRMATION},
    ).status_code == 403
    legacy = client.post("/api/uploads/upload", files=files)
    assert legacy.status_code == 403
    app.dependency_overrides[get_current_user] = lambda: User(id=1, username="admin", role="admin", is_active=True)
    response = client.post("/api/uploads/preview", files=files)
    assert response.status_code == 200
    assert response.json()["summary"]["conflicts"] == 1
    disabled = client.post("/api/uploads/upload", files=files)
    assert disabled.status_code == 410
    assert disabled.json()["detail"]["code"] == "LEGACY_ATTENDANCE_IMPORT_DISABLED"


def test_preview_classifies_unchanged_difference_and_identity_conflict(preview_db):
    db = preview_db
    add_device_identity(db, 9201, "Existing One")
    add_device_identity(db, 9202, "Existing Two")
    db.add_all([
        Attendance(student_id=9201, date=date(2026, 7, 1), check_in=time(7), check_out=time(14), late_duration=0, late_source="none", is_absent=False, week="Wednesday", status="on-time"),
        Attendance(student_id=9202, date=date(2026, 7, 1), check_in=time(7), check_out=time(14), late_duration=0, late_source="none", is_absent=False, week="Wednesday", status="on-time"),
    ])
    db.commit()
    rows = [
        source_row(9201, "Existing One"),
        source_row(9202, "Existing Two", check_out="15:00"),
        source_row(9300, "Reserved Name"),
    ]
    batch = create_attendance_preview(db, workbook_bytes(rows), "changes.xlsx", "admin")
    staged = db.query(AttendanceImportRow).filter_by(batch_id=batch.id).order_by(AttendanceImportRow.id).all()

    assert [row.classification for row in staged] == ["UNCHANGED", "DIFFERENCE", "CONFLICT"]
    assert staged[1].existing_record["check_out"] == "14:00:00"
    assert staged[1].proposed_change["check_out"] == "15:00:00"
    assert staged[2].validation_error.startswith("DEVICE_IDENTITY_UNMATCHED")


def test_commit_requires_token_and_rejects_conflicts_without_partial_mutation(preview_db):
    db = preview_db
    add_device_identity(db, 9401, "Safe One")
    add_device_identity(db, 9402, "Safe Two")
    batch = create_attendance_preview(
        db,
        workbook_bytes([source_row(9401, "Safe One"), source_row(9402, "Safe Two")]),
        "atomic.xlsx",
        "admin",
    )
    staged = db.query(AttendanceImportRow).filter_by(batch_id=batch.id).order_by(AttendanceImportRow.id).all()
    staged[1].classification = "CONFLICT"
    staged[1].validation_error = "Forced test conflict"
    db.commit()

    with pytest.raises(HTTPException) as bad_token:
        commit_attendance_preview(db, batch.id, [staged[0].id], "wrong", "admin")
    assert bad_token.value.status_code == 400

    with pytest.raises(HTTPException) as conflict:
        commit_attendance_preview(db, batch.id, [row.id for row in staged], ATTENDANCE_IMPORT_CONFIRMATION, "admin")
    assert conflict.value.status_code == 409
    assert db.query(Student).count() == 2
    assert db.query(Attendance).count() == 0
    assert db.get(AttendanceImportBatch, batch.id).status == "preview"


def test_commit_is_atomic_idempotent_and_writes_upload_history(preview_db):
    db = preview_db
    add_device_identity(db, 9501, "Committed")
    batch = create_attendance_preview(db, workbook_bytes([source_row(9501, "Committed")]), "commit.xlsx", "admin")
    row = db.query(AttendanceImportRow).filter_by(batch_id=batch.id).one()
    first = commit_attendance_preview(db, batch.id, [row.id], ATTENDANCE_IMPORT_CONFIRMATION, "admin")
    second = commit_attendance_preview(db, batch.id, [row.id], ATTENDANCE_IMPORT_CONFIRMATION, "admin")

    assert first == second
    assert first["rows_inserted"] == 1
    assert db.query(Student).count() == 1
    assert db.query(Attendance).count() == 1
    assert db.query(UploadLog).count() == 1
    assert db.query(UploadLog).one().uploaded_by == "admin"


def test_commit_detects_stale_preview_and_rolls_back_all_rows(preview_db):
    db = preview_db
    add_device_identity(db, 9601, "Existing")
    add_device_identity(db, 9602, "Would Roll Back")
    attendance = Attendance(student_id=9601, date=date(2026, 7, 1), check_in=time(7), check_out=time(14), late_duration=0, late_source="none", is_absent=False, status="on-time")
    db.add(attendance)
    db.commit()
    batch = create_attendance_preview(
        db,
        workbook_bytes([source_row(9602, "Would Roll Back"), source_row(9601, "Existing", check_out="15:00")]),
        "stale.xlsx",
        "admin",
    )
    rows = db.query(AttendanceImportRow).filter_by(batch_id=batch.id).order_by(AttendanceImportRow.id).all()
    attendance.check_out = time(13)
    db.commit()

    with pytest.raises(HTTPException) as stale:
        commit_attendance_preview(db, batch.id, [row.id for row in rows], ATTENDANCE_IMPORT_CONFIRMATION, "admin")
    assert stale.value.status_code == 409
    assert db.get(Student, 9602) is not None
    assert db.query(Attendance).count() == 1
    assert db.get(AttendanceImportBatch, batch.id).status == "preview"


def test_preview_and_commit_preserve_admin_override(preview_db):
    db = preview_db
    add_device_identity(db, 9701, "Reviewed")
    attendance = Attendance(student_id=9701, date=date(2026, 7, 1), check_in=time(7), check_out=time(14), late_duration=0, late_source="none", is_absent=False, status="on-time")
    db.add(attendance)
    db.flush()
    override = AttendanceOverride(attendance_id=attendance.id, original_status="on-time", override_status="sakit", note="Medical note", reviewed_by="admin")
    db.add(override)
    db.commit()

    batch = create_attendance_preview(db, workbook_bytes([source_row(9701, "Reviewed", check_out="15:00")]), "override.xlsx", "admin")
    row = db.query(AttendanceImportRow).filter_by(batch_id=batch.id).one()
    assert "override exists" in row.warning.lower()
    commit_attendance_preview(db, batch.id, [row.id], ATTENDANCE_IMPORT_CONFIRMATION, "admin")
    db.refresh(override)
    assert override.override_status == "sakit"
    assert override.note == "Medical note"
    assert override.attendance_id == attendance.id
