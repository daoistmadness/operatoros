from datetime import date, datetime, time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.student_enrollments import router as enrollment_router
from api.student_masters import router as master_router
from core.database import Base, get_db
from models.academic_year import AcademicYear
from models.academic_mapping import StudentAcademicMappingRule
from models.academic_master import AcademicClass, AcademicGrade, AcademicProgram
from models.attendance import Attendance
from models.jenjang import Jenjang
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.student_master import (
    LegacyLinkResolution,
    StudentDeviceIdentity,
    StudentEnrollmentClassHistory,
    StudentMaster,
    StudentMasterChangeHistory,
)
from models.user import User
from security.dependencies import get_current_user
from services.enrollment_population import (
    ENROLLMENT_CONFIRMATION,
    build_enrollment_rows,
    commit_enrollment_preview,
    create_enrollment_preview,
)
from services.academic_mapping import build_academic_mapping_preview, resolve_jenjang
from services.student_normalization import normalize_name
from services.student_linking import (
    LEGACY_LINK_CONFIRMATION,
    build_legacy_link_rows,
    commit_legacy_preview,
    create_legacy_preview,
    resolve_legacy_student,
)


@pytest.fixture
def s3_context():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def enable_fks(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        for action in ("UPDATE", "DELETE"):
            connection.execute(text(
                f"CREATE TRIGGER trg_student_enrollment_class_history_no_{action.lower()} "
                f"BEFORE {action} ON student_enrollment_class_history BEGIN "
                "SELECT RAISE(FAIL, 'student_enrollment_class_history is append-only'); END"
            ))
    Session = sessionmaker(bind=engine)
    db = Session()
    year = AcademicYear(
        label="2026/2027", start_date=date(2026, 7, 1), end_date=date(2027, 6, 30),
        status="active", is_default=True,
    )
    primary = Jenjang(name="Primary")
    db.add_all([year, primary])
    db.flush()
    program = AcademicProgram(jenjang_id=primary.id, name="Primary", active=True)
    db.add(program); db.flush()
    grade = AcademicGrade(jenjang_id=primary.id, program_id=program.id, name="Primary 1", sequence_number=1, active=True)
    db.add(grade); db.flush()
    db.add(AcademicClass(
        academic_year_id=year.id, grade_id=grade.id,
        class_name="P1A", section_code="A", active=True,
    ))
    students = [
        Student(id=7001, name="Unique Student", jenjang="Primary", class_name="P1A"),
        Student(id=7002, name="Duplicate Student", jenjang="Primary", class_name="P1A"),
        Student(id=7003, name=" duplicate  student ", jenjang="Primary", class_name="P1B"),
        Student(id=7004, name="Missing Level", jenjang=None, class_name=None),
    ]
    db.add_all(students)
    db.flush()
    db.add(Attendance(
        student_id=7001, date=date(2026, 7, 2), check_in=time(7), check_out=time(14),
        late_duration=0, status="on-time",
    ))
    db.commit()
    yield {"engine": engine, "db": db, "year": year, "primary": primary}
    db.close()
    Base.metadata.drop_all(engine)


def test_link_preview_is_non_mutating_and_classifies_unique_and_duplicate_names(s3_context):
    db = s3_context["db"]
    batch = create_legacy_preview(db, "admin")
    by_id = {row["legacy_student_id"]: row for row in batch.rows}
    assert by_id[7001]["proposed_action"] == "SAFE_AUTO_CREATE"
    assert by_id[7002]["proposed_action"] == "REVIEW_REQUIRED"
    assert by_id[7003]["proposed_action"] == "REVIEW_REQUIRED"
    assert db.query(StudentMaster).count() == 0
    assert db.query(StudentDeviceIdentity).count() == 0


def test_link_commit_is_atomic_idempotent_audited_and_preserves_attendance(s3_context):
    db = s3_context["db"]
    attendance_before = [(row.id, row.student_id) for row in db.query(Attendance).all()]
    batch = create_legacy_preview(db, "admin")
    result = commit_legacy_preview(db, batch.id, [7001], LEGACY_LINK_CONFIRMATION, "admin")
    assert result == {"created_masters": 1, "created_mappings": 1, "skipped": 0}
    mapping = db.query(StudentDeviceIdentity).filter_by(legacy_student_id=7001).one()
    assert mapping.device_identifier == "7001"
    assert db.query(StudentMasterChangeHistory).filter_by(action="legacy_identity_linked").count() == 1
    assert [(row.id, row.student_id) for row in db.query(Attendance).all()] == attendance_before

    rerun = commit_legacy_preview(db, batch.id, [7001], LEGACY_LINK_CONFIRMATION, "admin")
    assert rerun == {"created_masters": 0, "created_mappings": 0, "skipped": 1}
    assert db.query(StudentMaster).count() == 1


def test_existing_mapping_detected_and_conflicting_mapping_requires_review(s3_context):
    db = s3_context["db"]
    first = StudentMaster(full_name="First", normalized_name="first")
    second = StudentMaster(full_name="Second", normalized_name="second")
    db.add_all([first, second]); db.flush()
    db.add_all([
        StudentDeviceIdentity(student_master_id=first.id, legacy_student_id=7001, device_identifier="a", device_source="one", effective_from=date(2026, 7, 1), is_active=True),
        StudentDeviceIdentity(student_master_id=second.id, legacy_student_id=7001, device_identifier="b", device_source="two", effective_from=date(2026, 7, 1), is_active=True),
    ])
    db.commit()
    row = build_legacy_link_rows(db, [7001])[0]
    assert row["proposed_action"] == "CONFLICT"


def test_link_commit_rolls_back_all_rows_when_one_is_not_safe(s3_context):
    db = s3_context["db"]
    batch = create_legacy_preview(db, "admin")
    with pytest.raises(Exception):
        commit_legacy_preview(db, batch.id, [7001, 7002], LEGACY_LINK_CONFIRMATION, "admin")
    assert db.query(StudentMaster).count() == 0
    assert db.query(StudentDeviceIdentity).count() == 0


def test_manual_resolution_creates_mapping_and_audit(s3_context):
    db = s3_context["db"]
    result = resolve_legacy_student(
        db, 7002, "create_new", None, "Administrator verified identity",
        LEGACY_LINK_CONFIRMATION, "admin",
    )
    assert result["resolution"] == "created"
    assert db.query(LegacyLinkResolution).filter_by(legacy_student_id=7002).count() == 1
    assert db.query(StudentMasterChangeHistory).filter_by(action="manual_legacy_resolution").count() == 1


def test_enrollment_preview_commit_idempotence_and_missing_jenjang_block(s3_context):
    db, year = s3_context["db"], s3_context["year"]
    db.add(StudentAcademicMappingRule(
        mapping_type="class", source_value="P1A", normalized_source_value="p1a",
        target_value="P1A", status="approved", created_by="admin",
        approved_by="admin", approved_at=datetime.now(),
    ))
    db.commit()
    link_batch = create_legacy_preview(db, "admin")
    commit_legacy_preview(db, link_batch.id, [7001, 7004], LEGACY_LINK_CONFIRMATION, "admin")
    rows = build_enrollment_rows(db, year.id, date(2026, 7, 1), [7001, 7004])
    by_id = {row["legacy_student_id"]: row for row in rows}
    assert by_id[7001]["proposed_action"] == "CREATE_ENROLLMENT"
    assert by_id[7004]["proposed_action"] == "MISSING_JENJANG"
    assert db.query(StudentEnrollment).count() == 0

    batch = create_enrollment_preview(db, year.id, date(2026, 7, 1), [7001, 7004], "admin")
    assert commit_enrollment_preview(db, batch.id, [7001], ENROLLMENT_CONFIRMATION, "admin") == {"created": 1, "skipped_existing": 0}
    enrollment = db.query(StudentEnrollment).one()
    assert enrollment.student_master_id is not None
    assert enrollment.class_name == "P1A"
    assert db.query(StudentEnrollmentClassHistory).count() == 1
    assert commit_enrollment_preview(db, batch.id, [7001], ENROLLMENT_CONFIRMATION, "admin") == {"created": 0, "skipped_existing": 1}
    with pytest.raises(Exception, match="append-only"):
        db.query(StudentEnrollmentClassHistory).update({"class_name": "P1B"})
        db.commit()
    db.rollback()
    with pytest.raises(Exception, match="append-only"):
        db.query(StudentEnrollmentClassHistory).delete()
        db.commit()
    db.rollback()


def test_cross_jenjang_conflict_is_blocked(s3_context):
    db, year, primary = s3_context["db"], s3_context["year"], s3_context["primary"]
    secondary = Jenjang(name="Secondary")
    db.add(secondary)
    db.add(StudentAcademicMappingRule(
        mapping_type="class", source_value="P1A", normalized_source_value="p1a",
        target_value="P1A", status="approved", created_by="admin",
        approved_by="admin", approved_at=datetime.now(),
    ))
    db.flush()
    master = StudentMaster(full_name="Unique Student", normalized_name="unique student")
    db.add(master); db.flush()
    db.add(StudentDeviceIdentity(student_master_id=master.id, legacy_student_id=7001, device_identifier="7001", device_source="legacy_students", effective_from=date(2026, 7, 1), is_active=True))
    db.flush()
    db.add(StudentEnrollment(student_id=7001, student_master_id=master.id, academic_year_id=year.id, jenjang_id=primary.id, class_name="P9Z", class_assigned=True))
    db.get(Student, 7001).jenjang = "Secondary"
    db.commit()
    assert build_enrollment_rows(db, year.id, date(2026, 7, 1), [7001])[0]["proposed_action"] == "CROSS_JENJANG_CONFLICT"


def test_workflow_apis_require_authentication_and_admin(s3_context):
    db = s3_context["db"]
    app = FastAPI()
    app.include_router(master_router, prefix="/api/student-masters")
    app.include_router(enrollment_router, prefix="/api/student-enrollments")
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    assert client.post("/api/student-masters/legacy-link/preview").status_code == 401
    app.dependency_overrides[get_current_user] = lambda: User(id=2, username="staff", password_hash="x", role="staff", is_active=True)
    assert client.post("/api/student-masters/legacy-link/preview").status_code == 403
    app.dependency_overrides[get_current_user] = lambda: User(id=1, username="admin", password_hash="x", role="admin", is_active=True)
    response = client.post("/api/student-masters/legacy-link/preview")
    assert response.status_code == 200
    assert response.json()["summary"]["total"] == 4
    quality = client.get("/api/student-masters/data-quality-summary")
    assert quality.status_code == 200
    assert quality.json()["legacy_students_without_canonical_master"] == 4
    assert quality.json()["duplicate_active_device_identities"] == 0
    assert quality.json()["missing_jenjang_mappings"] == 1


def test_s3_sqlite_migration_reruns_and_postgresql_contract(tmp_path):
    import sqlite3

    db = sqlite3.connect(tmp_path / "s3.db")
    db.executescript("""
      PRAGMA foreign_keys=ON;
      CREATE TABLE students(id INTEGER PRIMARY KEY);
      CREATE TABLE student_masters(id VARCHAR(36) PRIMARY KEY);
      CREATE TABLE academic_years(id INTEGER PRIMARY KEY);
      CREATE TABLE jenjangs(id INTEGER PRIMARY KEY);
      CREATE TABLE student_import_batches(id VARCHAR(36) PRIMARY KEY);
      CREATE TABLE student_enrollments(id INTEGER PRIMARY KEY, student_master_id VARCHAR(36), academic_year_id INTEGER);
    """)
    root = Path(__file__).resolve().parents[1] / "migrations"
    sqlite_sql = (root / "20260717_s3_linking_enrollment_sqlite.sql").read_text(encoding="utf-8")
    db.executescript(sqlite_sql); db.executescript(sqlite_sql)
    assert db.execute("SELECT COUNT(*) FROM student_enrollment_class_history").fetchone()[0] == 0
    postgres_sql = (root / "20260717_s3_linking_enrollment_postgresql.sql").read_text(encoding="utf-8")
    assert "ADD COLUMN IF NOT EXISTS effective_from" in postgres_sql
    assert "WHERE student_master_id IS NOT NULL" in postgres_sql
    assert "ON DELETE RESTRICT" in postgres_sql
    mapping_sql = (root / "20260719_s35_academic_mapping_sqlite.sql").read_text(encoding="utf-8")
    db.executescript(mapping_sql); db.executescript(mapping_sql)
    assert db.execute("SELECT COUNT(*) FROM student_academic_mapping_rules").fetchone()[0] == 0
    mapping_postgres = (root / "20260719_s35_academic_mapping_postgresql.sql").read_text(encoding="utf-8")
    assert "REFERENCES jenjangs(id) ON DELETE RESTRICT" in mapping_postgres
    assert "approved_by IS NOT NULL" in mapping_postgres
    db.close()


def test_mapping_preview_is_non_mutating_and_classifies_blank_values(s3_context):
    db = s3_context["db"]
    before = (db.query(Student).count(), db.query(StudentEnrollment).count())
    preview = build_academic_mapping_preview(db)
    after = (db.query(Student).count(), db.query(StudentEnrollment).count())
    assert before == after
    assert preview["summary"] == {
        "total": 4,
        "empty_jenjang": 1,
        "unmatched_jenjang": 0,
        "matched_jenjang": 3,
        "empty_class": 1,
        "unmatched_class": 3,
        "matched_class": 0,
    }


def test_normalized_and_ambiguous_jenjang_are_blocked_without_approved_rule(s3_context):
    db = s3_context["db"]
    db.add(Jenjang(name=" primary "))
    db.commit()
    exact = {row.name: row for row in db.query(Jenjang).all()}
    normalized = {}
    for row in db.query(Jenjang).all():
        normalized.setdefault(normalize_name(row.name), []).append(row)
    target, state, match = resolve_jenjang("PRIMARY", exact, normalized, {})
    assert target is None
    assert state == "UNMATCHED_JENJANG"
    assert match == "AMBIGUOUS"


def test_approved_class_rule_is_used_by_mapping_preview(s3_context):
    db = s3_context["db"]
    db.add(StudentAcademicMappingRule(
        mapping_type="class", source_value="P1A", normalized_source_value="p1a",
        target_value="P1-Alpha", status="approved", created_by="admin",
        approved_by="reviewer", approved_at=datetime.now(),
    ))
    db.commit()
    assert build_academic_mapping_preview(db)["summary"]["matched_class"] == 2


def test_mapping_preview_endpoint_requires_admin(s3_context):
    db = s3_context["db"]
    app = FastAPI()
    app.include_router(enrollment_router, prefix="/api/student-enrollments")
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    assert client.post("/api/student-enrollments/mapping-preview").status_code == 401
    app.dependency_overrides[get_current_user] = lambda: User(id=2, username="staff", role="staff", is_active=True)
    assert client.post("/api/student-enrollments/mapping-preview").status_code == 403
    app.dependency_overrides[get_current_user] = lambda: User(id=1, username="admin", role="admin", is_active=True)
    response = client.post("/api/student-enrollments/mapping-preview")
    assert response.status_code == 200
    assert response.json()["summary"]["total"] == 4
