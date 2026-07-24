from datetime import date, datetime, time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.attendance_corrections import router
from api.review import router as review_router
from core.database import Base, get_db
from models.attendance import Attendance
from models.attendance_review import AttendanceCorrectionAudit, AttendanceCorrectionRequest, AttendanceOverride, AttendanceOverrideHistory, AttendancePeriodAudit
from models.student import Student
from models.user import User
from security.dependencies import get_current_user
from services.attendance_corrections import effective_snapshot


@pytest.fixture
def correction_app():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    @event.listens_for(engine, "connect")
    def fks(connection, _record): connection.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    db.add(Student(id=8801, name="Correction Student")); db.flush()
    attendance = Attendance(student_id=8801, date=date(2026, 7, 24), check_in=time(7), check_out=time(14),
                            late_duration=0, late_source="none", is_absent=False, status="on-time")
    db.add(attendance); db.commit()
    app = FastAPI(); app.include_router(router, prefix="/api/attendance-corrections")
    app.include_router(review_router, prefix="/api/review")
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    yield app, client, db, attendance
    client.close(); db.close(); Base.metadata.drop_all(engine)


def login_as(app, username, role):
    app.dependency_overrides[get_current_user] = lambda: User(id=1, username=username, role=role, is_active=True)


def create_and_submit(app, client, attendance_id, requester="maker"):
    login_as(app, requester, "staff")
    created = client.post("/api/attendance-corrections", json={
        "attendance_id": attendance_id, "proposed_status": "late", "proposed_check_in": "07:35",
        "reason_code": "SCAN_REVIEW", "explanation": "Verified device scan discrepancy",
    })
    assert created.status_code == 200, created.text
    submitted = client.post(f"/api/attendance-corrections/{created.json()['id']}/submit")
    assert submitted.status_code == 200
    return submitted.json()


def test_pending_request_has_no_effect_and_session_requester_is_trusted(correction_app):
    app, client, db, attendance = correction_app
    submitted = create_and_submit(app, client, attendance.id)
    assert submitted["requester"] == "maker"
    assert submitted["state"] == "SUBMITTED"
    assert db.query(AttendanceOverride).count() == 0
    assert attendance.status == "on-time"
    assert effective_snapshot(db, attendance)["status"] == "on-time"
    assert [row.action for row in db.query(AttendanceCorrectionAudit).all()] == ["CREATE", "SUBMIT"]


def test_self_approval_and_unauthorized_approval_are_blocked_without_mutation(correction_app):
    app, client, db, attendance = correction_app
    submitted = create_and_submit(app, client, attendance.id)
    denied = client.post(f"/api/attendance-corrections/{submitted['id']}/approve",
                         json={"confirmation": "APPROVE_ATTENDANCE_CORRECTION"})
    assert denied.status_code == 403
    login_as(app, "other-staff", "staff")
    forbidden = client.post(f"/api/attendance-corrections/{submitted['id']}/approve",
                            json={"confirmation": "APPROVE_ATTENDANCE_CORRECTION"})
    assert forbidden.status_code == 403
    assert db.query(AttendanceOverride).count() == 0


def test_approval_uses_existing_override_ledger_and_updates_effective_value(correction_app):
    app, client, db, attendance = correction_app
    submitted = create_and_submit(app, client, attendance.id)
    login_as(app, "checker", "admin")
    approved = client.post(f"/api/attendance-corrections/{submitted['id']}/approve",
                           json={"confirmation": "APPROVE_ATTENDANCE_CORRECTION"})
    assert approved.status_code == 200, approved.text
    assert approved.json()["state"] == "APPROVED"
    assert approved.json()["approver"] == "checker"
    override = db.query(AttendanceOverride).one()
    assert override.override_status == "late" and override.override_check_in == time(7, 35)
    assert db.query(AttendanceOverrideHistory).one().new_values["status"] == "late"
    assert attendance.status == "on-time"
    assert effective_snapshot(db, attendance)["status"] == "late"


def test_stale_request_is_marked_and_cannot_be_approved(correction_app):
    app, client, db, attendance = correction_app
    submitted = create_and_submit(app, client, attendance.id)
    db.add(AttendanceOverride(attendance_id=attendance.id, original_status="on-time", override_status="absent",
                              note="Concurrent decision", reviewed_by="other", reviewed_at=datetime.utcnow()))
    db.commit()
    login_as(app, "checker", "admin")
    response = client.post(f"/api/attendance-corrections/{submitted['id']}/approve",
                           json={"confirmation": "APPROVE_ATTENDANCE_CORRECTION"})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "ATTENDANCE_CORRECTION_STALE"
    assert db.get(AttendanceCorrectionRequest, submitted["id"]).state == "STALE"


def test_duplicate_rejection_and_cancellation_invariants(correction_app):
    app, client, db, attendance = correction_app
    submitted = create_and_submit(app, client, attendance.id)
    duplicate = client.post("/api/attendance-corrections", json={
        "attendance_id": attendance.id, "proposed_status": "absent",
        "reason_code": "OTHER", "explanation": "Another pending request",
    })
    assert duplicate.status_code == 409
    login_as(app, "checker", "admin")
    assert client.post(f"/api/attendance-corrections/{submitted['id']}/reject", json={"rejection_reason": "x"}).status_code == 422
    rejected = client.post(f"/api/attendance-corrections/{submitted['id']}/reject",
                           json={"rejection_reason": "Evidence does not support change"})
    assert rejected.status_code == 200 and rejected.json()["state"] == "REJECTED"
    assert db.query(AttendanceOverride).count() == 0
    assert effective_snapshot(db, attendance)["status"] == "on-time"
    assert client.post(f"/api/attendance-corrections/{submitted['id']}/cancel").status_code == 409


def test_finalize_blocks_direct_override_and_approval_then_reopen_allows_approval(correction_app):
    app, client, db, attendance = correction_app
    submitted = create_and_submit(app, client, attendance.id)
    login_as(app, "checker", "admin")
    finalized = client.post("/api/attendance-corrections/periods/finalize", json={
        "attendance_date": str(attendance.date), "reason": "Daily register verified",
        "confirmation": "FINALIZE_ATTENDANCE_PERIOD",
    })
    assert finalized.status_code == 200
    version = finalized.json()["version"]
    direct = client.post(f"/api/review/attendance/{attendance.id}/override",
                         json={"override_status": "late", "note": "Blocked final period"})
    assert direct.status_code == 409
    blocked = client.post(f"/api/attendance-corrections/{submitted['id']}/approve",
                          json={"confirmation": "APPROVE_ATTENDANCE_CORRECTION"})
    assert blocked.status_code == 409
    login_as(app, "staff", "staff")
    assert client.post("/api/attendance-corrections/periods/reopen", json={
        "attendance_date": str(attendance.date), "reason": "Unauthorized reopening attempt",
        "confirmation": "REOPEN_ATTENDANCE_PERIOD", "expected_version": version,
    }).status_code == 403
    login_as(app, "checker", "admin")
    reopened = client.post("/api/attendance-corrections/periods/reopen", json={
        "attendance_date": str(attendance.date), "reason": "Approved evidence received",
        "confirmation": "REOPEN_ATTENDANCE_PERIOD", "expected_version": version,
    })
    assert reopened.status_code == 200 and reopened.json()["status"] == "OPEN"
    approved = client.post(f"/api/attendance-corrections/{submitted['id']}/approve",
                           json={"confirmation": "APPROVE_ATTENDANCE_CORRECTION"})
    assert approved.status_code == 200
    refinalized = client.post("/api/attendance-corrections/periods/finalize", json={
        "attendance_date": str(attendance.date), "reason": "Correction reviewed and closed",
        "confirmation": "FINALIZE_ATTENDANCE_PERIOD",
    })
    assert refinalized.status_code == 200
    assert [row.action for row in db.query(AttendancePeriodAudit).order_by(AttendancePeriodAudit.id)] == ["FINALIZE", "REOPEN", "REFINALIZE"]
