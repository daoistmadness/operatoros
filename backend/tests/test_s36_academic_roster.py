import io
import sqlite3
from datetime import date, datetime
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.student_enrollments import router
from core.database import Base, get_db
from models.academic_mapping import StudentAcademicMappingRule
from models.academic_master import AcademicClass, AcademicGrade, AcademicProgram
from models.academic_roster import AcademicRosterImportBatch
from models.academic_year import AcademicYear
from models.attendance import Attendance
from models.jenjang import Jenjang
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.student_master import StudentDeviceIdentity, StudentMaster
from models.user import User
from security.dependencies import get_current_user
from services.academic_roster import ROSTER_CONFIRMATION, commit_roster_preview, create_roster_preview


HEADERS = [
    "student_identifier", "student_name", "student_master_id", "nipd", "nisn", "nik",
    "birth_date", "academic_year", "jenjang", "class_name", "program", "status", "start_date",
]


def workbook_bytes(rows):
    workbook = Workbook(); sheet = workbook.active; sheet.title = "Roster"
    sheet.append(HEADERS)
    for row in rows:
        sheet.append(row)
    output = io.BytesIO(); workbook.save(output); return output.getvalue()


def roster_row(identifier, name, master_id=None, jenjang="Primary", class_name="P1A", status="active"):
    return [identifier, name, master_id, None, None, None, None, "2026/2027", jenjang, class_name, "Primary", status, "2026-07-01"]


@pytest.fixture
def roster_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    @event.listens_for(engine, "connect")
    def enable_fks(connection, _record): connection.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine); db = Session()
    year = AcademicYear(label="2026/2027", start_date=date(2026, 7, 1), end_date=date(2027, 6, 30), status="active", is_default=True)
    jenjang = Jenjang(name="Primary")
    db.add_all([year, jenjang]); db.flush()
    program = AcademicProgram(jenjang_id=jenjang.id, name="Primary", active=True)
    db.add(program); db.flush()
    grade = AcademicGrade(jenjang_id=jenjang.id, program_id=program.id, name="Primary 1", sequence_number=1, active=True)
    db.add(grade); db.flush()
    db.add(AcademicClass(
        academic_year_id=year.id, grade_id=grade.id,
        class_name="P1A", section_code="A", active=True,
    ))
    db.add(StudentAcademicMappingRule(
        mapping_type="class", source_value="P1A", normalized_source_value="p1a",
        target_value="P1A", status="approved", created_by="admin",
        approved_by="admin", approved_at=datetime.now(),
    ))
    student = Student(id=8101, name="Roster Student")
    master = StudentMaster(full_name="Roster Student", normalized_name="roster student", student_status="pending_review")
    db.add_all([student, master]); db.flush()
    db.add(StudentDeviceIdentity(
        student_master_id=master.id, legacy_student_id=student.id, device_identifier="scanner-8101",
        device_source="legacy_students", effective_from=date(2026, 1, 1), is_active=True,
    ))
    db.commit()
    yield db, master, year, jenjang
    db.close(); Base.metadata.drop_all(engine)


def test_preview_is_non_mutating_and_matches_approved_device_identity(roster_db):
    db, master, _year, _jenjang = roster_db
    protected = (db.query(Student).count(), db.query(StudentMaster).count(), db.query(Attendance).count(), db.query(StudentEnrollment).count())
    batch = create_roster_preview(db, workbook_bytes([roster_row("scanner-8101", "Roster Student")]), "official.xlsx", "Registrar", date(2026, 7, 1), "admin")
    assert batch.summary["matched"] == 1
    assert batch.rows[0]["matched_student_master_id"] == master.id
    assert batch.rows[0]["match_rule"] == "approved_device_identity"
    assert protected == (db.query(Student).count(), db.query(StudentMaster).count(), db.query(Attendance).count(), db.query(StudentEnrollment).count())


@pytest.mark.parametrize("jenjang,class_name,classification", [
    ("Unknown", "P1A", "MISSING_JENJANG"),
    ("Primary", "UNKNOWN", "MISSING_CLASS"),
])
def test_invalid_academic_mappings_are_blocked(roster_db, jenjang, class_name, classification):
    db, _master, _year, _canonical = roster_db
    batch = create_roster_preview(db, workbook_bytes([roster_row("scanner-8101", "Roster Student", jenjang=jenjang, class_name=class_name)]), "invalid.xlsx", "Registrar", date(2026, 7, 1), "admin")
    assert batch.rows[0]["classification"] == classification


def test_name_without_birth_identity_is_not_matched(roster_db):
    db, _master, _year, _jenjang = roster_db
    batch = create_roster_preview(db, workbook_bytes([roster_row("unmapped", "Roster Student")]), "ambiguous.xlsx", "Registrar", date(2026, 7, 1), "admin")
    assert batch.rows[0]["classification"] == "NEW_STUDENT"
    assert batch.rows[0]["matched_student_master_id"] is None


def test_ambiguous_name_and_birth_date_is_blocked(roster_db):
    db, master, _year, _jenjang = roster_db
    master.birth_date = date(2018, 1, 2)
    duplicate = StudentMaster(
        full_name="Roster Student", normalized_name="roster student",
        birth_date=date(2018, 1, 2), student_status="pending_review",
    )
    db.add(duplicate); db.commit()
    row = roster_row("unmapped", "Roster Student")
    row[6] = "2018-01-02"
    batch = create_roster_preview(db, workbook_bytes([row]), "ambiguous-birth.xlsx", "Registrar", date(2026, 7, 1), "admin")
    assert batch.rows[0]["classification"] == "AMBIGUOUS"


def test_duplicate_enrollment_in_file_is_blocked(roster_db):
    db, master, _year, _jenjang = roster_db
    rows = [roster_row("scanner-8101", "Roster Student"), roster_row("scanner-8101", "Roster Student")]
    batch = create_roster_preview(db, workbook_bytes(rows), "duplicate.xlsx", "Registrar", date(2026, 7, 1), "admin")
    assert [row["classification"] for row in batch.rows] == ["MATCHED", "INVALID"]


def test_commit_is_atomic_idempotent_and_preserves_protected_data(roster_db):
    db, master, _year, _jenjang = roster_db
    attendance_before = db.query(Attendance).count()
    masters_before = [(row.id, row.full_name, row.updated_at) for row in db.query(StudentMaster).all()]
    batch = create_roster_preview(db, workbook_bytes([roster_row("scanner-8101", "Roster Student")]), "commit.xlsx", "Registrar", date(2026, 7, 1), "admin")
    first = commit_roster_preview(db, batch.id, [1], ROSTER_CONFIRMATION, "admin")
    second = commit_roster_preview(db, batch.id, [1], ROSTER_CONFIRMATION, "admin")
    assert first == second == {"status": "committed", "preview_id": batch.id, "created": 1}
    assert db.query(StudentEnrollment).count() == 1
    assert db.query(Attendance).count() == attendance_before
    assert [(row.id, row.full_name, row.updated_at) for row in db.query(StudentMaster).all()] == masters_before


def test_stale_duplicate_rolls_back_entire_commit(roster_db):
    db, first_master, year, jenjang = roster_db
    student = Student(id=8102, name="Second Student")
    second_master = StudentMaster(full_name="Second Student", normalized_name="second student", student_status="pending_review")
    db.add_all([student, second_master]); db.flush()
    db.add(StudentDeviceIdentity(student_master_id=second_master.id, legacy_student_id=8102, device_identifier="scanner-8102", device_source="legacy_students", effective_from=date(2026, 1, 1), is_active=True))
    db.commit()
    batch = create_roster_preview(db, workbook_bytes([
        roster_row("scanner-8101", "Roster Student"), roster_row("scanner-8102", "Second Student")
    ]), "atomic.xlsx", "Registrar", date(2026, 7, 1), "admin")
    db.add(StudentEnrollment(student_id=8102, student_master_id=second_master.id, academic_year_id=year.id, jenjang_id=jenjang.id, class_name="P1A", class_assigned=True, effective_from=year.start_date))
    db.commit()
    with pytest.raises(Exception):
        commit_roster_preview(db, batch.id, [1, 2], ROSTER_CONFIRMATION, "admin")
    assert db.query(StudentEnrollment).count() == 1
    assert db.query(StudentEnrollment).filter_by(student_master_id=first_master.id).count() == 0


def test_monthly_population_query_reconciles_enrolled_students(roster_db):
    db, _master, _year, _jenjang = roster_db
    batch = create_roster_preview(db, workbook_bytes([roster_row("scanner-8101", "Roster Student")]), "monthly.xlsx", "Registrar", date(2026, 7, 1), "admin")
    commit_roster_preview(db, batch.id, [1], ROSTER_CONFIRMATION, "admin")
    population = db.query(StudentEnrollment).join(StudentMaster, StudentMaster.id == StudentEnrollment.student_master_id).filter(StudentEnrollment.class_assigned.is_(True)).count()
    assert population == 1


def test_missing_required_headers_are_rejected(roster_db):
    db, _master, _year, _jenjang = roster_db
    workbook = Workbook(); workbook.active.append(["student_identifier", "student_name"])
    output = io.BytesIO(); workbook.save(output)
    with pytest.raises(ValueError, match="missing required columns"):
        create_roster_preview(db, output.getvalue(), "missing.xlsx", "Registrar", date(2026, 7, 1), "admin")


def test_roster_endpoints_require_admin(roster_db):
    db, _master, _year, _jenjang = roster_db
    app = FastAPI(); app.include_router(router, prefix="/api/student-enrollments")
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    files = {"file": ("official.xlsx", workbook_bytes([roster_row("scanner-8101", "Roster Student")]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    data = {"source_owner": "Registrar", "date_received": "2026-07-01"}
    assert client.post("/api/student-enrollments/roster-preview", files=files, data=data).status_code == 401
    app.dependency_overrides[get_current_user] = lambda: User(id=2, username="staff", role="staff", is_active=True)
    assert client.post("/api/student-enrollments/roster-preview", files=files, data=data).status_code == 403


def test_s36_migrations_are_rerunnable_and_dual_dialect(tmp_path):
    root = Path(__file__).resolve().parents[1] / "migrations"
    sqlite_sql = (root / "20260720_s36_academic_roster_sqlite.sql").read_text(encoding="utf-8")
    connection = sqlite3.connect(tmp_path / "roster.db")
    connection.executescript(sqlite_sql); connection.executescript(sqlite_sql)
    assert connection.execute("SELECT COUNT(*) FROM academic_roster_import_batches").fetchone()[0] == 0
    postgres_sql = (root / "20260720_s36_academic_roster_postgresql.sql").read_text(encoding="utf-8")
    assert "JSONB NOT NULL" in postgres_sql
    assert "CREATE TABLE IF NOT EXISTS" in postgres_sql
    connection.close()
