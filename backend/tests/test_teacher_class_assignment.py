import sqlite3
from datetime import date, timedelta
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.database import Base, get_db
from models.user import User
from models.user_session import UserSession
from models.academic_year import AcademicYear
from models.academic_master import AcademicClass, AcademicGrade, AcademicProgram
from models.jenjang import Jenjang
from models.subject import Subject
from models.student import Student
from models.student_master import StudentMaster
from models.student_enrollment import StudentEnrollment
from models.attendance import Attendance
from models.attendance_review import AttendancePeriod, AttendanceOverride, AttendanceCorrectionRequest
from models.teacher_class_assignment import TeacherClassAssignment, TeacherClassAssignmentAudit
from security.dependencies import get_current_user
from main import app


@pytest.fixture
def test_db_setup():
    """Fixture providing an isolated synthetic in-memory SQLite database."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    # Seed basic master data
    jenjang = Jenjang(name="Primary", code="PRI", level=1, active=True)
    session.add(jenjang)
    session.flush()

    year = AcademicYear(label="2025/2026", start_date=date(2025, 7, 1), end_date=date(2026, 6, 30), status="active", is_default=True)
    closed_year = AcademicYear(label="2024/2025", start_date=date(2024, 7, 1), end_date=date(2025, 6, 30), status="closed", is_default=False)
    session.add_all([year, closed_year])
    session.flush()

    program = AcademicProgram(jenjang_id=jenjang.id, name="General", active=True)
    session.add(program)
    session.flush()

    grade = AcademicGrade(jenjang_id=jenjang.id, program_id=program.id, name="Grade 1", sequence_number=1, active=True)
    session.add(grade)
    session.flush()

    cls1 = AcademicClass(academic_year_id=year.id, grade_id=grade.id, class_name="Class 1A", section_code="1A", active=True)
    cls2 = AcademicClass(academic_year_id=year.id, grade_id=grade.id, class_name="Class 1B", section_code="1B", active=True)
    archived_cls = AcademicClass(academic_year_id=year.id, grade_id=grade.id, class_name="Class Old", section_code="OLD", active=False)
    session.add_all([cls1, cls2, archived_cls])
    session.flush()

    subj = Subject(name="Mathematics", jenjang_id=jenjang.id)
    session.add(subj)
    session.flush()

    # Create admin and teacher users
    admin_user = User(id=1, username="admin_user", password_hash="hash", role="admin", is_active=True)
    teacher1 = User(id=2, username="teacher1", password_hash="hash", role="staff", is_active=True)
    teacher2 = User(id=3, username="teacher2", password_hash="hash", role="staff", is_active=True)
    session.add_all([admin_user, teacher1, teacher2])
    session.flush()

    session.commit()

    app.dependency_overrides[get_db] = lambda: session

    yield {
        "engine": engine,
        "session": session,
        "year": year,
        "closed_year": closed_year,
        "cls1": cls1,
        "cls2": cls2,
        "archived_cls": archived_cls,
        "subject": subj,
        "admin": admin_user,
        "teacher1": teacher1,
        "teacher2": teacher2,
    }

    app.dependency_overrides.clear()
    session.close()
    engine.dispose()


def get_client(user=None):
    client = TestClient(app)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    else:
        app.dependency_overrides.pop(get_current_user, None)
    return client


def test_protected_database_never_accessed():
    """Verify test suite is decoupled from backend/attendance.db."""
    protected = Path("backend/attendance.db").resolve()
    assert protected.exists()
    with sqlite3.connect(f"file:{protected}?mode=ro&immutable=1", uri=True) as conn:
        res = conn.execute("SELECT COUNT(*) FROM student_enrollments").fetchone()
        assert res[0] == 0


def test_assignment_creation_and_audit(test_db_setup):
    db_session = test_db_setup["session"]
    client = get_client(test_db_setup["admin"])

    payload = {
        "user_id": test_db_setup["teacher1"].id,
        "academic_year_id": test_db_setup["year"].id,
        "academic_class_id": test_db_setup["cls1"].id,
        "class_role": "HOMEROOM_TEACHER",
        "subject_id": test_db_setup["subject"].id,
        "effective_from": "2025-07-01",
        "effective_to": "2026-06-30",
    }
    resp = client.post("/api/teacher-class-assignments", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["user_id"] == test_db_setup["teacher1"].id
    assert data["class_role"] == "HOMEROOM_TEACHER"

    # Verify audit entry
    audits = db_session.query(TeacherClassAssignmentAudit).all()
    assert len(audits) >= 1
    assert audits[-1].action == "ASSIGNMENT_CREATED"
    assert audits[-1].actor == "admin_user"


def test_duplicate_and_overlap_rejection(test_db_setup):
    db_session = test_db_setup["session"]
    client = get_client(test_db_setup["admin"])

    payload = {
        "user_id": test_db_setup["teacher1"].id,
        "academic_year_id": test_db_setup["year"].id,
        "academic_class_id": test_db_setup["cls1"].id,
        "class_role": "HOMEROOM_TEACHER",
        "effective_from": "2025-07-01",
        "effective_to": "2025-12-31",
    }
    r1 = client.post("/api/teacher-class-assignments", json=payload)
    assert r1.status_code == 200

    # Overlapping period rejection
    payload_overlap = {
        "user_id": test_db_setup["teacher1"].id,
        "academic_year_id": test_db_setup["year"].id,
        "academic_class_id": test_db_setup["cls1"].id,
        "class_role": "HOMEROOM_TEACHER",
        "effective_from": "2025-10-01",
        "effective_to": "2026-03-31",
    }
    r2 = client.post("/api/teacher-class-assignments", json=payload_overlap)
    assert r2.status_code == 400
    assert r2.json()["detail"]["code"] == "TEACHER_CLASS_ASSIGNMENT_OVERLAP"


def test_invalid_date_range_rejection(test_db_setup):
    client = get_client(test_db_setup["admin"])

    payload = {
        "user_id": test_db_setup["teacher1"].id,
        "academic_year_id": test_db_setup["year"].id,
        "academic_class_id": test_db_setup["cls1"].id,
        "class_role": "HOMEROOM_TEACHER",
        "effective_from": "2025-12-31",
        "effective_to": "2025-01-01",
    }
    r = client.post("/api/teacher-class-assignments", json=payload)
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "INVALID_DATE_RANGE"


def test_archived_class_and_closed_year_rejection(test_db_setup):
    client = get_client(test_db_setup["admin"])

    # Archived class
    payload1 = {
        "user_id": test_db_setup["teacher1"].id,
        "academic_year_id": test_db_setup["year"].id,
        "academic_class_id": test_db_setup["archived_cls"].id,
        "class_role": "HOMEROOM_TEACHER",
    }
    r1 = client.post("/api/teacher-class-assignments", json=payload1)
    assert r1.status_code == 400
    assert r1.json()["detail"]["code"] == "CLASS_NOT_ACTIVE"

    # Closed academic year
    payload2 = {
        "user_id": test_db_setup["teacher1"].id,
        "academic_year_id": test_db_setup["closed_year"].id,
        "academic_class_id": test_db_setup["cls1"].id,
        "class_role": "HOMEROOM_TEACHER",
    }
    r2 = client.post("/api/teacher-class-assignments", json=payload2)
    assert r2.status_code == 400
    assert r2.json()["detail"]["code"] == "ACADEMIC_YEAR_CLOSED"


def test_unauthenticated_and_unauthorized_mutation(test_db_setup):
    unauth_client = get_client(user=None)
    r_unauth = unauth_client.post("/api/teacher-class-assignments", json={})
    assert r_unauth.status_code == 401

    teacher_client = get_client(test_db_setup["teacher1"])
    r_forbidden = teacher_client.post("/api/teacher-class-assignments", json={})
    assert r_forbidden.status_code == 403


def test_teacher_class_scoping_and_unassigned_blocking(test_db_setup):
    db_session = test_db_setup["session"]
    admin_client = get_client(test_db_setup["admin"])

    # Assign teacher1 to cls1 (effective 2025-07-01 to 2025-12-31)
    admin_client.post(
        "/api/teacher-class-assignments",
        json={
            "user_id": test_db_setup["teacher1"].id,
            "academic_year_id": test_db_setup["year"].id,
            "academic_class_id": test_db_setup["cls1"].id,
            "class_role": "HOMEROOM_TEACHER",
            "effective_from": "2025-07-01",
            "effective_to": "2025-12-31",
        },
    )

    teacher_client = get_client(test_db_setup["teacher1"])

    # Teacher sees assigned class cls1
    r_assigned = teacher_client.get(f"/api/attendance/classes/{test_db_setup['cls1'].id}/dates/2025-09-01")
    assert r_assigned.status_code == 200

    # Teacher blocked from unassigned class cls2
    r_unassigned = teacher_client.get(f"/api/attendance/classes/{test_db_setup['cls2'].id}/dates/2025-09-01")
    assert r_unassigned.status_code == 403
    assert r_unassigned.json()["detail"]["code"] == "ATTENDANCE_CLASS_SCOPE_FORBIDDEN"

    # Expired date (2026-01-15) returns 403
    r_expired = teacher_client.get(f"/api/attendance/classes/{test_db_setup['cls1'].id}/dates/2026-01-15")
    assert r_expired.status_code == 403
    assert r_expired.json()["detail"]["code"] == "ATTENDANCE_CLASS_SCOPE_FORBIDDEN"

    # Admin retains global access to unassigned class cls2
    admin_client = get_client(test_db_setup["admin"])
    r_admin = admin_client.get(f"/api/attendance/classes/{test_db_setup['cls2'].id}/dates/2025-09-01")
    assert r_admin.status_code == 200


def test_date_effective_roster_transferred_withdrawn_graduated(test_db_setup):
    db_session = test_db_setup["session"]

    cls1_id = test_db_setup["cls1"].id
    year_id = test_db_setup["year"].id

    s1 = Student(name="Active Student 1")
    s2 = Student(name="Transferred Student 2")
    s3 = Student(name="Withdrawn Student 3")
    s4 = Student(name="Graduated Student 4")
    db_session.add_all([s1, s2, s3, s4])
    db_session.flush()

    m1 = StudentMaster(id="m1", nisn="1001", full_name="Active Student 1", normalized_name="active student 1")
    m2 = StudentMaster(id="m2", nisn="1002", full_name="Transferred Student 2", normalized_name="transferred student 2")
    m3 = StudentMaster(id="m3", nisn="1003", full_name="Withdrawn Student 3", normalized_name="withdrawn student 3")
    m4 = StudentMaster(id="m4", nisn="1004", full_name="Graduated Student 4", normalized_name="graduated student 4")
    db_session.add_all([m1, m2, m3, m4])
    db_session.flush()

    e1 = StudentEnrollment(student_id=s1.id, student_master_id=m1.id, academic_year_id=year_id, jenjang_id=1, academic_class_id=cls1_id, lifecycle_state="ACTIVE")
    e2 = StudentEnrollment(student_id=s2.id, student_master_id=m2.id, academic_year_id=year_id, jenjang_id=1, academic_class_id=cls1_id, lifecycle_state="ACTIVE", effective_from=date(2025, 9, 1), effective_to=date(2025, 11, 30))
    e3 = StudentEnrollment(student_id=s3.id, student_master_id=m3.id, academic_year_id=year_id, jenjang_id=1, academic_class_id=cls1_id, lifecycle_state="WITHDRAWN")
    e4 = StudentEnrollment(student_id=s4.id, student_master_id=m4.id, academic_year_id=year_id, jenjang_id=1, academic_class_id=cls1_id, lifecycle_state="GRADUATED")
    db_session.add_all([e1, e2, e3, e4])
    db_session.commit()

    admin_client = get_client(test_db_setup["admin"])

    # On 2025-08-15 (before s2 effective_from): s1 only
    r_aug = admin_client.get(f"/api/attendance/classes/{cls1_id}/dates/2025-08-15")
    assert r_aug.status_code == 200
    aug_students = [item["student_id"] for item in r_aug.json()["items"]]
    assert s1.id in aug_students
    assert s2.id not in aug_students
    assert s3.id not in aug_students
    assert s4.id not in aug_students

    # On 2025-10-15 (during s2 active window): s1 and s2
    r_oct = admin_client.get(f"/api/attendance/classes/{cls1_id}/dates/2025-10-15")
    assert r_oct.status_code == 200
    oct_students = [item["student_id"] for item in r_oct.json()["items"]]
    assert s1.id in oct_students
    assert s2.id in oct_students


def test_bulk_attendance_entry_and_transactional_rollback(test_db_setup):
    db_session = test_db_setup["session"]

    cls1_id = test_db_setup["cls1"].id
    year_id = test_db_setup["year"].id

    s1 = Student(name="Student A")
    s2 = Student(name="Student B")
    db_session.add_all([s1, s2])
    db_session.flush()

    e1 = StudentEnrollment(student_id=s1.id, academic_year_id=year_id, jenjang_id=1, academic_class_id=cls1_id, lifecycle_state="ACTIVE")
    e2 = StudentEnrollment(student_id=s2.id, academic_year_id=year_id, jenjang_id=1, academic_class_id=cls1_id, lifecycle_state="ACTIVE")
    db_session.add_all([e1, e2])
    db_session.commit()

    admin_client = get_client(test_db_setup["admin"])

    # Valid bulk entry
    payload = {
        "entries": [
            {"student_id": s1.id, "status": "on-time", "check_in": "07:30"},
            {"student_id": s2.id, "status": "late", "check_in": "08:15"},
        ]
    }
    r = admin_client.post(f"/api/attendance/classes/{cls1_id}/dates/2025-09-01/entries", json=payload)
    assert r.status_code == 200
    assert r.json()["total_submitted"] == 2

    # Verify records created with session actor
    att1 = db_session.query(Attendance).filter(Attendance.student_id == s1.id, Attendance.date == date(2025, 9, 1)).first()
    assert att1 is not None
    assert att1.status == "on-time"

    # Transactional rollback test with un-enrolled student ID
    invalid_payload = {
        "entries": [
            {"student_id": s1.id, "status": "absent"},
            {"student_id": 99999, "status": "on-time"},
        ]
    }
    r_bad = admin_client.post(f"/api/attendance/classes/{cls1_id}/dates/2025-09-01/entries", json=invalid_payload)
    assert r_bad.status_code == 400
    assert r_bad.json()["detail"]["code"] == "ATTENDANCE_ENROLLMENT_NOT_EFFECTIVE"

    # Verify s1 status was NOT mutated due to full transaction rollback
    db_session.refresh(att1)
    assert att1.status == "on-time"


def test_finalized_date_blocking(test_db_setup):
    db_session = test_db_setup["session"]

    cls1_id = test_db_setup["cls1"].id
    year_id = test_db_setup["year"].id

    s1 = Student(name="Student Lock")
    db_session.add(s1)
    db_session.flush()
    e1 = StudentEnrollment(student_id=s1.id, academic_year_id=year_id, jenjang_id=1, academic_class_id=cls1_id, lifecycle_state="ACTIVE")
    db_session.add(e1)

    # Finalize period for date 2025-09-05
    period = AttendancePeriod(attendance_date=date(2025, 9, 5), status="FINALIZED", finalized_by="admin_user")
    db_session.add(period)
    db_session.commit()

    admin_client = get_client(test_db_setup["admin"])

    payload = {
        "entries": [
            {"student_id": s1.id, "status": "on-time"}
        ]
    }
    r = admin_client.post(f"/api/attendance/classes/{cls1_id}/dates/2025-09-05/entries", json=payload)
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "ATTENDANCE_DATE_FINALIZED"
