from datetime import date
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.student_masters import router
from core.database import Base, get_db
from models.academic_year import AcademicYear
from models.attendance import Attendance
from models.attendance_review import AttendanceOverrideHistory
from models.jenjang import Jenjang
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.student_master import (
    StudentDeviceIdentity,
    StudentMaster,
    StudentMasterChangeHistory,
)
from models.user import User
from security.dependencies import get_current_user
from services.student_normalization import (
    mask_identifier,
    normalize_birth_date,
    normalize_gender,
    normalize_name,
    normalize_nisn,
    normalize_phone,
)


@pytest.fixture
def foundation_db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        for table_name in ("attendance_override_history", "student_master_change_history"):
            connection.execute(text(
                f"CREATE TRIGGER trg_{table_name}_no_update BEFORE UPDATE ON {table_name} "
                f"BEGIN SELECT RAISE(FAIL, '{table_name} is append-only'); END"
            ))
            connection.execute(text(
                f"CREATE TRIGGER trg_{table_name}_no_delete BEFORE DELETE ON {table_name} "
                f"BEGIN SELECT RAISE(FAIL, '{table_name} is append-only'); END"
            ))
    Session = sessionmaker(bind=engine)
    db = Session()
    yield engine, db
    db.close()
    Base.metadata.drop_all(engine)


def test_normalization_is_deterministic_and_identifiers_remain_strings():
    assert normalize_name("  Siti   Åminah ") == "siti åminah"
    assert normalize_nisn("001234") == "001234"
    assert normalize_gender("P") == "female"
    assert normalize_phone("+62 (812) 345") == "+62812345"
    assert normalize_birth_date("31/12/2012") == date(2012, 12, 31)
    assert mask_identifier("0012345678") == "******5678"


def test_duplicate_names_allowed_but_non_null_identifiers_unique(foundation_db):
    _engine, db = foundation_db
    db.add_all([
        StudentMaster(full_name="Same Name", normalized_name="same name", nisn="001"),
        StudentMaster(full_name="Same Name", normalized_name="same name", nisn="002"),
    ])
    db.commit()
    assert db.query(StudentMaster).count() == 2

    db.add(StudentMaster(full_name="Third", normalized_name="third", nisn="001"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_device_identity_is_historical_and_deletes_are_restricted(foundation_db):
    _engine, db = foundation_db
    legacy = Student(id=991, name="Legacy Student")
    master = StudentMaster(full_name="Master Student", normalized_name="master student")
    db.add_all([legacy, master])
    db.flush()
    db.add_all([
        StudentDeviceIdentity(
            student_master_id=master.id, legacy_student_id=legacy.id,
            device_identifier="00077", device_source="fingerprint-main",
            effective_from=date(2025, 7, 1), effective_to=date(2026, 6, 30), is_active=False,
        ),
        StudentDeviceIdentity(
            student_master_id=master.id, legacy_student_id=legacy.id,
            device_identifier="00077", device_source="fingerprint-main",
            effective_from=date(2026, 7, 1), is_active=True,
        ),
    ])
    db.commit()
    assert db.query(StudentDeviceIdentity).count() == 2

    db.add(StudentDeviceIdentity(
        student_master_id=master.id, legacy_student_id=legacy.id,
        device_identifier="00077", device_source="fingerprint-main",
        effective_from=date(2027, 7, 1), is_active=True,
    ))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()

    db.delete(master)
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    assert db.query(StudentDeviceIdentity).count() == 2


def test_student_change_history_is_append_only(foundation_db):
    _engine, db = foundation_db
    master = StudentMaster(full_name="History Student", normalized_name="history student")
    db.add(master)
    db.flush()
    history = StudentMasterChangeHistory(
        student_master_id=master.id,
        action="create",
        source="manual",
        changed_by="admin",
    )
    db.add(history)
    db.commit()
    history.action = "tampered"
    with pytest.raises(Exception, match="append-only"):
        db.commit()
    db.rollback()

    with pytest.raises(Exception, match="append-only"):
        db.delete(history)
        db.commit()
    db.rollback()


def test_enrollment_keeps_legacy_link_and_accepts_optional_master_link(foundation_db):
    _engine, db = foundation_db
    columns = {column.name: column for column in StudentEnrollment.__table__.columns}
    assert columns["student_id"].nullable is True
    assert next(iter(columns["student_id"].foreign_keys)).ondelete == "SET NULL"
    assert columns["student_master_id"].nullable is True


def test_authenticated_api_masks_identifiers_and_private_profiles(foundation_db):
    _engine, db = foundation_db
    master = StudentMaster(
        full_name="API Student",
        normalized_name="api student",
        nipd="00001234",
        nisn="00998877",
        nik="3201000012345678",
    )
    db.add(master)
    db.commit()

    app = FastAPI()
    app.include_router(router, prefix="/api/student-masters")
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    assert client.get("/api/student-masters").status_code == 401

    app.dependency_overrides[get_current_user] = lambda: User(
        id=1, username="staff", password_hash="unused", role="staff", is_active=True
    )
    response = client.get("/api/student-masters")
    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["nisn_masked"] == "****8877"
    assert "nisn" not in item
    assert "contacts" not in item
    assert client.get(f"/api/student-masters/{master.id}/device-identities").status_code == 403


def test_sqlite_migration_is_additive_and_idempotent(tmp_path):
    import sqlite3

    database = sqlite3.connect(tmp_path / "migration.db")
    database.executescript("""
        PRAGMA foreign_keys=ON;
        CREATE TABLE students (id INTEGER PRIMARY KEY);
        CREATE TABLE attendance_override_history (id INTEGER PRIMARY KEY, note TEXT);
        INSERT INTO students(id) VALUES (1);
        INSERT INTO attendance_override_history(id, note) VALUES (1, 'original');
    """)
    migration = (
        Path(__file__).resolve().parents[1]
        / "migrations"
        / "20260716_student_master_foundation_sqlite.sql"
    ).read_text(encoding="utf-8")
    database.executescript(migration)
    database.executescript(migration)
    assert database.execute("SELECT COUNT(*) FROM students").fetchone()[0] == 1
    assert database.execute("SELECT COUNT(*) FROM attendance_override_history").fetchone()[0] == 1
    database.execute("INSERT INTO attendance_override_history(id, note) VALUES (2, 'allowed')")
    assert database.execute("SELECT COUNT(*) FROM attendance_override_history").fetchone()[0] == 2
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        database.execute("UPDATE attendance_override_history SET note='changed' WHERE id=1")
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        database.execute("DELETE FROM attendance_override_history WHERE id=1")
    database.close()


def test_postgresql_migration_uses_boolean_safe_checks_and_restrict_fks():
    migration = (
        Path(__file__).resolve().parents[1]
        / "migrations"
        / "20260716_student_master_foundation_postgresql.sql"
    ).read_text(encoding="utf-8")
    assert "CHECK(NOT is_active OR effective_to IS NULL)" in migration
    assert "is_active = 0" not in migration
    assert "ON DELETE RESTRICT" in migration
    assert "ADD COLUMN IF NOT EXISTS student_master_id" in migration
