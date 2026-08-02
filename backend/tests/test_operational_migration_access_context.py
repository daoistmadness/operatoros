from __future__ import annotations

import importlib
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

from core.config import Settings
ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "s43_migration.py"


def _context(tmp_path):
    # Several legacy test modules intentionally evict ``core.*`` from
    # sys.modules. Resolve the context module at use time so this test uses
    # the same module instance that Settings.database_url imports.
    database_access_context = importlib.import_module("core.database_access_context")
    database = tmp_path / "migration-target.db"
    database.write_bytes(b"synthetic")
    backup = tmp_path / "backup.db"
    backup.write_bytes(b"synthetic")
    return database_access_context.operational_migration_access_context(
        database_path=database,
        expected_source_sha256="f" * 64,
        expected_source_head="20260724_s42",
        backup_path=backup,
        lock_path=tmp_path / "migration.lock",
        lock_held=True,
        preflight_verified=True,
    )


def test_wrapper_import_has_no_backend_migration_or_config_side_effects():
    command = """
import importlib.util, sys
from pathlib import Path
script = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('isolated_s43_wrapper', script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert 'core.config' not in sys.modules
assert 'core.attendance_followup_migration' not in sys.modules
assert 'main' not in sys.modules
print('WRAPPER_IMPORT_ISOLATED')
"""
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(ROOT / "backend" / "src")
    result = subprocess.run(
        [sys.executable, "-c", command, str(SCRIPT)],
        check=True,
        capture_output=True,
        text=True,
        env=environment,
    )
    assert result.stdout.strip() == "WRAPPER_IMPORT_ISOLATED"


def test_normal_runtime_rejects_protected_path():
    settings = Settings(DATABASE_URL="sqlite:///backend/attendance.db", AUTH_COOKIE_SECRET="x" * 32)
    with pytest.raises(ValueError, match="PROTECTED_DATABASE_PATH_REJECTED"):
        _ = settings.database_url


def test_complete_operational_context_permits_matching_protected_path(tmp_path):
    target = tmp_path / "migration-target.db"
    target.write_bytes(b"synthetic")
    with _context(tmp_path):
        context = importlib.import_module("core.database_access_context")
        assert context.active_database_access_context().mode is context.DatabaseAccessMode.OPERATIONAL_MIGRATION
        assert context.active_database_access_context().database_path == target.resolve()
    context = importlib.import_module("core.database_access_context")
    assert context.active_database_access_context().mode is context.DatabaseAccessMode.NORMAL_RUNTIME


def test_context_is_cleared_after_exception(tmp_path):
    with pytest.raises(RuntimeError, match="expected"):
        with _context(tmp_path):
            raise RuntimeError("expected")
    context = importlib.import_module("core.database_access_context")
    assert context.active_database_access_context().mode is context.DatabaseAccessMode.NORMAL_RUNTIME


def test_nested_operational_context_is_rejected(tmp_path):
    with _context(tmp_path):
        with pytest.raises(RuntimeError, match="NESTED_OR_CONFLICTING"):
            with _context(tmp_path):
                pass


def test_incomplete_operational_context_is_rejected(tmp_path):
    backup = tmp_path / "backup.db"
    backup.write_bytes(b"synthetic")
    context = importlib.import_module("core.database_access_context")
    with pytest.raises(RuntimeError, match="CONTEXT_INCOMPLETE"):
        with context.operational_migration_access_context(
            database_path=tmp_path / "migration-target.db",
            expected_source_sha256="f" * 64,
            expected_source_head="20260724_s42",
            backup_path=backup,
            lock_path=tmp_path / "migration.lock",
            lock_held=False,
            preflight_verified=True,
        ):
            pass


def test_direct_migration_call_rejects_missing_disposable_path_without_creating_it(tmp_path):
    from core.attendance_followup_migration import migrate_attendance_followup_sqlite

    missing = tmp_path / "attendance.db"
    assert not missing.exists()
    with pytest.raises(FileNotFoundError):
        migrate_attendance_followup_sqlite(missing)
    assert not missing.exists()
