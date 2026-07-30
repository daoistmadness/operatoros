"""Synthetic contract tests for operational-recovery helpers.

These tests deliberately do not use operational backups, incident directories, or
the protected database.  Production recovery authorization remains enforced by
the runtime's approved checksums; test inputs are disposable schema fixtures.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from core.operational_recovery import (
    calculate_file_sha256,
    create_incident_backup,
    run_operational_recovery,
)
from core.schema_guard import CURRENT_SCHEMA_VERSION, LEDGER_TABLE
from core.schema_migrations import (
    initialize_s42_baseline_sqlite_database,
    migrate_database_to_current,
)


def _ledger_head(path: Path) -> str:
    import sqlite3

    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as connection:
        return connection.execute(
            f"SELECT version FROM {LEDGER_TABLE} ORDER BY applied_at DESC, version DESC LIMIT 1"
        ).fetchone()[0]


@pytest.fixture
def s42_database(tmp_path: Path) -> Path:
    path = tmp_path / "fresh-s42.db"
    initialize_s42_baseline_sqlite_database(path)
    assert _ledger_head(path) == "20260724_s42"
    return path


@pytest.fixture
def s43_database(tmp_path: Path, s42_database: Path) -> Path:
    path = tmp_path / "migrated-s43.db"
    shutil.copy2(s42_database, path)
    assert migrate_database_to_current(path) == "MIGRATION_COMPLETE"
    assert _ledger_head(path) == CURRENT_SCHEMA_VERSION
    return path


@pytest.fixture
def interrupted_migration_database(tmp_path: Path, s42_database: Path) -> Path:
    """A disposable pre-migration copy represents an interrupted migration input."""
    path = tmp_path / "interrupted-s42.db"
    shutil.copy2(s42_database, path)
    assert _ledger_head(path) == "20260724_s42"
    return path


def test_synthetic_schema_fixtures_cover_fresh_migrated_and_interrupted_states(
    s42_database: Path, s43_database: Path, interrupted_migration_database: Path
):
    assert _ledger_head(s42_database) == "20260724_s42"
    assert _ledger_head(s43_database) == CURRENT_SCHEMA_VERSION
    assert _ledger_head(interrupted_migration_database) == "20260724_s42"


def test_operational_recovery_contract_distinct_paths_required(s43_database: Path, tmp_path: Path):
    with pytest.raises(ValueError, match="RECOVERY_CONTRACT_INVALID: source and target paths must be distinct"):
        run_operational_recovery(
            source_path=s43_database,
            target_path=s43_database,
            external_backup_dir=tmp_path / "incident",
            enforce_sha_validation=False,
        )


def test_operational_recovery_wrong_source_sha_rejected_before_target_mutation(
    s43_database: Path, interrupted_migration_database: Path, tmp_path: Path
):
    before = calculate_file_sha256(interrupted_migration_database)
    with pytest.raises(RuntimeError, match="RECOVERY_SOURCE_SHA_MISMATCH"):
        run_operational_recovery(
            source_path=s43_database,
            target_path=interrupted_migration_database,
            expected_source_sha="0" * 64,
            expected_target_sha=calculate_file_sha256(interrupted_migration_database),
            external_backup_dir=tmp_path / "incident",
        )
    assert calculate_file_sha256(interrupted_migration_database) == before


def test_operational_recovery_wrong_target_sha_rejected_before_source_mutation(
    s43_database: Path, interrupted_migration_database: Path, tmp_path: Path
):
    before = calculate_file_sha256(s43_database)
    with pytest.raises(RuntimeError, match="RECOVERY_TARGET_SHA_MISMATCH"):
        run_operational_recovery(
            source_path=s43_database,
            target_path=interrupted_migration_database,
            expected_source_sha=calculate_file_sha256(s43_database),
            expected_target_sha="0" * 64,
            external_backup_dir=tmp_path / "incident",
        )
    assert calculate_file_sha256(s43_database) == before


def test_recovery_backup_uses_a_synthetic_target_only(s43_database: Path, tmp_path: Path):
    backup_dir = tmp_path / "incident"
    target_sha = calculate_file_sha256(s43_database)
    backup = create_incident_backup(s43_database, backup_dir, "synthetic-source", target_sha)

    assert backup.parent == backup_dir
    assert calculate_file_sha256(backup) == target_sha
    assert any(backup_dir.glob("manifest-*.sha256"))
    assert any(backup_dir.glob("metadata-*.json"))
