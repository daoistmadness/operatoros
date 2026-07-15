import importlib
import json
import sqlite3
import sys
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine


SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from services import restore_service
from services.backup_service import calculate_sha256, create_backup
from services.restore_service import RestoreError, restore_backup


def _simple_db(path: Path, attendance_rows: int = 1):
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.executescript(
        """
        CREATE TABLE attendance (id INTEGER PRIMARY KEY, status TEXT);
        CREATE TABLE attendance_override_history (id INTEGER PRIMARY KEY, note TEXT);
        CREATE TABLE student_enrollments (id INTEGER PRIMARY KEY, student_id INTEGER);
        CREATE TABLE student_subject_grades (id INTEGER PRIMARY KEY, score REAL);
        """
    )
    migration = Path(__file__).resolve().parents[1] / "migrations" / "20260713_identity_schema_sqlite.sql"
    connection.executescript(migration.read_text(encoding="utf-8"))
    connection.execute(
        "INSERT INTO users(username, password_hash, role, is_active) VALUES ('restore-admin', 'test-hash', 'admin', 1)"
    )
    for index in range(attendance_rows):
        connection.execute("INSERT INTO attendance(status) VALUES (?)", (f"status-{index}",))
    connection.execute("INSERT INTO attendance_override_history(note) VALUES ('preserved')")
    connection.execute("INSERT INTO student_enrollments(student_id) VALUES (10)")
    connection.execute("INSERT INTO student_subject_grades(score) VALUES (91.5)")
    connection.commit()
    connection.close()


@pytest.fixture
def restore_context(tmp_path):
    live = tmp_path / "live.db"
    backups = tmp_path / "backups"
    _simple_db(live, 1)
    url = f"sqlite:///{live}"
    engine = create_engine(url)
    target = create_backup(database_url=url, backup_dir=str(backups), min_free_mb=0)
    connection = sqlite3.connect(live)
    connection.execute("INSERT INTO attendance(status) VALUES ('new-live-row')")
    connection.commit()
    connection.close()
    return {"live": live, "backups": backups, "url": url, "engine": engine, "target": target}


def _restore(context, **changes):
    target = context["target"]["filename"]
    return restore_backup(
        filename=changes.get("filename", target),
        confirmation=changes.get("confirmation", target),
        database_url=changes.get("database_url", context["url"]),
        backup_dir=str(context["backups"]),
        retention_count=changes.get("retention_count", 10),
        min_free_mb=0,
        destructive_enabled=changes.get("destructive_enabled", True),
        engine=context["engine"],
        current_schema_version=changes.get("current_schema_version", "unknown"),
        actor=changes.get("actor"),
        request_context=changes.get("request_context"),
        worker_count=changes.get("worker_count", 1),
        single_worker_required=changes.get("single_worker_required", True),
    )


def _metadata_path(context):
    return Path(str(context["backups"] / context["target"]["filename"]) + ".meta.json")


def test_restore_requires_destructive_flag_and_logs_refusal(restore_context):
    with pytest.raises(RestoreError, match="disabled"):
        _restore(restore_context, destructive_enabled=False)
    audit = (restore_context["backups"] / restore_service.AUDIT_FILENAME).read_text()
    assert '"event": "restore_denied"' in audit


@pytest.mark.parametrize("confirmation", [None, "true", "wrong.sqlite3"])
def test_restore_requires_exact_typed_filename(restore_context, confirmation):
    with pytest.raises(RestoreError, match="exactly match"):
        _restore(restore_context, confirmation=confirmation)


@pytest.mark.parametrize("filename", ["../backup.sqlite3", "/tmp/backup.sqlite3", "backup_%2e%2e.sqlite3"])
def test_restore_rejects_path_traversal(restore_context, filename):
    with pytest.raises(RestoreError, match="Invalid backup filename"):
        _restore(restore_context, filename=filename, confirmation=filename)


def test_missing_backup_and_metadata_are_rejected(restore_context):
    missing = "backup_2026-01-01T00-00-00Z.sqlite3"
    with pytest.raises(RestoreError, match="not found"):
        _restore(restore_context, filename=missing, confirmation=missing)
    _metadata_path(restore_context).unlink()
    with pytest.raises(RestoreError, match="metadata"):
        _restore(restore_context)


def test_checksum_mismatch_rejected_before_snapshot(restore_context):
    target = restore_context["backups"] / restore_context["target"]["filename"]
    target.write_bytes(target.read_bytes() + b"tampered")
    with pytest.raises(RestoreError, match="checksum"):
        _restore(restore_context)
    assert not list(restore_context["backups"].glob("*pre_restore*"))
    metadata = [json.loads(path.read_text()) for path in restore_context["backups"].glob("*.meta.json")]
    assert all(item["trigger"] == "manual" for item in metadata)


def test_integrity_and_required_table_failures_are_rejected(restore_context):
    target = restore_context["backups"] / restore_context["target"]["filename"]
    connection = sqlite3.connect(target)
    connection.execute("DROP TABLE attendance_override_history")
    connection.commit()
    connection.close()
    metadata_path = _metadata_path(restore_context)
    metadata = json.loads(metadata_path.read_text())
    metadata["sha256"] = calculate_sha256(target)
    metadata_path.write_text(json.dumps(metadata))
    with pytest.raises(RestoreError, match="missing required"):
        _restore(restore_context)


def test_corrupt_sqlite_is_rejected_as_integrity_failure(restore_context):
    target = restore_context["backups"] / restore_context["target"]["filename"]
    target.write_bytes(b"not a sqlite database")
    metadata_path = _metadata_path(restore_context)
    metadata = json.loads(metadata_path.read_text())
    metadata["sha256"] = calculate_sha256(target)
    metadata_path.write_text(json.dumps(metadata))
    with pytest.raises(RestoreError, match="integrity validation"):
        _restore(restore_context)


def test_schema_mismatch_rejected(restore_context):
    metadata_path = _metadata_path(restore_context)
    metadata = json.loads(metadata_path.read_text())
    metadata["schema_version"] = "known-v2"
    metadata_path.write_text(json.dumps(metadata))
    with pytest.raises(RestoreError, match="schema version"):
        _restore(restore_context)


def test_unknown_to_unknown_restore_preserves_protected_rows_and_creates_snapshot(restore_context):
    result = _restore(restore_context)
    assert result["success"] is True
    assert result["checksum_verified"] and result["schema_verified"] and result["integrity_verified"]
    assert result["pre_restore_snapshot_filename"]
    assert (restore_context["backups"] / result["pre_restore_snapshot_filename"]).exists()
    connection = sqlite3.connect(restore_context["live"])
    try:
        assert connection.execute("SELECT COUNT(*) FROM attendance").fetchone()[0] == 1
        assert connection.execute("SELECT note FROM attendance_override_history").fetchone()[0] == "preserved"
        assert connection.execute("SELECT score FROM student_subject_grades").fetchone()[0] == 91.5
    finally:
        connection.close()
    audit = (restore_context["backups"] / restore_service.AUDIT_FILENAME).read_text()
    assert '"event": "restore_completed"' in audit
    assert '"post_restore_verified": true' in audit


def test_restore_accepts_empty_protected_tables(tmp_path):
    live = tmp_path / "empty.db"
    backups = tmp_path / "backups"
    _simple_db(live, 0)
    url = f"sqlite:///{live}"
    engine = create_engine(url)
    target = create_backup(database_url=url, backup_dir=str(backups), min_free_mb=0)
    context = {"live": live, "backups": backups, "url": url, "engine": engine, "target": target}
    result = _restore(context)
    assert result["success"] is True
    engine.dispose()


def test_restore_waits_for_shared_database_operation_lock(restore_context):
    completed = threading.Event()
    errors = []

    def worker():
        try:
            _restore(restore_context)
        except Exception as exc:  # pragma: no cover - assertion reports captured failure
            errors.append(exc)
        finally:
            completed.set()

    with restore_service.BACKUP_OPERATION_LOCK:
        thread = threading.Thread(target=worker)
        thread.start()
        assert completed.wait(0.1) is False
    thread.join(timeout=10)
    assert completed.is_set() and not errors


def test_latest_safety_snapshot_survives_manual_retention(restore_context):
    result = _restore(restore_context, retention_count=1)
    safety = restore_context["backups"] / result["pre_restore_snapshot_filename"]
    assert safety.exists() and Path(str(safety) + ".meta.json").exists()


def test_engine_disposal_lifecycle_is_used(restore_context, monkeypatch):
    calls = 0
    original = restore_context["engine"].dispose
    def tracked_dispose(*args, **kwargs):
        nonlocal calls
        calls += 1
        return original(*args, **kwargs)
    monkeypatch.setattr(restore_context["engine"], "dispose", tracked_dispose)
    _restore(restore_context)
    assert calls >= 2


def test_atomic_replace_retries_transient_windows_file_handles(monkeypatch):
    class TransientSource:
        def __init__(self):
            self.calls = 0

        def replace(self, destination):
            self.calls += 1
            if self.calls < 3:
                raise PermissionError("transient Windows handle")
            return destination

    source = TransientSource()
    monkeypatch.setattr(restore_service.time, "sleep", lambda _delay: None)

    restore_service._replace_with_retry(source, Path("replacement"), attempts=3)

    assert source.calls == 3


def test_post_restore_failure_rolls_back_and_preserves_snapshot(restore_context, monkeypatch):
    original_live = sqlite3.connect(restore_context["live"]).execute("SELECT COUNT(*) FROM attendance").fetchone()[0]
    monkeypatch.setattr(restore_service, "verify_restored_database", lambda *args: (_ for _ in ()).throw(RestoreError("forced post failure")))
    with pytest.raises(RestoreError, match="forced post failure"):
        _restore(restore_context)
    connection = sqlite3.connect(restore_context["live"])
    try:
        assert connection.execute("SELECT COUNT(*) FROM attendance").fetchone()[0] == original_live
    finally:
        connection.close()
    metadata = [json.loads(path.read_text()) for path in restore_context["backups"].glob("*.meta.json")]
    assert any(item["trigger"] == "pre_restore_auto" for item in metadata)
    audit = (restore_context["backups"] / restore_service.AUDIT_FILENAME).read_text()
    assert '"event": "restore_failed"' in audit and '"event": "restore_rolled_back"' in audit


def test_audit_failure_blocks_before_replacement(restore_context, monkeypatch):
    before = restore_context["live"].read_bytes()
    monkeypatch.setattr(restore_service, "append_restore_audit", lambda *args: (_ for _ in ()).throw(RestoreError("audit failed")))
    with pytest.raises(RestoreError, match="audit failed"):
        _restore(restore_context)
    assert restore_context["live"].read_bytes() == before


def test_non_sqlite_restore_is_rejected_and_audited(restore_context):
    with pytest.raises(RestoreError, match="SQLite"):
        _restore(restore_context, database_url="postgresql://user:secret@localhost/school")


@pytest.mark.parametrize("table", ["users", "sessions"])
def test_restore_rejects_identity_incompatible_backup(restore_context, table):
    target = restore_context["backups"] / restore_context["target"]["filename"]
    with sqlite3.connect(target) as connection:
        connection.execute(f"DROP TABLE {table}")
    metadata_path = _metadata_path(restore_context)
    metadata = json.loads(metadata_path.read_text())
    metadata["sha256"] = calculate_sha256(target)
    metadata_path.write_text(json.dumps(metadata))
    with pytest.raises(RestoreError, match="identity schema"):
        _restore(restore_context)


def test_restore_rejects_backup_without_active_admin(restore_context):
    target = restore_context["backups"] / restore_context["target"]["filename"]
    with sqlite3.connect(target) as connection:
        connection.execute("UPDATE users SET is_active = 0")
    metadata_path = _metadata_path(restore_context)
    metadata = json.loads(metadata_path.read_text())
    metadata["sha256"] = calculate_sha256(target)
    metadata_path.write_text(json.dumps(metadata))
    with pytest.raises(RestoreError, match="active administrator"):
        _restore(restore_context)


def test_restore_revokes_restored_sessions_and_requires_reauthentication(restore_context):
    target = restore_context["backups"] / restore_context["target"]["filename"]
    with sqlite3.connect(target) as connection:
        connection.execute(
            "INSERT INTO sessions(user_id, token_hash, expires_at, absolute_expires_at) VALUES (1, ?, '2099-01-01', '2099-01-02')",
            ("a" * 64,),
        )
    metadata_path = _metadata_path(restore_context)
    metadata = json.loads(metadata_path.read_text())
    metadata["sha256"] = calculate_sha256(target)
    metadata_path.write_text(json.dumps(metadata))
    result = _restore(restore_context)
    assert result["reauthentication_required"] is True
    with sqlite3.connect(restore_context["live"]) as connection:
        assert connection.execute("SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL").fetchone()[0] == 0


def test_restore_fails_closed_for_multi_worker_and_busy_profiles(restore_context):
    with pytest.raises(RestoreError, match="single-worker"):
        _restore(restore_context, worker_count=2)
    assert restore_service.DESTRUCTIVE_OPERATION_LOCK.acquire(blocking=False)
    try:
        with pytest.raises(RestoreError, match="already active"):
            _restore(restore_context)
    finally:
        restore_service.DESTRUCTIVE_OPERATION_LOCK.release()


def test_restore_audit_attributes_verified_actor_without_sensitive_values(restore_context):
    actor = {"user_id": 7, "username": "verified-admin", "role": "admin", "session_digest": "safe-digest"}
    _restore(restore_context, actor=actor, request_context={"ip_address": "127.0.0.1"})
    audit = (restore_context["backups"] / restore_service.AUDIT_FILENAME).read_text()
    assert '"authenticated_user_id": 7' in audit and '"authenticated_username": "verified-admin"' in audit
    assert '"event": "restore_requested"' in audit and '"event": "restore_started"' in audit and '"event": "restore_completed"' in audit
    assert "raw-cookie" not in audit and "password_hash" not in audit


def _unload():
    for name in list(sys.modules):
        if name == "src" or name.startswith(("src.", "api.", "core.", "models.", "security.", "services.")):
            sys.modules.pop(name, None)


@pytest.fixture
def api_context(monkeypatch, tmp_path):
    _unload()
    database = tmp_path / "api.db"
    connection = sqlite3.connect(database)
    connection.execute("PRAGMA foreign_keys=ON")
    migration = Path(__file__).resolve().parents[1] / "migrations" / "20260713_identity_schema_sqlite.sql"
    connection.executescript(migration.read_text(encoding="utf-8"))
    connection.close()
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database}")
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path / "backups"))
    monkeypatch.setenv("BACKUP_MIN_FREE_MB", "0")
    monkeypatch.setenv("ENABLE_DESTRUCTIVE_OPERATIONS", "false")
    module = importlib.import_module("src.main")
    from core.database import SessionLocal
    from models.user import User
    from security.password import hash_password

    db = SessionLocal()
    db.add(User(username="backup-admin", password_hash=hash_password("backup admin passphrase"), role="admin"))
    db.commit()
    db.close()
    client = TestClient(module.app)
    login = client.post(
        "/api/auth/login",
        json={"username": "backup-admin", "password": "backup admin passphrase"},
    )
    assert login.status_code == 200
    yield client, tmp_path
    client.close()
    module.engine.dispose() if hasattr(module, "engine") else None
    _unload()


def test_status_list_and_create_endpoints_return_safe_canonical_values(api_context):
    client, tmp_path = api_context
    status = client.get("/api/admin/backups/status")
    assert status.status_code == 200
    assert status.json()["database_basename"] == "api.db"
    assert status.json()["authentication_available"] is True
    assert str(tmp_path) not in status.text
    assert client.get("/api/admin/backups").json() == []
    created = client.post("/api/admin/backups")
    assert created.status_code == 200
    listed = client.get("/api/admin/backups").json()
    assert len(listed) == 1 and listed[0]["filename"] == created.json()["filename"]
    assert client.get("/api/api/admin/backups").status_code == 404


def test_api_restore_disabled_and_boolean_confirmation_invalid(api_context):
    client, _ = api_context
    filename = client.post("/api/admin/backups").json()["filename"]
    assert client.post(f"/api/admin/backups/{filename}/restore", json={"confirmation": filename}).status_code == 403
    assert client.post(f"/api/admin/backups/{filename}/restore", json={"confirmation": True}).status_code == 422


def test_api_restore_suspends_and_restarts_scheduler_on_failure(api_context, monkeypatch):
    client, _ = api_context
    from api import backups as backups_api

    events = []
    monkeypatch.setattr(backups_api.backup_scheduler, "stop", lambda: events.append("stop"))
    monkeypatch.setattr(backups_api.backup_scheduler, "start", lambda: events.append("start"))
    filename = client.post("/api/admin/backups").json()["filename"]

    response = client.post(
        f"/api/admin/backups/{filename}/restore",
        json={"confirmation": filename},
    )

    assert response.status_code == 403
    assert events == ["stop", "start"]
