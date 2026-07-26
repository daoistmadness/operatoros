import os
from datetime import date, datetime, time, timedelta, timezone
from unittest.mock import PropertyMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.attendance_corrections import router as corrections_router
from api.config import router as config_router
from api.operator_work_queue import router as operator_router
from api.readiness import router as readiness_router
from core.config import Settings, settings
from core.database import Base, get_db
from models.attendance import Attendance
from models.attendance_followup import AttendanceFollowUp
from models.attendance_review import AttendanceCorrectionRequest, AttendancePeriod
from models.student import Student
from models.user import User
from security.dependencies import get_current_user
from services.attendance_corrections import effective_snapshot
from services.operator_work_queue_service import derive_due_state


@pytest.fixture
def app_env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    @event.listens_for(engine, "connect")
    def set_fks(conn, _):
        conn.execute("PRAGMA foreign_keys=ON")
    
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    operator_user = User(
        id=1,
        username="operator1",
        password_hash="hashed_secret_test_password",
        role="admin",
    )
    db.add(operator_user)
    db.commit()

    test_app = FastAPI()
    test_app.include_router(config_router, prefix="/api/config")
    test_app.include_router(readiness_router, prefix="/api/readiness")
    test_app.include_router(corrections_router, prefix="/api/attendance-corrections")
    test_app.include_router(operator_router, prefix="/api/operator")

    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: operator_user

    client = TestClient(test_app)
    yield client, db, operator_user
    client.close()
    db.close()
    Base.metadata.drop_all(engine)


def test_deployment_mode_parsing():
    s1 = Settings(OPERATOROS_DEPLOYMENT_MODE="single_user_offline")
    assert s1.resolved_deployment_mode == "single_user_offline"

    s2 = Settings(OPERATOROS_DEPLOYMENT_MODE="multi_user")
    assert s2.resolved_deployment_mode == "multi_user"

    s3 = Settings(OPERATOROS_DEPLOYMENT_MODE="unknown_mode_123")
    assert s3.resolved_deployment_mode == "single_user_offline"


def test_derive_due_state_rules():
    now_utc = datetime.now(timezone.utc)
    
    assert derive_due_state(None, "RESOLVED") == "COMPLETED"
    assert derive_due_state(now_utc, "DISMISSED") == "COMPLETED"
    assert derive_due_state(now_utc, "APPROVED") == "COMPLETED"

    assert derive_due_state(None, "OPEN") == "NO_DUE_DATE"

    past_date = now_utc - timedelta(days=2)
    assert derive_due_state(past_date, "OPEN") == "OVERDUE"

    assert derive_due_state(now_utc, "OPEN") == "DUE_TODAY"

    future_date = now_utc + timedelta(days=2)
    assert derive_due_state(future_date, "OPEN") == "DUE_LATER"


def test_config_deployment_mode_endpoint(app_env):
    client, _, _ = app_env
    res = client.get("/api/config/deployment-mode")
    assert res.status_code == 200
    data = res.json()
    assert "deployment_mode" in data
    assert "is_single_user" in data


def test_readiness_deployment_mode(app_env):
    client, _, _ = app_env
    res = client.get("/api/readiness")
    assert res.status_code == 200
    data = res.json()
    assert "deployment_mode" in data


def test_work_queue_authenticated(app_env):
    client, _, _ = app_env
    res = client.get("/api/operator/work-queue")
    assert res.status_code == 200
    items = res.json()
    assert isinstance(items, list)
    for item in items:
        assert "item_type" in item
        assert "derived_due_state" in item
        assert "available_actions" in item
        assert "phone" not in item
        assert "guardian" not in item


def test_self_confirmation_workflow(app_env):
    client, db, _ = app_env
    s = Student(name="Test Student", class_name="10A", jenjang="SMA")
    db.add(s)
    db.flush()

    att = Attendance(student_id=s.id, date=date(2026, 7, 20), status="Alfa")
    db.add(att)
    db.commit()

    res_corr = client.post(
        "/api/attendance-corrections",
        json={
            "attendance_id": att.id,
            "proposed_status": "on-time",
            "reason_code": "SAKIT_SURAT",
            "explanation": "Ada surat dokter resmi dari rumah sakit.",
        },
    )
    assert res_corr.status_code == 200
    corr_data = res_corr.json()
    corr_id = corr_data["id"]

    res_sub = client.post(f"/api/attendance-corrections/{corr_id}/submit")
    assert res_sub.status_code == 200
    submitted_version = res_sub.json()["version"]

    res_bad_token = client.post(
        f"/api/attendance-corrections/{corr_id}/self-confirm",
        json={
            "expected_version": submitted_version,
            "confirmation": "WRONG_TOKEN",
            "confirmation_note": "Catatan konfirmasi mandiri.",
        },
    )
    assert res_bad_token.status_code == 400
    assert res_bad_token.json()["detail"]["code"] == "CORRECTION_CONFIRMATION_REQUIRED"

    res_bad_note = client.post(
        f"/api/attendance-corrections/{corr_id}/self-confirm",
        json={
            "expected_version": submitted_version,
            "confirmation": "CONFIRM_CORRECTION",
            "confirmation_note": "ab",
        },
    )
    assert res_bad_note.status_code in (400, 422)

    res_confirm = client.post(
        f"/api/attendance-corrections/{corr_id}/self-confirm",
        json={
            "expected_version": submitted_version,
            "confirmation": "CONFIRM_CORRECTION",
            "confirmation_note": "Dikonfirmasi mandiri oleh operator sekolah.",
        },
    )
    print("CONFIRM DETAIL:", res_confirm.status_code, res_confirm.json())
    assert res_confirm.status_code == 200
    conf_data = res_confirm.json()
    assert conf_data["state"] == "APPROVED"

    eff = effective_snapshot(db, att)
    assert eff["status"] == "on-time"


def test_self_confirmation_disabled_in_multi_user_mode(app_env):
    client, db, _ = app_env
    s = Student(name="Test Student 2", class_name="10B", jenjang="SMA")
    db.add(s)
    db.flush()

    att = Attendance(student_id=s.id, date=date(2026, 7, 21), status="Alfa")
    db.add(att)
    db.commit()

    res_corr = client.post(
        "/api/attendance-corrections",
        json={
            "attendance_id": att.id,
            "proposed_status": "on-time",
            "reason_code": "IZIN_ORANG_TUA",
            "explanation": "Izin keluarga.",
        },
    )
    corr_id = res_corr.json()["id"]
    res_sub = client.post(f"/api/attendance-corrections/{corr_id}/submit")
    submitted_version = res_sub.json()["version"]

    with patch("core.config.settings.OPERATOROS_DEPLOYMENT_MODE", "multi_user"):
        res_disabled = client.post(
            f"/api/attendance-corrections/{corr_id}/self-confirm",
            json={
                "expected_version": submitted_version,
                "confirmation": "CONFIRM_CORRECTION",
                "confirmation_note": "Konfirmasi mandiri",
            },
        )
        assert res_disabled.status_code == 403
        assert res_disabled.json()["detail"]["code"] == "CORRECTION_SELF_CONFIRMATION_DISABLED"
