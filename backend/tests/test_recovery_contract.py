from __future__ import annotations

import json
import os
import sqlite3
from collections import namedtuple
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import ValidationError

from core.config import Settings, settings
from services.backup_service import (
    DESTRUCTIVE_OPERATION_LOCK,
    calculate_sha256,
    create_backup,
)
from services.backup_scheduler import EXECUTION_LOCK
from services.recovery_contract import (
    HEALTH_STATES,
    IMPACT_CLASSIFICATIONS,
    RecoveryContractError,
    classify_impact,
    derive_backup_health,
    read_sanitized_history,
    restore_preflight,
)


SCHEMA_VERSION = "20260724_s42"
DiskUsage = namedtuple("DiskUsage", "total used free")


def _seed_db(
    path: Path,
    *,
    students: int = 4,
    attendance: int = 6,
    enrollments: int = 2,
    schema: str = SCHEMA_VERSION,
    active_admin: bool = True,
    foreign_key_violation: bool = False,
) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        PRAGMA foreign_keys=OFF;
        CREATE TABLE students (
            id INTEGER PRIMARY KEY,
            name TEXT,
            class_name TEXT
        );
        CREATE TABLE attendance (
            id INTEGER PRIMARY KEY,
            student_id INTEGER REFERENCES students(id),
            status TEXT
        );
        CREATE TABLE attendance_override_history (
            id INTEGER PRIMARY KEY,
            note TEXT
        );
        CREATE TABLE student_enrollments (
            id INTEGER PRIMARY KEY,
            student_id INTEGER REFERENCES students(id)
        );
        CREATE TABLE student_subject_grades (
            id INTEGER PRIMARY KEY,
            score REAL
        );
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT,
            password_hash TEXT,
            role TEXT,
            is_active INTEGER,
            failed_login_attempts INTEGER DEFAULT 0,
            locked_until TEXT
        );
        CREATE TABLE sessions (
            id INTEGER PRIMARY KEY,
            user_id INTEGER,
            token_hash TEXT,
            created_at TEXT,
            last_used_at TEXT,
            expires_at TEXT,
            absolute_expires_at TEXT,
            revoked_at TEXT
        );
        CREATE TABLE operatoros_schema_migrations (
            version TEXT,
            applied_at TEXT
        );
        """
    )
    connection.execute(
        "INSERT INTO users(username,password_hash,role,is_active) VALUES (?,?,?,?)",
        ("synthetic-admin", "test-hash", "admin", int(active_admin)),
    )
    connection.executemany(
        "INSERT INTO students(id,name,class_name) VALUES (?,?,?)",
        ((index, f"Synthetic {index}", "A") for index in range(1, students + 1)),
    )
    connection.executemany(
        "INSERT INTO attendance(id,student_id,status) VALUES (?,?,?)",
        (
            (
                index,
                999999 if foreign_key_violation and index == 1 else 1,
                "present",
            )
            for index in range(1, attendance + 1)
        ),
    )
    connection.executemany(
        "INSERT INTO student_enrollments(id,student_id) VALUES (?,?)",
        ((index, min(index, students)) for index in range(1, enrollments + 1)),
    )
    connection.execute(
        "INSERT INTO attendance_override_history(note) VALUES ('synthetic')"
    )
    connection.execute("INSERT INTO student_subject_grades(score) VALUES (90)")
    connection.execute(
        "INSERT INTO operatoros_schema_migrations(version,applied_at) VALUES (?,?)",
        (schema, "2026-07-24T00:00:00Z"),
    )
    connection.commit()
    connection.close()


def _backup(
    tmp_path: Path,
    *,
    active_counts: tuple[int, int, int] = (4, 6, 2),
    source_counts: tuple[int, int, int] | None = None,
    schema: str = SCHEMA_VERSION,
    active_admin: bool = True,
    foreign_key_violation: bool = False,
) -> tuple[Path, Path, str]:
    active = tmp_path / "synthetic-active.sqlite3"
    backup_dir = tmp_path / "synthetic-backups"
    _seed_db(
        active,
        students=active_counts[0],
        attendance=active_counts[1],
        enrollments=active_counts[2],
    )
    source = active
    if source_counts is not None:
        source = tmp_path / "synthetic-source.sqlite3"
        _seed_db(
            source,
            students=source_counts[0],
            attendance=source_counts[1],
            enrollments=source_counts[2],
            schema=schema,
            active_admin=active_admin,
            foreign_key_violation=foreign_key_violation,
        )
    result = create_backup(
        database_url=f"sqlite:///{source}",
        backup_dir=str(backup_dir),
        min_free_mb=0,
    )
    filename = result["filename"]
    manifest_path = Path(f"{backup_dir / filename}.meta.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["schema_version"] = schema
    manifest["filename"] = filename
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    return active, backup_dir, filename


def _health(
    monkeypatch: pytest.MonkeyPatch,
    active: Path,
    backup_dir: Path,
    *,
    now: datetime | None = None,
    free: int = 10**12,
):
    monkeypatch.setattr(settings, "BACKUP_HEALTH_AGING_HOURS", 24)
    monkeypatch.setattr(settings, "BACKUP_HEALTH_STALE_HOURS", 72)
    monkeypatch.setattr(settings, "BACKUP_LOW_SPACE_MULTIPLIER", 2.0)
    return derive_backup_health(
        database_url=f"sqlite:///{active}",
        backup_dir=str(backup_dir),
        now=now,
        disk_usage=lambda _path: DiskUsage(10**12, 0, free),
    )


def _set_created_at(backup_dir: Path, filename: str, created_at: datetime) -> None:
    path = Path(f"{backup_dir / filename}.meta.json")
    metadata = json.loads(path.read_text(encoding="utf-8"))
    metadata["created_at"] = created_at.isoformat().replace("+00:00", "Z")
    path.write_text(json.dumps(metadata), encoding="utf-8")


@pytest.mark.parametrize(
    ("hours", "expected"),
    [(0, "HEALTHY"), (24, "AGING"), (72, "STALE"), (120, "STALE")],
)
def test_health_age_states_and_boundaries(monkeypatch, tmp_path, hours, expected):
    active, backup_dir, filename = _backup(tmp_path)
    now = datetime(2026, 7, 26, 12, tzinfo=UTC)
    _set_created_at(backup_dir, filename, now - timedelta(hours=hours))
    payload = _health(monkeypatch, active, backup_dir, now=now)
    assert payload["health_state"] == expected
    assert payload["generated_at_utc"].endswith("Z")
    assert payload["backup_directory_display"] == backup_dir.name
    assert str(tmp_path) not in json.dumps(payload)


def test_health_no_backup_and_destination_unavailable(monkeypatch, tmp_path):
    active = tmp_path / "synthetic-active.sqlite3"
    _seed_db(active)
    missing = tmp_path / "backups"
    assert _health(monkeypatch, active, missing)["health_state"] == "NO_BACKUP"
    destination_file = tmp_path / "not-a-directory"
    destination_file.write_text("synthetic", encoding="ascii")
    payload = _health(monkeypatch, active, destination_file)
    assert payload["health_state"] == "DESTINATION_UNAVAILABLE"
    assert payload["backup_directory_available"] is False


def test_health_corrupt_and_missing_manifest(monkeypatch, tmp_path):
    active, backup_dir, filename = _backup(tmp_path)
    target = backup_dir / filename
    target.write_bytes(b"not sqlite")
    assert _health(monkeypatch, active, backup_dir)["health_state"] == "LAST_BACKUP_FAILED"
    target.unlink()
    _seed_db(target)
    Path(f"{target}.meta.json").unlink()
    assert _health(monkeypatch, active, backup_dir)["health_state"] == "LAST_BACKUP_FAILED"


def test_health_low_space_unknown_and_declared_states(monkeypatch, tmp_path):
    active, backup_dir, _ = _backup(tmp_path)
    assert _health(monkeypatch, active, backup_dir, free=0)["health_state"] == "LOW_DISK_SPACE"
    unknown = derive_backup_health(
        database_url="postgresql://invalid",
        backup_dir=str(backup_dir),
    )
    assert unknown["health_state"] == "UNKNOWN"
    assert set(HEALTH_STATES) == {
        "HEALTHY", "AGING", "STALE", "NO_BACKUP", "LAST_BACKUP_FAILED",
        "DESTINATION_UNAVAILABLE", "LOW_DISK_SPACE", "BACKUP_IN_PROGRESS",
        "RESTORE_IN_PROGRESS", "UNKNOWN",
    }


def test_active_operation_health_precedence(monkeypatch, tmp_path):
    active, backup_dir, _ = _backup(tmp_path)
    EXECUTION_LOCK.acquire()
    try:
        assert _health(monkeypatch, active, backup_dir)["health_state"] == "BACKUP_IN_PROGRESS"
    finally:
        EXECUTION_LOCK.release()
    DESTRUCTIVE_OPERATION_LOCK.acquire()
    try:
        assert _health(monkeypatch, active, backup_dir)["health_state"] == "RESTORE_IN_PROGRESS"
    finally:
        DESTRUCTIVE_OPERATION_LOCK.release()


def test_threshold_configuration_rejection(monkeypatch):
    with pytest.raises(ValidationError):
        Settings(BACKUP_HEALTH_AGING_HOURS=-1)
    with pytest.raises(ValidationError):
        Settings(BACKUP_HEALTH_AGING_HOURS=24, BACKUP_HEALTH_STALE_HOURS=24)
    monkeypatch.setattr(settings, "BACKUP_LOW_SPACE_MULTIPLIER", -1)
    with pytest.raises(RecoveryContractError, match="threshold"):
        derive_backup_health(database_url="sqlite:///synthetic.db", backup_dir="backups")


@pytest.mark.parametrize(
    "filename",
    [
        "/tmp/backup_2026-01-01T00-00-00Z.sqlite3",
        "../backup_2026-01-01T00-00-00Z.sqlite3",
        "backup_2026-01-01T00-00-00Z.csv",
        "backup_2026-01-01T00-00-00Z.zip",
        "backup_%2e%2e.sqlite3",
    ],
)
def test_preflight_rejects_arbitrary_sources(tmp_path, filename):
    active = tmp_path / "synthetic-active.sqlite3"
    _seed_db(active)
    with pytest.raises(RecoveryContractError, match="filename"):
        restore_preflight(
            filename=filename,
            database_url=f"sqlite:///{active}",
            backup_dir=str(tmp_path / "backups"),
        )


def test_preflight_rejects_symlink_and_missing_source(tmp_path):
    active, backup_dir, filename = _backup(tmp_path)
    missing = "backup_2026-01-01T00-00-00Z.sqlite3"
    with pytest.raises(RecoveryContractError) as exc:
        restore_preflight(
            filename=missing,
            database_url=f"sqlite:///{active}",
            backup_dir=str(backup_dir),
        )
    assert exc.value.reason == "source_missing"
    link_name = "backup_2026-01-01T00-00-01Z.sqlite3"
    (backup_dir / link_name).symlink_to(backup_dir / filename)
    Path(f"{backup_dir / link_name}.meta.json").symlink_to(
        Path(f"{backup_dir / filename}.meta.json")
    )
    with pytest.raises(RecoveryContractError) as exc:
        restore_preflight(
            filename=link_name,
            database_url=f"sqlite:///{active}",
            backup_dir=str(backup_dir),
        )
    assert exc.value.reason == "symlink_rejected"


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        ("missing", "manifest_missing"),
        ("filename", "manifest_filename_mismatch"),
        ("checksum", None),
    ],
)
def test_preflight_manifest_failures(tmp_path, mutation, reason):
    active, backup_dir, filename = _backup(tmp_path, source_counts=(5, 7, 2))
    manifest_path = Path(f"{backup_dir / filename}.meta.json")
    metadata = json.loads(manifest_path.read_text(encoding="utf-8"))
    if mutation == "missing":
        manifest_path.unlink()
        with pytest.raises(RecoveryContractError) as exc:
            restore_preflight(
                filename=filename,
                database_url=f"sqlite:///{active}",
                backup_dir=str(backup_dir),
            )
        assert exc.value.reason == reason
        return
    if mutation == "filename":
        metadata["filename"] = "backup_2026-01-01T00-00-00Z.sqlite3"
    else:
        metadata["sha256"] = "0" * 64
    manifest_path.write_text(json.dumps(metadata), encoding="utf-8")
    if reason:
        with pytest.raises(RecoveryContractError) as exc:
            restore_preflight(
                filename=filename,
                database_url=f"sqlite:///{active}",
                backup_dir=str(backup_dir),
            )
        assert exc.value.reason == reason
    else:
        payload = restore_preflight(
            filename=filename,
            database_url=f"sqlite:///{active}",
            backup_dir=str(backup_dir),
        )
        assert payload["impact_classification"] == "INVALID_BACKUP"
        assert payload["source"]["restore_eligible"] is False


def test_preflight_malformed_sqlite(tmp_path):
    active, backup_dir, filename = _backup(tmp_path, source_counts=(5, 7, 2))
    target = backup_dir / filename
    target.write_bytes(b"malformed sqlite")
    manifest_path = Path(f"{target}.meta.json")
    metadata = json.loads(manifest_path.read_text(encoding="utf-8"))
    metadata["sha256"] = calculate_sha256(target)
    manifest_path.write_text(json.dumps(metadata), encoding="utf-8")
    payload = restore_preflight(
        filename=filename,
        database_url=f"sqlite:///{active}",
        backup_dir=str(backup_dir),
    )
    assert payload["impact_classification"] == "INVALID_BACKUP"
    assert "integrity_failed" in payload["source"]["blocking_reasons"]


@pytest.mark.parametrize(
    ("source_counts", "schema", "admin", "fk", "classification"),
    [
        ((5, 7, 3), SCHEMA_VERSION, True, False, "DATA_INCREASE"),
        ((3, 5, 2), SCHEMA_VERSION, True, False, "HIGH_RISK"),
        ((4, 5, 2), SCHEMA_VERSION, True, False, "DATA_REDUCTION"),
        ((4, 6, 2), "20260724_s41", True, False, "SCHEMA_INCOMPATIBLE"),
        ((4, 6, 3), SCHEMA_VERSION, False, False, "SCHEMA_INCOMPATIBLE"),
        ((5, 7, 3), SCHEMA_VERSION, True, True, "INVALID_BACKUP"),
    ],
)
def test_preflight_comparison_classification(
    tmp_path, source_counts, schema, admin, fk, classification
):
    active, backup_dir, filename = _backup(
        tmp_path,
        source_counts=source_counts,
        schema=schema,
        active_admin=admin,
        foreign_key_violation=fk,
    )
    payload = restore_preflight(
        filename=filename,
        database_url=f"sqlite:///{active}",
        backup_dir=str(backup_dir),
    )
    assert payload["impact_classification"] == classification
    encoded = json.dumps(payload)
    assert "Synthetic " not in encoded
    assert str(tmp_path) not in encoded
    assert "password" not in encoded.lower()


def test_preflight_identical_source_is_blocked(tmp_path):
    active, backup_dir, filename = _backup(tmp_path)
    target = backup_dir / filename
    target.write_bytes(active.read_bytes())
    manifest_path = Path(f"{target}.meta.json")
    metadata = json.loads(manifest_path.read_text(encoding="utf-8"))
    metadata["sha256"] = calculate_sha256(target)
    metadata["sqlite_file_size_bytes"] = target.stat().st_size
    manifest_path.write_text(json.dumps(metadata), encoding="utf-8")
    payload = restore_preflight(
        filename=filename,
        database_url=f"sqlite:///{active}",
        backup_dir=str(backup_dir),
    )
    assert payload["impact_classification"] == "NO_CHANGE"
    assert payload["source"]["restore_eligible"] is False


def test_preflight_is_strictly_read_only(tmp_path):
    active, backup_dir, filename = _backup(tmp_path, source_counts=(5, 7, 3))
    target = backup_dir / filename
    before_active = calculate_sha256(active)
    before_source = calculate_sha256(target)
    before_files = sorted(path.name for path in tmp_path.rglob("*") if path.is_file())
    payload = restore_preflight(
        filename=filename,
        database_url=f"sqlite:///{active}",
        backup_dir=str(backup_dir),
    )
    after_files = sorted(path.name for path in tmp_path.rglob("*") if path.is_file())
    assert payload["source"]["restore_eligible"] is True
    assert calculate_sha256(active) == before_active
    assert calculate_sha256(target) == before_source
    assert after_files == before_files
    assert not list(tmp_path.rglob("*candidate*"))
    assert not list(tmp_path.rglob("*rollback*"))
    assert not (backup_dir / "backup_restore_audit.jsonl").exists()


def test_all_impact_classifications_declared():
    assert set(IMPACT_CLASSIFICATIONS) == {
        "NO_CHANGE", "LOW_IMPACT", "DATA_REDUCTION", "DATA_INCREASE",
        "HIGH_RISK", "SCHEMA_INCOMPATIBLE", "INVALID_BACKUP", "UNKNOWN",
    }
    common = {
        "same_checksum": False,
        "checksum_matches": True,
        "integrity_status": "ok",
        "quick_status": "ok",
        "fk_violations": 0,
        "source_schema": SCHEMA_VERSION,
        "active_schema": SCHEMA_VERSION,
        "source_is_older": False,
        "possible_data_loss": False,
        "count_delta": {
            "student_delta": 0,
            "attendance_delta": 0,
            "enrollment_delta": 0,
        },
        "identity_compatible": True,
    }
    assert classify_impact(**common) == "LOW_IMPACT"
    assert classify_impact(**{**common, "same_checksum": True}) == "NO_CHANGE"


def test_sanitized_history_and_malformed_legacy_lines(tmp_path):
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    filename = "backup_2026-07-26T00-00-00Z.sqlite3"
    audit = backup_dir / "backup_restore_audit.jsonl"
    unsafe = {
        "timestamp": "2026-07-26T00:00:00Z",
        "event": "restore_completed",
        "target_filename": filename,
        "outcome": "completed",
        "reason": "completed",
        "pre_restore_snapshot_filename": filename,
        "authenticated_username": "operator",
        "password": "never-return-this",
        "confirmation": "CLEAR_ALL_ATTENDANCE_DATA",
        "path": "/secret/absolute/path",
        "exception": "traceback",
        "environment": {"SECRET": "value"},
        "metadata": {"arbitrary": "blob"},
        "request_context": {
            "operation_id": "op-1",
            "raw_exception": "secret",
        },
    }
    audit.write_text(
        "{malformed\n"
        + json.dumps({"event": "legacy", "target_filename": "../unsafe"})
        + "\n"
        + json.dumps(unsafe)
        + "\n",
        encoding="utf-8",
    )
    history = read_sanitized_history(backup_dir=str(backup_dir))
    assert len(history) == 2
    assert history[-1]["operation_reference_id"] == "op-1"
    assert history[0]["filename"] is None
    encoded = json.dumps(history)
    for forbidden in (
        "never-return-this",
        "CLEAR_ALL_ATTENDANCE_DATA",
        "/secret/absolute/path",
        "traceback",
        "SECRET",
        "arbitrary",
        "raw_exception",
    ):
        assert forbidden not in encoded


def test_api_route_compatibility_and_authorization_contract():
    from api.backups import (
        backup_history,
        backup_status,
        post_backup,
        post_restore,
        post_restore_preflight,
        recovery_history,
    )
    from main import app

    routes = {(route.path, method) for route in app.routes for method in route.methods or []}
    assert ("/api/admin/backups/status", "GET") in routes
    assert ("/api/admin/backups", "GET") in routes
    assert ("/api/admin/backups", "POST") in routes
    assert ("/api/admin/backups/{filename}/restore", "POST") in routes
    assert ("/api/admin/backups/{filename}/restore-preflight", "POST") in routes
    assert ("/api/admin/backups/history", "GET") in routes
    assert ("/api/admin/backups/recovery-history", "GET") in routes
    for endpoint in (
        backup_status,
        post_backup,
        backup_history,
        recovery_history,
        post_restore_preflight,
        post_restore,
    ):
        assert endpoint is not None
    assert not any(path.startswith("/api/api/") for path, _method in routes)


def test_test_isolation_never_targets_protected_database(tmp_path):
    protected = (
        Path(__file__).resolve().parents[1] / "attendance.db"
    ).resolve()
    active, backup_dir, _ = _backup(tmp_path)
    assert active.resolve() != protected
    assert protected not in active.parents
    assert str(active).startswith("/tmp/")
    assert str(backup_dir).startswith("/tmp/")
    assert os.environ["OPERATOROS_ISOLATED_TEST"] == "true"
