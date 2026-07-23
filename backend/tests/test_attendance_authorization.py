from datetime import date, time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.review import router as review_router
from core.database import Base, get_db
from models.attendance import Attendance
from models.attendance_review import AttendanceOverride, AttendanceOverrideHistory
from models.student import Student
from models.user import User
from security.dependencies import get_current_user


@pytest.fixture
def review_app():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def enable_fks(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    student = Student(id=7701, name="Synthetic Student")
    db.add(student)
    db.flush()
    attendance = Attendance(
        student_id=student.id,
        date=date(2026, 7, 1),
        check_in=time(7),
        check_out=time(14),
        late_duration=0,
        late_source="none",
        is_absent=False,
        status="on-time",
    )
    db.add(attendance)
    db.commit()

    app = FastAPI()
    app.include_router(review_router, prefix="/api/review")
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    yield app, client, db, attendance.id
    client.close()
    db.close()
    Base.metadata.drop_all(engine)


def as_user(app, username, role):
    app.dependency_overrides[get_current_user] = lambda: User(
        id=1 if role == "admin" else 2,
        username=username,
        role=role,
        is_active=True,
    )


def test_anonymous_review_history_and_override_are_rejected_without_write(review_app):
    _app, client, db, attendance_id = review_app
    assert client.get("/api/review/classes").status_code == 401
    assert client.get(f"/api/review/attendance/{attendance_id}/history").status_code == 401
    assert client.post(
        f"/api/review/attendance/{attendance_id}/override",
        json={"override_status": "late", "note": "Anonymous spoof"},
    ).status_code == 401
    assert db.query(AttendanceOverride).count() == 0
    assert db.query(AttendanceOverrideHistory).count() == 0


def test_staff_can_read_but_cannot_override(review_app):
    app, client, db, attendance_id = review_app
    as_user(app, "staff-reader", "staff")
    assert client.get("/api/review/classes").status_code == 200
    assert client.get(f"/api/review/attendance/{attendance_id}/history").status_code == 200
    response = client.post(
        f"/api/review/attendance/{attendance_id}/override",
        json={"override_status": "late", "note": "Staff denied"},
    )
    assert response.status_code == 403
    assert db.query(AttendanceOverride).count() == 0


def test_admin_override_uses_session_actor_and_rejects_spoofed_field(review_app):
    app, client, db, attendance_id = review_app
    as_user(app, "database-admin", "admin")
    spoofed = client.post(
        f"/api/review/attendance/{attendance_id}/override",
        json={"override_status": "late", "note": "Spoof rejected", "reviewed_by": "attacker"},
    )
    assert spoofed.status_code == 422
    assert db.query(AttendanceOverride).count() == 0

    accepted = client.post(
        f"/api/review/attendance/{attendance_id}/override",
        json={"override_status": "late", "note": "Approved correction"},
    )
    assert accepted.status_code == 200
    assert accepted.json()["reviewed_by"] == "database-admin"
    assert db.query(AttendanceOverride).one().reviewed_by == "database-admin"
    assert db.query(AttendanceOverrideHistory).one().reviewed_by == "database-admin"

    history = client.get(f"/api/review/attendance/{attendance_id}/history")
    assert history.status_code == 200
    assert history.json()["items"][0]["reviewed_by"] == "database-admin"
