from __future__ import annotations

import copy
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine

from core.attendance_followup_migration import (
    S43_PREDECESSOR,
    S43_VERSION,
    migrate_attendance_followup_sqlite,
)
from core.schema_guard import (
    BASELINE_SCHEMA_VERSION,
    CURRENT_SCHEMA_TABLES,
    CURRENT_SCHEMA_VERSION,
    DatabaseStartupError,
    _validate_sqlite_file,
    validate_sqlite_startup,
)
from core.schema_migrations import (
    POST_BASELINE_MODEL_TABLES,
    bootstrap_fresh_sqlite_database,
    initialize_s42_baseline_sqlite_database,
    main as migration_main,
    migrate_database_to_current,
)
from core.schema_parity import (
    load_migration_manifest,
    orm_schema_snapshot,
    schema_diff,
    sqlite_schema_snapshot,
    validate_migration_manifest,
)


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "backend/migrations/migration_manifest.json"
PROTECTED = ROOT / "backend/attendance.db"


def head(path: Path) -> str:
    with sqlite3.connect(
        f"file:{path.as_posix()}?mode=ro&immutable=1", uri=True
    ) as connection:
        return connection.execute(
            "SELECT version FROM operatoros_schema_migrations "
            "ORDER BY applied_at DESC, version DESC LIMIT 1"
        ).fetchone()[0]


def tables(path: Path) -> set[str]:
    with sqlite3.connect(
        f"file:{path.as_posix()}?mode=ro&immutable=1", uri=True
    ) as connection:
        return {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }


def test_schema_heads_are_explicit_and_distinct():
    assert BASELINE_SCHEMA_VERSION == S43_PREDECESSOR == "20260724_s42"
    assert CURRENT_SCHEMA_VERSION == S43_VERSION == "20260725_s43"
    assert BASELINE_SCHEMA_VERSION != CURRENT_SCHEMA_VERSION


def test_s42_baseline_excludes_every_classified_s43_table(tmp_path):
    target = (tmp_path / "baseline.db").resolve()
    assert not target.exists()
    assert initialize_s42_baseline_sqlite_database(target) == "MIGRATION_COMPLETE"
    assert head(target) == BASELINE_SCHEMA_VERSION
    assert POST_BASELINE_MODEL_TABLES == CURRENT_SCHEMA_TABLES
    assert not (tables(target) & CURRENT_SCHEMA_TABLES)
    with sqlite3.connect(target) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_registered_s43_migrates_baseline_and_is_idempotent(tmp_path):
    target = (tmp_path / "migrated.db").resolve()
    initialize_s42_baseline_sqlite_database(target)
    assert migrate_database_to_current(target) == "MIGRATION_COMPLETE"
    assert migrate_database_to_current(target) == "MIGRATION_ALREADY_CURRENT"
    assert head(target) == CURRENT_SCHEMA_VERSION
    assert CURRENT_SCHEMA_TABLES.issubset(tables(target))
    with sqlite3.connect(target) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM operatoros_schema_migrations WHERE version=?",
            (S43_VERSION,),
        ).fetchone() == (1,)


def test_manifest_chain_is_unique_ordered_reachable_and_current():
    manifest = load_migration_manifest(MANIFEST)
    pairs = validate_migration_manifest(manifest)
    assert pairs[-1] == (S43_PREDECESSOR, S43_VERSION)
    assert manifest["baseline_schema"] == BASELINE_SCHEMA_VERSION
    assert manifest["current_schema"] == CURRENT_SCHEMA_VERSION
    assert sum(item.get("resulting_schema") == S43_VERSION for item in manifest["migrations"]) == 2
    assert sum(item.get("id") == "20260724_s42_to_20260725_s43" for item in manifest["migrations"]) == 1


def test_manifest_negative_cases_detect_registration_defects():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    missing = copy.deepcopy(manifest)
    missing["migrations"] = [
        item for item in missing["migrations"]
        if item.get("id") != "20260724_s42_to_20260725_s43"
    ]
    with pytest.raises(RuntimeError, match="HEAD_MISMATCH"):
        validate_migration_manifest(missing)
    duplicate = copy.deepcopy(manifest)
    duplicate["migrations"].append(copy.deepcopy(duplicate["migrations"][-1]))
    with pytest.raises(RuntimeError, match="DUPLICATE"):
        validate_migration_manifest(duplicate)
    ordered = copy.deepcopy(manifest)
    ordered["migrations"][-1]["predecessor"] = CURRENT_SCHEMA_VERSION
    with pytest.raises(RuntimeError, match="ORDER_INVALID"):
        validate_migration_manifest(ordered)


def test_cli_exposes_s43_upgrade(tmp_path):
    target = (tmp_path / "cli.db").resolve()
    initialize_s42_baseline_sqlite_database(target)
    assert migration_main(["upgrade-s43", "--database", str(target)]) == 0
    assert head(target) == CURRENT_SCHEMA_VERSION


def test_fresh_bootstrap_equals_baseline_plus_migration(tmp_path):
    migrated = (tmp_path / "migrated.db").resolve()
    bootstrap = (tmp_path / "bootstrap.db").resolve()
    initialize_s42_baseline_sqlite_database(migrated)
    migrate_database_to_current(migrated)
    bootstrap_fresh_sqlite_database(bootstrap)
    assert sqlite_schema_snapshot(migrated) == sqlite_schema_snapshot(bootstrap)


def test_current_orm_matches_fresh_database_with_one_explicit_database_index(tmp_path):
    target = (tmp_path / "fresh.db").resolve()
    bootstrap_fresh_sqlite_database(target)
    database = sqlite_schema_snapshot(target)
    orm = orm_schema_snapshot()
    database["tables"].pop("operatoros_schema_migrations")
    attendance_indexes = database["tables"]["attendance"]["indexes"]
    intentional = [
        item for item in attendance_indexes if item["name"] == "idx_attendance_student_date"
    ]
    assert len(intentional) == 1
    database["tables"]["attendance"]["indexes"] = [
        item for item in attendance_indexes if item["name"] != "idx_attendance_student_date"
    ]
    assert schema_diff(orm, database) == []


def test_missing_model_registration_and_schema_objects_are_detected(tmp_path):
    target = (tmp_path / "fresh.db").resolve()
    bootstrap_fresh_sqlite_database(target)
    database = sqlite_schema_snapshot(target)
    database["tables"].pop("operatoros_schema_migrations")
    database["tables"]["attendance"]["indexes"] = [
        item for item in database["tables"]["attendance"]["indexes"]
        if item["name"] != "idx_attendance_student_date"
    ]
    missing_model = orm_schema_snapshot()
    missing_model["tables"].pop("attendance_follow_ups")
    assert "extra table: attendance_follow_ups" in schema_diff(missing_model, database)
    missing_column = copy.deepcopy(database)
    missing_column["tables"]["attendance_follow_ups"]["columns"].pop()
    assert "columns mismatch: attendance_follow_ups" in schema_diff(orm_schema_snapshot(), missing_column)


def test_existing_s42_is_rejected_without_automatic_migration(tmp_path):
    target = (tmp_path / "s42.db").resolve()
    initialize_s42_baseline_sqlite_database(target)
    before = sqlite_schema_snapshot(target)
    with pytest.raises(DatabaseStartupError, match="20260724_s42 -> 20260725_s43"):
        validate_sqlite_startup(
            f"sqlite:///{target}", create_engine(f"sqlite:///{target}")
        )
    assert sqlite_schema_snapshot(target) == before


def test_s42_ledger_with_hidden_s43_tables_is_rejected(tmp_path):
    target = (tmp_path / "hidden.db").resolve()
    initialize_s42_baseline_sqlite_database(target)
    from core.database import Base

    engine = create_engine(f"sqlite:///{target}")
    Base.metadata.create_all(
        engine,
        tables=[Base.metadata.tables[name] for name in sorted(CURRENT_SCHEMA_TABLES)],
    )
    engine.dispose()
    with pytest.raises(DatabaseStartupError, match="MIGRATION_REQUIRED"):
        _validate_sqlite_file(target)


def test_s43_with_missing_object_is_rejected(tmp_path):
    target = (tmp_path / "missing.db").resolve()
    bootstrap_fresh_sqlite_database(target)
    with sqlite3.connect(target) as connection:
        connection.execute("DROP TABLE attendance_follow_up_notes")
    with pytest.raises(DatabaseStartupError, match="S4.3 tables missing"):
        _validate_sqlite_file(target)


def test_current_startup_and_second_start_are_idempotent(tmp_path):
    target = (tmp_path / "current.db").resolve()
    bootstrap_fresh_sqlite_database(target)
    before = sqlite_schema_snapshot(target)
    validate_sqlite_startup(
        f"sqlite:///{target}", create_engine(f"sqlite:///{target}")
    )
    validate_sqlite_startup(
        f"sqlite:///{target}", create_engine(f"sqlite:///{target}")
    )
    assert sqlite_schema_snapshot(target) == before


def test_application_import_bootstraps_absent_database_and_serves_smoke(tmp_path):
    target = (tmp_path / "application-smoke.db").resolve()
    assert not target.exists()
    environment = os.environ.copy()
    environment.update({
        "DATABASE_URL": f"sqlite:///{target}",
        "PYTHONPATH": str(ROOT / "backend/src"),
        "OPERATOROS_ISOLATED_TEST": "true",
        "AUTH_COOKIE_SECRET": "fresh-smoke-test-only-secret-32-chars",
        "ALLOW_LEGACY_STARTUP_SCHEMA_MUTATION": "false",
    })
    script = """
from fastapi.testclient import TestClient
from main import app
with TestClient(app) as client:
    assert client.get('/health').json()['status'] == 'ok'
    status = client.get('/api/setup/status')
    assert status.status_code == 200
    assert status.json()['setup_required'] is True
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert head(target) == CURRENT_SCHEMA_VERSION
    assert not any(
        Path(str(target) + suffix).exists()
        for suffix in ("-wal", "-shm", "-journal")
    )


def test_protected_path_is_rejected_and_checksum_is_immutable():
    if not PROTECTED.exists():
        assert not any(
            Path(str(PROTECTED) + suffix).exists()
            for suffix in ("-wal", "-shm", "-journal")
        )
        return
    before = hashlib.sha256(PROTECTED.read_bytes()).hexdigest()
    assert head(PROTECTED) == CURRENT_SCHEMA_VERSION
    with pytest.raises(RuntimeError, match="PROTECTED_DATABASE_PATH_REJECTED"):
        migrate_attendance_followup_sqlite(PROTECTED)
    assert hashlib.sha256(PROTECTED.read_bytes()).hexdigest() == before
    assert not any(
        Path(str(PROTECTED) + suffix).exists()
        for suffix in ("-wal", "-shm", "-journal")
    )
