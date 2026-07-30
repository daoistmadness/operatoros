from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import sqlite3

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from core.attendance_followup_migration import migrate_attendance_followup_sqlite
from core.database import Base
from models.academic_master import AcademicClass, AcademicGrade, AcademicProgram
from models.academic_year import AcademicYear
from models.attendance import Attendance
from models.attendance_followup import (
    AttendanceFollowUp,
    AttendanceFollowUpAudit,
    AttendanceFollowUpNote,
)
from models.attendance_review import AttendanceCorrectionRequest, AttendanceOverride, AttendancePeriod
from models.early_departure_excuse import EarlyDepartureExcuse
from models.jenjang import Jenjang
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.student_master import StudentDeviceIdentity, StudentMaster
from models.teacher_class_assignment import TeacherClassAssignment
from models.user import User
from services.attendance_followup_service import (
    add_case_note,
    audit_followup_event,
    create_or_materialize_followup,
    discover_exception_candidates,
    generate_exception_key,
    get_followup_metrics,
    query_followup_cases,
    serialize_followup,
    update_case_workflow_state,
)
from services.teacher_class_assignment import safe_error


@pytest.fixture
def synthetic_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)

    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TRIGGER IF NOT EXISTS trg_attendance_follow_up_audit_no_update "
                "BEFORE UPDATE ON attendance_follow_up_audit "
                "BEGIN SELECT RAISE(ABORT, 'attendance_follow_up_audit is append-only'); END;"
            )
        )
        conn.execute(
            text(
                "CREATE TRIGGER IF NOT EXISTS trg_attendance_follow_up_audit_no_delete "
                "BEFORE DELETE ON attendance_follow_up_audit "
                "BEGIN SELECT RAISE(ABORT, 'attendance_follow_up_audit is append-only'); END;"
            )
        )

    Session = sessionmaker(bind=engine)
    session = Session()

    # Seed master data
    jenjang = Jenjang(id=1, name="Primary", code="SD", level=1, active=True)
    session.add(jenjang)
    session.flush()

    year = AcademicYear(id=1, label="2025/2026", start_date=date(2025, 7, 1), end_date=date(2026, 6, 30), is_default=True, status="active")
    session.add(year)
    session.flush()

    program = AcademicProgram(id=1, jenjang_id=1, name="Regular Program", active=True)
    session.add(program)
    session.flush()

    grade = AcademicGrade(id=1, jenjang_id=1, program_id=1, name="Grade 7", sequence_number=7, active=True)
    session.add(grade)
    session.flush()

    cls1 = AcademicClass(id=10, academic_year_id=1, grade_id=1, class_name="7A", section_code="A", active=True)
    cls2 = AcademicClass(id=20, academic_year_id=1, grade_id=1, class_name="7B", section_code="B", active=True)
    session.add_all([cls1, cls2])
    session.flush()

    sm1 = StudentMaster(id="sm-1001", full_name="Ahmad Student", normalized_name="ahmad student", student_status="active")
    sm2 = StudentMaster(id="sm-1002", full_name="Budi Student", normalized_name="budi student", student_status="active")
    session.add_all([sm1, sm2])
    session.flush()

    std1 = Student(id=1, name="Ahmad Student", class_name="7A", jenjang="SD")
    std2 = Student(id=2, name="Budi Student", class_name="7B", jenjang="SD")
    session.add_all([std1, std2])
    session.flush()

    enr1 = StudentEnrollment(id=101, student_id=1, student_master_id="sm-1001", jenjang_id=1, academic_class_id=10, academic_year_id=1, lifecycle_state="ACTIVE")
    enr2 = StudentEnrollment(id=102, student_id=2, student_master_id="sm-1002", jenjang_id=1, academic_class_id=20, academic_year_id=1, lifecycle_state="ACTIVE")
    session.add_all([enr1, enr2])
    session.flush()

    admin = User(id=1, username="admin_user", role="admin", password_hash="pw")
    teacher1 = User(id=2, username="teacher1", role="staff", password_hash="pw")
    teacher2 = User(id=3, username="teacher2", role="staff", password_hash="pw")
    session.add_all([admin, teacher1, teacher2])
    session.flush()

    # Assign teacher1 to 7A
    tca1 = TeacherClassAssignment(
        id=1,
        user_id=2,
        academic_year_id=1,
        academic_class_id=10,
        class_role="HOMEROOM_TEACHER",
        active=True,
        assigned_by="admin_user",
    )
    session.add(tca1)
    session.commit()

    yield session
    session.close()


def test_stable_exception_key():
    k1 = generate_exception_key("UNEXPLAINED_ABSENCE", "sm-1001", "2026-07-25", "1")
    k2 = generate_exception_key("UNEXPLAINED_ABSENCE", "sm-1001", "2026-07-25", "1")
    k3 = generate_exception_key("UNEXPLAINED_ABSENCE", "sm-1001", "2026-07-26", "1")
    assert k1 == k2
    assert k1 != k3
    assert k1 == "UNEXPLAINED_ABSENCE:sm-1001:2026-07-25:1"


def test_discover_candidate_unexplained_absence(synthetic_db):
    session = synthetic_db
    admin = session.get(User, 1)

    att = Attendance(id=50, student_id=1, date=date(2026, 7, 25), status="alfa", is_absent=True)
    session.add(att)
    session.commit()

    candidates = discover_exception_candidates(session, admin)
    assert len(candidates) >= 1
    abs_cand = next(c for c in candidates if c["exception_kind"] == "UNEXPLAINED_ABSENCE")
    assert abs_cand["student_master_id"] == "sm-1001"
    assert abs_cand["academic_class_id"] == 10
    assert abs_cand["materialized_case"] is None


def test_create_and_materialize_followup(synthetic_db):
    session = synthetic_db
    admin = session.get(User, 1)

    att = Attendance(id=50, student_id=1, date=date(2026, 7, 25), status="alfa", is_absent=True)
    session.add(att)
    session.commit()

    key = generate_exception_key("UNEXPLAINED_ABSENCE", "sm-1001", "2026-07-25", "50")
    case = create_or_materialize_followup(
        session,
        admin,
        exception_key=key,
        exception_kind="UNEXPLAINED_ABSENCE",
        student_master_id="sm-1001",
        academic_class_id=10,
        exception_date=date(2026, 7, 25),
        priority="HIGH",
    )

    assert case.id is not None
    assert case.status == "OPEN"
    assert case.priority == "HIGH"
    assert case.version == 1

    # Candidate query should now show materialized_case attached
    candidates = discover_exception_candidates(session, admin)
    abs_cand = next(c for c in candidates if c["exception_key"] == key)
    assert abs_cand["materialized_case"] is not None
    assert abs_cand["materialized_case"]["id"] == case.id


def test_duplicate_open_case_rejection(synthetic_db):
    session = synthetic_db
    admin = session.get(User, 1)

    key = generate_exception_key("LATE_ARRIVAL", "sm-1001", "2026-07-25", "51")
    create_or_materialize_followup(
        session,
        admin,
        exception_key=key,
        exception_kind="LATE_ARRIVAL",
        student_master_id="sm-1001",
        academic_class_id=10,
    )

    with pytest.raises(Exception) as exc_info:
        create_or_materialize_followup(
            session,
            admin,
            exception_key=key,
            exception_kind="LATE_ARRIVAL",
            student_master_id="sm-1001",
            academic_class_id=10,
        )
    assert "ATTENDANCE_FOLLOWUP_DUPLICATE_OPEN_CASE" in str(exc_info.value)


def test_teacher_scoping_and_unassigned_denial(synthetic_db):
    session = synthetic_db
    teacher1 = session.get(User, 2)  # Assigned to Class 10 (7A)
    teacher2 = session.get(User, 3)  # Assigned to no class

    key1 = generate_exception_key("UNEXPLAINED_ABSENCE", "sm-1001", "2026-07-25", "50")
    key2 = generate_exception_key("UNEXPLAINED_ABSENCE", "sm-1002", "2026-07-25", "51")

    # Teacher1 can create for Class 10
    c1 = create_or_materialize_followup(
        session, teacher1, exception_key=key1, exception_kind="UNEXPLAINED_ABSENCE", student_master_id="sm-1001", academic_class_id=10
    )
    assert c1.id is not None

    # Teacher1 cannot create for Class 20
    with pytest.raises(Exception) as exc1:
        create_or_materialize_followup(
            session, teacher1, exception_key=key2, exception_kind="UNEXPLAINED_ABSENCE", student_master_id="sm-1002", academic_class_id=20
        )
    assert "ATTENDANCE_FOLLOWUP_SCOPE_FORBIDDEN" in str(exc1.value)

    # Teacher2 (unassigned) denied for Class 10
    with pytest.raises(Exception) as exc2:
        create_or_materialize_followup(
            session, teacher2, exception_key=key2, exception_kind="UNEXPLAINED_ABSENCE", student_master_id="sm-1001", academic_class_id=10
        )
    assert "ATTENDANCE_FOLLOWUP_SCOPE_FORBIDDEN" in str(exc2.value)


def test_workflow_state_transitions(synthetic_db):
    session = synthetic_db
    admin = session.get(User, 1)

    key = generate_exception_key("MISSING_CHECKOUT", "sm-1001", "2026-07-25", "60")
    case = create_or_materialize_followup(
        session, admin, exception_key=key, exception_kind="MISSING_CHECKOUT", student_master_id="sm-1001", academic_class_id=10
    )

    # OPEN -> ACKNOWLEDGED
    ack = update_case_workflow_state(session, admin, case.id, target_status="ACKNOWLEDGED")
    assert ack.status == "ACKNOWLEDGED"
    assert ack.acknowledged_by_user_id == admin.id
    assert ack.acknowledged_at is not None

    # ACKNOWLEDGED -> IN_PROGRESS
    inp = update_case_workflow_state(session, admin, case.id, target_status="IN_PROGRESS")
    assert inp.status == "IN_PROGRESS"

    # IN_PROGRESS -> RESOLVED requires resolution_code
    with pytest.raises(Exception) as exc1:
        update_case_workflow_state(session, admin, case.id, target_status="RESOLVED")
    assert "ATTENDANCE_FOLLOWUP_RESOLUTION_REQUIRED" in str(exc1.value)

    res = update_case_workflow_state(session, admin, case.id, target_status="RESOLVED", resolution_code="STUDENT_COUNSELED")
    assert res.status == "RESOLVED"
    assert res.resolution_code == "STUDENT_COUNSELED"
    assert res.resolved_by_user_id == admin.id

    # RESOLVED -> REOPENED requires reason
    with pytest.raises(Exception) as exc2:
        update_case_workflow_state(session, admin, case.id, target_status="REOPENED")
    assert "ATTENDANCE_FOLLOWUP_REOPEN_REASON_REQUIRED" in str(exc2.value)

    reop = update_case_workflow_state(session, admin, case.id, target_status="REOPENED", resolution_note="Recurred next day")
    assert reop.status == "REOPENED"
    assert reop.resolved_by_user_id is None


def test_invalid_workflow_transition(synthetic_db):
    session = synthetic_db
    admin = session.get(User, 1)

    key = generate_exception_key("UNEXPLAINED_EARLY_DEPARTURE", "sm-1001", "2026-07-25", "70")
    case = create_or_materialize_followup(
        session, admin, exception_key=key, exception_kind="UNEXPLAINED_EARLY_DEPARTURE", student_master_id="sm-1001"
    )

    # OPEN directly to REOPENED is invalid
    with pytest.raises(Exception) as exc:
        update_case_workflow_state(session, admin, case.id, target_status="REOPENED")
    assert "ATTENDANCE_FOLLOWUP_INVALID_TRANSITION" in str(exc.value)


def test_notes_and_append_only_audit(synthetic_db):
    session = synthetic_db
    admin = session.get(User, 1)

    key = generate_exception_key("PENDING_CORRECTION", "sm-1001", "2026-07-25", "80")
    case = create_or_materialize_followup(
        session, admin, exception_key=key, exception_kind="PENDING_CORRECTION", student_master_id="sm-1001"
    )

    note = add_case_note(session, admin, case.id, body="Contacted guardian regarding correction.", note_type="INTERNAL_NOTE")
    assert note.id is not None
    assert note.body == "Contacted guardian regarding correction."

    audits = session.query(AttendanceFollowUpAudit).filter(AttendanceFollowUpAudit.follow_up_id == case.id).all()
    assert len(audits) >= 2  # CREATE + ADD_NOTE

    # Test trigger blocking UPDATE on audit table
    audit_row = audits[0]
    audit_id = audit_row.id
    with pytest.raises(Exception):
        session.execute(text(f"UPDATE attendance_follow_up_audit SET actor='hacker' WHERE id={audit_id}"))

    # Test trigger blocking DELETE on audit table
    with pytest.raises(Exception):
        session.execute(text(f"DELETE FROM attendance_follow_up_audit WHERE id={audit_id}"))


def test_stale_version_concurrency_conflict(synthetic_db):
    session = synthetic_db
    admin = session.get(User, 1)

    key = generate_exception_key("UNEXPLAINED_ABSENCE", "sm-1001", "2026-07-25", "90")
    case = create_or_materialize_followup(
        session, admin, exception_key=key, exception_kind="UNEXPLAINED_ABSENCE", student_master_id="sm-1001"
    )

    # Passing stale version (0 instead of 1)
    with pytest.raises(Exception) as exc:
        update_case_workflow_state(session, admin, case.id, target_status="ACKNOWLEDGED", version=0)
    assert "ATTENDANCE_FOLLOWUP_STALE_VERSION" in str(exc.value)


def test_unmatched_device_candidate_discovery(synthetic_db):
    session = synthetic_db
    admin = session.get(User, 1)

    dev = StudentDeviceIdentity(student_master_id="sm-1001", legacy_student_id=None, device_identifier="CARD_XYZ_99", device_source="rfid", effective_from=date(2026, 1, 1), is_active=True)
    session.add(dev)
    session.commit()

    candidates = discover_exception_candidates(session, admin)
    dev_cand = next((c for c in candidates if c["exception_kind"] == "UNMATCHED_DEVICE_IDENTITY"), None)
    assert dev_cand is not None
    assert "CARD_XYZ_99" in dev_cand["evidence_summary"]


def test_reporting_metrics_parity(synthetic_db):
    session = synthetic_db
    admin = session.get(User, 1)

    k1 = generate_exception_key("UNEXPLAINED_ABSENCE", "sm-1001", "2026-07-25", "100")
    k2 = generate_exception_key("LATE_ARRIVAL", "sm-1002", "2026-07-25", "101")

    c1 = create_or_materialize_followup(session, admin, exception_key=k1, exception_kind="UNEXPLAINED_ABSENCE", student_master_id="sm-1001", priority="HIGH")
    c2 = create_or_materialize_followup(session, admin, exception_key=k2, exception_kind="LATE_ARRIVAL", student_master_id="sm-1002", priority="LOW")

    update_case_workflow_state(session, admin, c2.id, target_status="IN_PROGRESS")
    update_case_workflow_state(session, admin, c2.id, target_status="RESOLVED", resolution_code="STUDENT_COUNSELED")

    metrics = get_followup_metrics(session, admin)
    assert metrics["open_cases"] == 1
    assert metrics["resolved_count"] == 1
    assert metrics["by_kind"]["UNEXPLAINED_ABSENCE"] == 1
    assert metrics["by_kind"]["LATE_ARRIVAL"] == 1


def test_sqlite_migration_idempotence(tmp_path: Path):
    db_file = tmp_path / "test_followup.db"
    conn = sqlite3.connect(db_file)

    # Initialize prerequisite tables
    conn.execute(
        "CREATE TABLE operatoros_schema_migrations ("
        "version TEXT PRIMARY KEY, predecessor TEXT NULL, schema_fingerprint TEXT NOT NULL, "
        "protected_fingerprints TEXT NOT NULL, approved_by TEXT NOT NULL, applied_at TEXT NOT NULL)"
    )
    conn.execute("CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT)")
    conn.execute("CREATE TABLE attendance (id INTEGER PRIMARY KEY, student_id INTEGER, date DATE)")
    conn.execute(
        "INSERT INTO operatoros_schema_migrations VALUES ('20260724_s42', '20260722_s41', 'fingerprint', '{}', 'TEST', '2026-07-24T00:00:00Z')"
    )
    conn.commit()
    conn.close()

    # Apply S4.3 migration
    res1 = migrate_attendance_followup_sqlite(db_file)
    assert res1 == "MIGRATION_COMPLETE"

    # Re-apply migration to test idempotence
    res2 = migrate_attendance_followup_sqlite(db_file)
    assert res2 == "MIGRATION_ALREADY_CURRENT"


def test_followup_fixture_is_synthetic(synthetic_db):
    """Queue coverage is populated entirely from the local synthetic fixture."""
    assert synthetic_db.query(StudentEnrollment).count() == 2
