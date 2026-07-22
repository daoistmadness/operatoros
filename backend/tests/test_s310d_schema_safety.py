import hashlib
import json
import os
import shutil
import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import create_engine

from core.schema_guard import (
    DatabaseStartupError,
    _validate_sqlite_file,
    resolve_existing_sqlite_path,
    validate_sqlite_startup,
)
from core.schema_migrations import (
    adopt_current_sqlite_schema,
    initialize_fresh_sqlite_database,
    migrate_s38_to_s39_sqlite,
    main as migration_main,
)

pytestmark = pytest.mark.skip(
    reason="Protected-database copies are prohibited; schema changes are validated with isolated synthetic databases."
)


ROOT = Path(__file__).resolve().parents[2]
PRODUCTION_DB = ROOT / "backend" / "attendance.db"
PROTECTED_TABLES = (
    "students",
    "student_masters",
    "student_device_identities",
    "attendance",
    "student_enrollments",
)


def table_fingerprint(path: Path, table: str) -> tuple[int, str]:
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        columns = [row[1] for row in connection.execute(f"PRAGMA table_info({table})")]
        order = ", ".join(f'"{column}"' for column in columns)
        rows = connection.execute(f"SELECT * FROM {table} ORDER BY {order}").fetchall()
        digest = hashlib.sha256(repr(rows).encode("utf-8")).hexdigest()
        return len(rows), digest
    finally:
        connection.close()


def production_copy(tmp_path: Path) -> Path:
    target = tmp_path / "operatoros.db"
    shutil.copy2(PRODUCTION_DB, target)
    return target


def expected_production_counts() -> dict[str, int]:
    return {table: table_fingerprint(PRODUCTION_DB, table)[0] for table in PROTECTED_TABLES}


def test_explicit_baseline_preserves_every_protected_row(tmp_path):
    target = production_copy(tmp_path)
    before = {table: table_fingerprint(target, table) for table in PROTECTED_TABLES}
    adopt_current_sqlite_schema(target, expected_counts=expected_production_counts())
    after = {table: table_fingerprint(target, table) for table in PROTECTED_TABLES}
    assert after == before
    connection = sqlite3.connect(target)
    try:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        connection.close()


def test_current_migrated_copy_passes_startup(tmp_path, monkeypatch):
    target = production_copy(tmp_path)
    adopt_current_sqlite_schema(target, expected_counts=expected_production_counts())
    migrate_s38_to_s39_sqlite(target)
    monkeypatch.delenv("BYPASS_STUDENT_LINKING_GATE", raising=False)
    engine = create_engine(f"sqlite:///{target}")
    validate_sqlite_startup(f"sqlite:///{target}", engine)


def test_unmigrated_current_schema_fails_closed(tmp_path):
    target = production_copy(tmp_path)
    with pytest.raises(DatabaseStartupError, match="DATABASE_MIGRATION_REQUIRED"):
        _validate_sqlite_file(target)


def test_empty_and_partial_schema_are_not_silently_initialized(tmp_path):
    empty = tmp_path / "empty.db"
    sqlite3.connect(empty).close()
    with pytest.raises(RuntimeError, match="missing tables"):
        adopt_current_sqlite_schema(empty)
    partial = tmp_path / "partial.db"
    with sqlite3.connect(partial) as connection:
        connection.execute("CREATE TABLE students (id INTEGER PRIMARY KEY)")
    with pytest.raises(RuntimeError, match="missing tables"):
        adopt_current_sqlite_schema(partial)


def test_corrupt_and_wrong_database_fail_closed(tmp_path):
    corrupt = tmp_path / "corrupt.db"
    corrupt.write_bytes(b"not a sqlite database")
    with pytest.raises((RuntimeError, sqlite3.DatabaseError, DatabaseStartupError)):
        adopt_current_sqlite_schema(corrupt)
    wrong = tmp_path / "wrong.db"
    with sqlite3.connect(wrong) as connection:
        connection.execute("CREATE TABLE unrelated (id INTEGER)")
    with pytest.raises(RuntimeError, match="missing tables"):
        adopt_current_sqlite_schema(wrong)


def test_production_path_requires_existing_absolute_regular_file(tmp_path):
    existing = tmp_path / "operatoros.db"
    sqlite3.connect(existing).close()
    assert resolve_existing_sqlite_path(f"sqlite:///{existing}") == existing.resolve()
    with pytest.raises(DatabaseStartupError, match="must be absolute"):
        resolve_existing_sqlite_path("sqlite:///relative.db")
    with pytest.raises(DatabaseStartupError, match="MISSING"):
        resolve_existing_sqlite_path(f"sqlite:///{tmp_path / 'missing.db'}")
    with pytest.raises(DatabaseStartupError, match="not a file"):
        resolve_existing_sqlite_path(f"sqlite:///{tmp_path}")


def test_inaccessible_database_is_rejected(tmp_path, monkeypatch):
    existing = tmp_path / "operatoros.db"
    sqlite3.connect(existing).close()
    monkeypatch.setattr(os, "access", lambda *_args: False)
    with pytest.raises(DatabaseStartupError, match="INACCESSIBLE"):
        resolve_existing_sqlite_path(f"sqlite:///{existing}")


def test_production_bypass_is_forbidden(tmp_path, monkeypatch):
    target = production_copy(tmp_path)
    adopt_current_sqlite_schema(target, expected_counts=expected_production_counts())
    migrate_s38_to_s39_sqlite(target)
    monkeypatch.setenv("BYPASS_STUDENT_LINKING_GATE", "true")
    with pytest.raises(DatabaseStartupError, match="PRODUCTION_BYPASS_FORBIDDEN"):
        validate_sqlite_startup(f"sqlite:///{target}", create_engine(f"sqlite:///{target}"))


def test_fresh_database_initialization_is_empty_idempotent_and_valid(tmp_path):
    target = (tmp_path / "fresh.db").resolve()
    assert initialize_fresh_sqlite_database(target) == "MIGRATION_COMPLETE"
    assert initialize_fresh_sqlite_database(target) == "MIGRATION_COMPLETE"
    connection = sqlite3.connect(target)
    try:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        for table in PROTECTED_TABLES:
            assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone() == (0,)
        assert connection.execute(
            "SELECT COUNT(*) FROM operatoros_schema_migrations"
        ).fetchone() == (1,)
    finally:
        connection.close()


def test_fresh_database_interrupted_marker_requires_recovery(tmp_path):
    target = (tmp_path / "fresh.db").resolve()
    marker = target.with_name(f".{target.name}.migrating")
    marker.touch()
    with pytest.raises(RuntimeError, match="MIGRATION_RECOVERY_REQUIRED"):
        initialize_fresh_sqlite_database(target)
    assert not target.exists()


def test_baseline_adoption_is_idempotent(tmp_path):
    target = production_copy(tmp_path)
    counts = expected_production_counts()
    first = adopt_current_sqlite_schema(target, expected_counts=counts)
    second = adopt_current_sqlite_schema(target, expected_counts=counts)
    assert second == first
    with sqlite3.connect(target) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM operatoros_schema_migrations"
        ).fetchone() == (1,)


def test_baseline_rejects_count_mismatch_without_ledger(tmp_path):
    target = production_copy(tmp_path)
    counts = expected_production_counts()
    counts["attendance"] -= 1
    with pytest.raises(RuntimeError, match="protected count mismatch"):
        adopt_current_sqlite_schema(target, expected_counts=counts)
    with sqlite3.connect(target) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='operatoros_schema_migrations'"
        ).fetchone() == (0,)


def test_baseline_rejects_schema_and_foreign_key_mismatch(tmp_path):
    schema_mismatch = production_copy(tmp_path)
    with sqlite3.connect(schema_mismatch) as connection:
        connection.execute("DROP INDEX idx_attendance_student_date")
    with pytest.raises(RuntimeError, match="required indexes"):
        adopt_current_sqlite_schema(schema_mismatch, expected_counts=expected_production_counts())

    fk_mismatch = tmp_path / "fk-mismatch.db"
    shutil.copy2(PRODUCTION_DB, fk_mismatch)
    with sqlite3.connect(fk_mismatch) as connection:
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute(
            "INSERT INTO attendance (student_id,date,late_duration,late_source,is_absent,status) "
            "VALUES (999999,'2099-01-01',0,'none',0,'absent')"
        )
    counts = expected_production_counts()
    counts["attendance"] += 1
    with pytest.raises(RuntimeError, match="foreign-key violations"):
        adopt_current_sqlite_schema(fk_mismatch, expected_counts=counts)


def test_baseline_rejects_relative_path():
    with pytest.raises(RuntimeError, match="must be absolute"):
        adopt_current_sqlite_schema(Path("attendance.db"), expected_counts={})


def test_manifest_covers_governed_database_states():
    manifest = json.loads((ROOT / "backend/migrations/migration_manifest.json").read_text())
    states = {entry["state"] for entry in manifest["states"]}
    assert states == {
        "fresh_empty",
        "legacy_attendance_only",
        "legacy_students_without_identities",
        "partially_linked",
        "reconciled_without_ledger",
        "current",
        "pending_known_migration",
        "unsupported_or_malformed",
    }
    assert manifest["startup_is_migration_runner"] is False
    assert all(len(item["checksum"]) == 64 for item in manifest["migrations"])


def test_baseline_cli_requires_literal_approval(tmp_path):
    target = production_copy(tmp_path)
    arguments = [
        "adopt-baseline", "--database", str(target), "--baseline", "20260722_s38",
        "--approval", "REJECT_BASELINE_ADOPTION", "--approved-by", "test-owner",
        "--expected-attendance", "3651", "--expected-student-device-identities", "117",
        "--expected-student-enrollments", "0", "--expected-student-masters", "117",
        "--expected-students", "117",
    ]
    with pytest.raises(RuntimeError, match="BASELINE_APPROVAL_REQUIRED"):
        migration_main(arguments)
