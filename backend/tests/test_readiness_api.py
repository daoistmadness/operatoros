from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.exc import SQLAlchemyError

import api.readiness as readiness_api
from api.readiness import router
from core.database import Base, get_db
from models.academic_config import AcademicTermConfig
from models.academic_year import AcademicYear
from models.attendance import Attendance
from models.jenjang import Jenjang
from models.student import Student
from models.student_enrollment import StudentEnrollment
from security.dependencies import get_current_user


@pytest.fixture
def readiness_app():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    app = FastAPI()
    app.include_router(router, prefix="/api/readiness")
    app.dependency_overrides[get_db] = lambda: session
    yield app, session
    session.close()
    engine.dispose()


def _as_role(app, role):
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1, role=role)


def _seed_required(session):
    year = AcademicYear(label="2026/2027", start_date=date(2026, 7, 1), end_date=date(2027, 6, 30), status="active", is_default=True)
    student = Student(name="Synthetic Readiness Student")
    jenjang = Jenjang(name="Synthetic Primary", code="SYN-PRIMARY", level="primary")
    session.add_all([year, student, jenjang])
    session.flush()
    enrollment = StudentEnrollment(student_id=student.id, academic_year_id=year.id, jenjang_id=jenjang.id, class_name="Synthetic 1A", class_assigned=True)
    session.add(enrollment)
    session.commit()
    return year, student


def test_readiness_requires_authentication(readiness_app):
    app, _ = readiness_app
    response = TestClient(app).get("/api/readiness")
    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required"}


def test_admin_first_run_has_ordered_permission_aware_steps(readiness_app):
    app, _ = readiness_app
    _as_role(app, "admin")
    response = TestClient(app).get("/api/readiness")
    assert response.status_code == 200
    payload = response.json()
    assert payload["overall_status"] == "FIRST_RUN"
    assert [step["code"] for step in payload["steps"]] == ["academic_year", "students", "enrollment", "device_link", "academic_terms", "attendance", "student_progression", "cutoff_jenjang"]
    assert [step["requirement"] for step in payload["steps"]] == ["REQUIRED", "REQUIRED", "REQUIRED", "RECOMMENDED", "WORKFLOW", "RECOMMENDED", "WORKFLOW", "OPTIONAL"]
    assert all(step["can_manage"] for step in payload["steps"])


def test_staff_receives_guidance_without_admin_actions(readiness_app):
    app, _ = readiness_app
    _as_role(app, "staff")
    payload = TestClient(app).get("/api/readiness").json()
    assert payload["overall_status"] == "READ_ONLY_GUIDANCE"
    required = [step for step in payload["steps"] if step["requirement"] == "REQUIRED"]
    assert all(step["destination"] is None and not step["can_manage"] for step in required)
    assert all("administrator" in step["responsibility"].lower() for step in required)


def test_required_completion_uses_valid_year_and_class_assigned_enrollment(readiness_app):
    app, session = readiness_app
    _as_role(app, "admin")
    _seed_required(session)
    payload = TestClient(app).get("/api/readiness").json()
    assert payload["overall_status"] == "READY_WITH_RECOMMENDATIONS"
    assert all(step["status"] == "COMPLETE" for step in payload["steps"][:3])
    assert payload["steps"][-1]["status"] == "OPTIONAL"


def test_partial_setup_does_not_treat_an_upcoming_year_as_usable(readiness_app):
    app, session = readiness_app
    _as_role(app, "admin")
    session.add(AcademicYear(label="Future", start_date=date(2028, 7, 1), end_date=date(2029, 6, 30), status="upcoming", is_default=False))
    session.add(Student(name="Synthetic Partial Student"))
    session.commit()
    payload = TestClient(app).get("/api/readiness").json()
    assert payload["overall_status"] == "SETUP_PARTIAL"
    assert payload["steps"][0]["status"] == "NOT_STARTED"
    assert payload["steps"][1]["status"] == "COMPLETE"


def test_workflow_data_moves_readiness_to_operational(readiness_app):
    app, session = readiness_app
    _as_role(app, "admin")
    year, student = _seed_required(session)
    session.add(AcademicTermConfig(academic_year_id=year.id, term_number=1, label="Term 1", start_date=date(2026, 7, 1), end_date=date(2026, 12, 31)))
    session.add(Attendance(student_id=student.id, date=date(2026, 7, 2), status="Hadir", late_duration=0, late_source="none", is_absent=False))
    session.commit()
    payload = TestClient(app).get("/api/readiness").json()
    assert payload["overall_status"] == "OPERATIONALLY_READY"
    assert payload["steps"][3]["status"] == payload["steps"][4]["status"] == "COMPLETE"


def test_readiness_get_does_not_mutate_database(readiness_app):
    app, session = readiness_app
    _as_role(app, "admin")
    before = {table.__tablename__: session.query(table).count() for table in [AcademicYear, Student, StudentEnrollment, Attendance]}
    assert TestClient(app).get("/api/readiness").status_code == 200
    after = {table.__tablename__: session.query(table).count() for table in [AcademicYear, Student, StudentEnrollment, Attendance]}
    assert after == before


def test_internal_readiness_error_is_sanitized(readiness_app, monkeypatch):
    app, _ = readiness_app
    _as_role(app, "admin")

    def fail(*_args, **_kwargs):
        raise SQLAlchemyError("SQLSTATE secret table constraint /srv/private.py")

    monkeypatch.setattr(readiness_api, "build_setup_readiness", fail)
    response = TestClient(app, raise_server_exceptions=False).get("/api/readiness")
    assert response.status_code == 500
    assert response.json() == {"detail": "Setup readiness could not be checked. Retry or contact the system administrator."}
    assert not any(term in response.text.lower() for term in ["sqlstate", "secret", "table", "constraint", "/srv/"])
