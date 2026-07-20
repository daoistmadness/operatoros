import importlib
import json
import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"
MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "20260713_identity_schema_sqlite.sql"
TEST_SECRET = "authorization-test-secret-shared-across-workers"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))


def _unload():
    for name in list(sys.modules):
        if name == "src" or name.startswith(("src.", "api.", "core.", "models.", "security.", "services.")):
            sys.modules.pop(name, None)


@pytest.fixture
def authorization_app(monkeypatch, tmp_path):
    _unload()
    database = tmp_path / "authorization.db"
    connection = sqlite3.connect(database)
    connection.execute("PRAGMA foreign_keys=ON")
    connection.executescript(MIGRATION.read_text(encoding="utf-8"))
    connection.close()
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database}")
    monkeypatch.setenv("AUTH_COOKIE_SECRET", TEST_SECRET)
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path / "backups"))
    monkeypatch.setenv("BACKUP_MIN_FREE_MB", "0")
    monkeypatch.setenv("ENABLE_DESTRUCTIVE_OPERATIONS", "false")
    module = importlib.import_module("src.main")
    from core.database import SessionLocal
    from models.user import User
    from security.password import hash_password

    db = SessionLocal()
    db.add_all(
        [
            User(username="admin", password_hash=hash_password("admin authorization pass"), role="admin"),
            User(username="staff", password_hash=hash_password("staff authorization pass"), role="staff"),
        ]
    )
    db.commit()
    db.close()
    yield module, tmp_path
    module.engine.dispose() if hasattr(module, "engine") else None
    _unload()


def _client(module, username=None, password=None):
    client = TestClient(module.app)
    if username:
        response = client.post("/api/auth/login", json={"username": username, "password": password})
        assert response.status_code == 200
    return client


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/admin/backups/status"),
        ("get", "/api/admin/backups"),
        ("post", "/api/admin/backups"),
    ],
)
def test_anonymous_backup_management_is_rejected(authorization_app, method, path):
    module, _ = authorization_app
    client = _client(module)
    response = getattr(client, method)(path)
    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required"}
    client.close()


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/admin/backups/status"),
        ("get", "/api/admin/backups"),
        ("post", "/api/admin/backups"),
    ],
)
def test_staff_backup_management_is_forbidden_and_audited(authorization_app, method, path):
    module, tmp_path = authorization_app
    client = _client(module, "staff", "staff authorization pass")
    raw_cookie = client.cookies.get("astyx_session")
    response = getattr(client, method)(path)
    assert response.status_code == 403
    assert response.json() == {"detail": "Insufficient permissions"}
    entries = [
        json.loads(line)
        for line in (tmp_path / "backups" / "authentication_audit.jsonl").read_text().splitlines()
    ]
    denied = entries[-1]
    assert denied["event"] == "authorization_denied"
    assert denied["username"] == "staff" and denied["resource"] == path
    assert denied["reason"] == "requires_admin"
    serialized = json.dumps(denied)
    assert TEST_SECRET not in serialized and raw_cookie not in serialized
    client.close()


def test_admin_can_use_backup_management(authorization_app):
    module, _ = authorization_app
    client = _client(module, "admin", "admin authorization pass")
    status = client.get("/api/admin/backups/status")
    assert status.status_code == 200 and status.json()["authentication_available"] is True
    assert client.get("/api/admin/backups").status_code == 200
    created = client.post("/api/admin/backups")
    assert created.status_code == 200 and created.json()["filename"].endswith(".sqlite3")
    client.close()


def test_jenjang_cutoff_reads_require_authentication(authorization_app):
    module, _ = authorization_app
    client = _client(module)
    assert client.get("/api/config/jenjang").status_code == 401
    assert client.get("/api/config/jenjang/available").status_code == 401
    client.close()


def test_staff_can_read_but_cannot_mutate_jenjang_cutoffs(authorization_app):
    module, _ = authorization_app
    client = _client(module, "staff", "staff authorization pass")
    assert client.get("/api/config/jenjang").status_code == 200
    assert client.get("/api/config/jenjang/available").status_code == 200
    denied_save = client.put("/api/config/jenjang/Primary", json={"cutoff_time": "07:00"})
    denied_delete = client.delete("/api/config/jenjang/Primary")
    assert denied_save.status_code == 403
    assert denied_delete.status_code == 403
    assert denied_save.json() == {"detail": "Insufficient permissions"}
    client.close()


def test_admin_jenjang_cutoff_mutation_reaches_domain_validation(authorization_app):
    module, _ = authorization_app
    client = _client(module, "admin", "admin authorization pass")
    response = client.put("/api/config/jenjang/Unknown", json={"cutoff_time": "07:00"})
    assert response.status_code == 400
    assert response.json() == {"detail": "jenjang must exist in students data"}
    client.close()


@pytest.mark.parametrize(
    "path",
    [
        "/api/reports/filters",
        "/api/reports/monthly?academic_year_id=1&month=2026-07&scope=combined",
        "/api/reports/annual?academic_year_id=1&scope=combined",
        "/api/reports/monthly/export?academic_year_id=1&month=2026-07&scope=combined&format=pdf",
        "/api/reports/annual/export?academic_year_id=1&scope=combined&format=xlsx",
    ],
)
def test_anonymous_reports_and_exports_are_rejected(authorization_app, path):
    module, _ = authorization_app
    client = _client(module)
    response = client.get(path)
    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required"}
    client.close()


def test_destructive_system_reset_requires_admin_before_feature_flag(authorization_app):
    module, _ = authorization_app
    payload = {"mode": "attendance", "confirmation": "CLEAR_ALL_ATTENDANCE_DATA"}
    anonymous = _client(module)
    assert anonymous.post("/api/system/clear-data", json=payload).status_code == 401
    anonymous.close()
    staff = _client(module, "staff", "staff authorization pass")
    denied = staff.post("/api/system/clear-data", json=payload)
    assert denied.status_code == 403 and denied.json()["detail"] == "Insufficient permissions"
    staff.close()
    admin = _client(module, "admin", "admin authorization pass")
    guarded = admin.post("/api/system/clear-data", json=payload)
    assert guarded.status_code == 403
    assert guarded.json()["detail"] == "Destructive operations are disabled."
    admin.close()


def test_restore_authorization_and_phase6_safety_chain(authorization_app):
    module, _ = authorization_app
    filename = "backup_2026-07-13T00-00-00Z.sqlite3"
    anonymous = _client(module)
    assert anonymous.post(
        f"/api/admin/backups/{filename}/restore", json={"confirmation": filename}
    ).status_code == 401
    anonymous.close()

    staff = _client(module, "staff", "staff authorization pass")
    assert staff.post(
        f"/api/admin/backups/{filename}/restore", json={"confirmation": filename}
    ).status_code == 403
    staff.close()

    admin = _client(module, "admin", "admin authorization pass")
    created = admin.post("/api/admin/backups").json()["filename"]
    disabled = admin.post(
        f"/api/admin/backups/{created}/restore", json={"confirmation": created}
    )
    assert disabled.status_code == 403 and disabled.json()["detail"] == "Destructive operations are disabled."

    module.settings.ENABLE_DESTRUCTIVE_OPERATIONS = True
    typed_confirmation = admin.post(
        f"/api/admin/backups/{created}/restore", json={"confirmation": "wrong"}
    )
    assert typed_confirmation.status_code == 400
    assert "exactly match" in typed_confirmation.json()["detail"]
    admin.close()


def test_legacy_request_role_is_metadata_not_authorization(authorization_app):
    module, _ = authorization_app
    staff = _client(module, "staff", "staff authorization pass")
    response = staff.post(
        "/api/review/attendance/mass-override-incomplete",
        json={
            "override_status": "on-time",
            "note": "Authenticated staff review",
            "reviewed_by": "Display Name Only",
            "role": "untrusted-client-value",
        },
    )
    assert response.status_code == 200
    assert response.json()["reviewed_by"] == "Display Name Only"
    source = (SOURCE_ROOT / "api" / "review.py").read_text(encoding="utf-8")
    assert 'role not in {"admin", "teacher"}' not in source
    staff.close()


def test_authorization_helpers_use_database_user_identity():
    from security.dependencies import (
        get_authenticated_user_id,
        get_authenticated_username,
        require_role,
    )

    class Identity:
        id = 42
        username = "database-user"

    assert get_authenticated_user_id(Identity()) == 42
    assert get_authenticated_username(Identity()) == "database-user"
    with pytest.raises(ValueError, match="Unsupported"):
        require_role("teacher")
