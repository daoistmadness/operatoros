import hashlib
import hmac
import importlib
import json
import multiprocessing
import os
import sqlite3
import subprocess
import sys
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
SOURCE_ROOT = BACKEND / "src"
MIGRATION = BACKEND / "migrations" / "20260713_identity_schema_sqlite.sql"
TEST_SECRET = "authentication-test-secret-shared-across-workers"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from core.config import Settings
from core.database import Base
from models.user import User
from models.user_session import UserSession
from security.password import hash_password, verify_password
from security.sessions import (
    create_session,
    revoke_session,
    session_digest,
    utc_now,
    validate_session,
)


def _configuration(database: Path, backup_dir: Path, **values) -> Settings:
    return Settings(
        DATABASE_URL=f"sqlite:///{database}",
        AUTH_COOKIE_SECRET=values.get("secret", TEST_SECRET),
        BACKUP_DIR=str(backup_dir),
        SESSION_IDLE_TIMEOUT_HOURS=values.get("idle", 6),
        SESSION_ABSOLUTE_TIMEOUT_HOURS=values.get("absolute", 24),
        MAX_FAILED_LOGIN_ATTEMPTS=values.get("attempts", 5),
        ACCOUNT_LOCK_MINUTES=values.get("lock_minutes", 30),
    )


@pytest.fixture
def identity_db(tmp_path):
    path = tmp_path / "identity.db"
    engine = create_engine(f"sqlite:///{path}")
    User.__table__.create(engine)
    UserSession.__table__.create(engine)
    SessionLocal = sessionmaker(bind=engine)
    yield path, engine, SessionLocal, _configuration(path, tmp_path / "audit")
    engine.dispose()


def _add_user(SessionLocal, username="admin", password="correct horse battery", role="admin"):
    db = SessionLocal()
    user = User(username=username, password_hash=hash_password(password), role=role, is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    db.close()
    return user.id


def test_password_hash_is_argon2id_and_verifies_without_plaintext():
    password = "a sufficiently long passphrase"
    encoded = hash_password(password)
    assert encoded.startswith("$argon2id$")
    assert password not in encoded
    assert verify_password(encoded, password) is True
    assert verify_password(encoded, "incorrect password") is False
    with pytest.raises(ValueError, match="12"):
        hash_password("too-short")


def test_session_stores_hmac_digest_not_raw_token(identity_db):
    _, _, SessionLocal, configuration = identity_db
    user_id = _add_user(SessionLocal)
    db = SessionLocal()
    user = db.get(User, user_id)
    token, session = create_session(db, user, configuration=configuration)
    db.commit()
    assert token != session.token_hash
    assert session.token_hash == hmac.new(
        TEST_SECRET.encode(), token.encode(), hashlib.sha256
    ).hexdigest()
    assert db.query(UserSession).filter(UserSession.token_hash == token).first() is None
    db.close()


def test_valid_expired_revoked_and_absolute_sessions(identity_db):
    _, _, SessionLocal, configuration = identity_db
    user_id = _add_user(SessionLocal)
    now = utc_now()
    db = SessionLocal()
    user = db.get(User, user_id)
    token, session = create_session(db, user, configuration=configuration, now=now)
    db.commit()
    assert validate_session(db, token, configuration=configuration, now=now + timedelta(minutes=1))

    session.expires_at = now - timedelta(seconds=1)
    db.commit()
    assert validate_session(db, token, configuration=configuration, now=now) is None
    assert session.revoked_at is not None

    token2, session2 = create_session(db, user, configuration=configuration, now=now)
    db.commit()
    revoke_session(session2, now=now)
    db.commit()
    assert validate_session(db, token2, configuration=configuration, now=now) is None

    token3, session3 = create_session(db, user, configuration=configuration, now=now)
    session3.expires_at = now + timedelta(hours=12)
    session3.absolute_expires_at = now - timedelta(seconds=1)
    db.commit()
    assert validate_session(db, token3, configuration=configuration, now=now) is None
    db.close()


def _child_validate(database: str, token: str, secret: str, queue):
    sys.path.insert(0, str(SOURCE_ROOT))
    from core.config import Settings as ChildSettings
    from security.sessions import validate_session as child_validate
    child_engine = create_engine(f"sqlite:///{database}")
    ChildSession = sessionmaker(bind=child_engine)
    db = ChildSession()
    try:
        result = child_validate(
            db,
            token,
            configuration=ChildSettings(DATABASE_URL=f"sqlite:///{database}", AUTH_COOKIE_SECRET=secret),
        )
        queue.put(result.user.username if result else None)
    finally:
        db.close()
        child_engine.dispose()


def test_session_created_in_one_process_validates_in_another(identity_db):
    path, _, SessionLocal, configuration = identity_db
    user_id = _add_user(SessionLocal)
    db = SessionLocal()
    token, _ = create_session(db, db.get(User, user_id), configuration=configuration)
    db.commit()
    db.close()
    context = multiprocessing.get_context("spawn")
    queue = context.Queue()
    process = context.Process(target=_child_validate, args=(str(path), token, TEST_SECRET, queue))
    process.start()
    process.join(timeout=20)
    assert process.exitcode == 0
    assert queue.get(timeout=2) == "admin"


def _unload_application_modules():
    for name in list(sys.modules):
        if name == "src" or name.startswith(("src.", "api.", "core.", "models.", "security.", "services.")):
            sys.modules.pop(name, None)


@pytest.fixture
def auth_api(monkeypatch, tmp_path):
    _unload_application_modules()
    database = tmp_path / "api.db"
    connection = sqlite3.connect(database)
    connection.execute("PRAGMA foreign_keys=ON")
    connection.executescript(MIGRATION.read_text(encoding="utf-8"))
    connection.close()
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database}")
    monkeypatch.setenv("AUTH_COOKIE_SECRET", TEST_SECRET)
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path / "audit"))
    monkeypatch.setenv("MAX_FAILED_LOGIN_ATTEMPTS", "3")
    module = importlib.import_module("src.main")
    from core.database import SessionLocal
    from models.user import User as ApiUser
    from security.password import hash_password as api_hash_password

    db = SessionLocal()
    db.add(ApiUser(username="admin", password_hash=api_hash_password("correct horse battery"), role="admin"))
    db.commit()
    db.close()
    client = TestClient(module.app)
    yield client, tmp_path, SessionLocal
    client.close()
    module.engine.dispose() if hasattr(module, "engine") else None
    _unload_application_modules()


def test_login_cookie_me_logout_and_no_sensitive_response(auth_api):
    client, tmp_path, SessionLocal = auth_api
    assert client.get("/api/auth/me").status_code == 401
    response = client.post(
        "/api/auth/login", json={"username": "admin", "password": "correct horse battery"}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == 1 and payload["username"] == "admin" and payload["role"] == "admin"
    assert "view_student" in payload["capabilities"]
    assert "edit_sensitive_identifiers" in payload["capabilities"]
    assert "password" not in response.text and "token" not in response.text
    cookie = response.headers["set-cookie"].lower()
    assert "astyx_session=" in cookie and "httponly" in cookie
    assert "samesite=lax" in cookie and "path=/" in cookie and "max-age=" in cookie
    assert "secure" not in cookie
    assert client.get("/api/auth/me").json()["username"] == "admin"

    db = SessionLocal()
    stored = db.query(sys.modules["models.user_session"].UserSession).one()
    assert stored.token_hash != client.cookies.get("astyx_session")
    db.close()

    logout = client.post("/api/auth/logout")
    assert logout.status_code == 204
    assert client.get("/api/auth/me").status_code == 401
    audit = (tmp_path / "audit" / "authentication_audit.jsonl").read_text()
    assert '"event": "login_success"' in audit and '"event": "logout"' in audit
    assert "correct horse battery" not in audit and "argon2" not in audit


def test_invalid_login_is_generic_audited_and_locks_account(auth_api):
    client, tmp_path, SessionLocal = auth_api
    for _ in range(3):
        response = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid username or password"
    unknown = client.post("/api/auth/login", json={"username": "missing", "password": "wrong"})
    assert unknown.status_code == 401 and unknown.json()["detail"] == "Invalid username or password"
    db = SessionLocal()
    user = db.query(sys.modules["models.user"].User).filter_by(username="admin").one()
    assert user.failed_login_attempts == 3 and user.locked_until is not None
    db.close()
    audit_path = tmp_path / "audit" / "authentication_audit.jsonl"
    entries = [json.loads(line) for line in audit_path.read_text().splitlines()]
    assert [entry["event"] for entry in entries] == ["login_failed"] * 4
    assert all(set(entry) == {
        "timestamp", "event", "user_id", "username", "session_id_hash",
        "user_agent", "ip_address", "metadata"
    } for entry in entries)
    assert "wrong" not in audit_path.read_text()


def test_missing_auth_secret_fails_configuration_and_application_start(tmp_path):
    with pytest.raises(ValueError, match="AUTH_COOKIE_SECRET"):
        Settings(DATABASE_URL="sqlite:///test.db", AUTH_COOKIE_SECRET=None).require_auth_cookie_secret()
    environment = os.environ.copy()
    environment["AUTH_COOKIE_SECRET"] = ""
    environment["DATABASE_URL"] = f"sqlite:///{tmp_path / 'missing-secret.db'}"
    environment["PYTHONPATH"] = os.pathsep.join((str(BACKEND), str(SOURCE_ROOT)))
    result = subprocess.run(
        [str(BACKEND / ".venv" / "bin" / "python"), "-c", "import src.main"],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode != 0
    assert "AUTH_COOKIE_SECRET" in result.stderr


def test_application_startup_does_not_create_migration_owned_identity_tables(tmp_path):
    database = tmp_path / "startup.db"
    environment = os.environ.copy()
    environment["AUTH_COOKIE_SECRET"] = TEST_SECRET
    environment["DATABASE_URL"] = f"sqlite:///{database}"
    environment["PYTHONPATH"] = os.pathsep.join((str(BACKEND), str(SOURCE_ROOT)))
    result = subprocess.run(
        [str(BACKEND / ".venv" / "bin" / "python"), "-c", "import src.main"],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    connection = sqlite3.connect(database)
    try:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert "users" not in tables and "sessions" not in tables
    finally:
        connection.close()
