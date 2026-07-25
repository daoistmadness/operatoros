"""Contract and unit tests for operational database recovery module."""

import os
import shutil
import sqlite3
import pytest
from pathlib import Path

from core.operational_recovery import (
    run_operational_recovery,
    calculate_file_sha256,
    APPROVED_RECOVERY_SOURCE_SHA256,
    APPROVED_TARGET_SHA256,
    RecoveryResult,
)
from core.schema_guard import CURRENT_SCHEMA_VERSION, LEDGER_TABLE, _validate_sqlite_file


@pytest.fixture
def synthetic_source_db(tmp_path: Path) -> Path:
    """Fixture providing a synthetic disposable copy of the complete operational backup source."""
    actual_source_db = Path("backups/operatoros_v0.9.0_production_20260716_135924.db").resolve(strict=True)
    source_copy = tmp_path / "synthetic-complete-source.db"
    shutil.copy2(actual_source_db, source_copy)

    # Verify source SHA matches official complete operational checksum
    actual_sha = calculate_file_sha256(source_copy)
    assert actual_sha == APPROVED_RECOVERY_SOURCE_SHA256
    return source_copy


@pytest.fixture
def synthetic_target_db(tmp_path: Path) -> Path:
    """Fixture providing a synthetic disposable copy of the current incomplete seed target."""
    target_copy = tmp_path / "synthetic-seed-target.db"

    # Search incident backup directory for original seed target DB, fallback to backend/attendance.db
    inc_dir = Path("/home/mikhailryu/operatoros-database-incident-backups")
    inc_backups = list(inc_dir.glob("pre-recovery-target-*.db")) if inc_dir.exists() else []

    source_seed = None
    for b in inc_backups:
        if calculate_file_sha256(b) == APPROVED_TARGET_SHA256:
            source_seed = b
            break

    if source_seed is None:
        actual_target = Path("backend/attendance.db").resolve(strict=True)
        if calculate_file_sha256(actual_target) == APPROVED_TARGET_SHA256:
            source_seed = actual_target

    if source_seed is None:
        pytest.skip("No pre-recovery seed target database matching APPROVED_TARGET_SHA256 found for unit test.")

    shutil.copy2(source_seed, target_copy)
    actual_sha = calculate_file_sha256(target_copy)
    assert actual_sha == APPROVED_TARGET_SHA256
    return target_copy


def test_operational_recovery_contract_distinct_paths_required(synthetic_source_db: Path, tmp_path: Path):
    """Test that identical source and target paths are rejected."""
    backup_dir = tmp_path / "incident_backup"
    with pytest.raises(ValueError, match="RECOVERY_CONTRACT_INVALID: source and target paths must be distinct"):
        run_operational_recovery(
            source_path=synthetic_source_db,
            target_path=synthetic_source_db,
            external_backup_dir=backup_dir,
            enforce_sha_validation=False,
        )


def test_operational_recovery_wrong_source_sha_rejected(synthetic_target_db: Path, tmp_path: Path):
    """Test that invalid source SHA is rejected before any mutation."""
    invalid_source = tmp_path / "invalid_source.db"
    with sqlite3.connect(invalid_source) as conn:
        conn.execute("CREATE TABLE dummy (id INT)")

    backup_dir = tmp_path / "incident_backup"
    target_sha_before = calculate_file_sha256(synthetic_target_db)

    with pytest.raises(RuntimeError, match="RECOVERY_SOURCE_SHA_MISMATCH"):
        run_operational_recovery(
            source_path=invalid_source,
            target_path=synthetic_target_db,
            expected_source_sha=APPROVED_RECOVERY_SOURCE_SHA256,
            expected_target_sha=APPROVED_TARGET_SHA256,
            external_backup_dir=backup_dir,
            enforce_sha_validation=True,
        )

    # Verify target remains completely untouched
    assert calculate_file_sha256(synthetic_target_db) == target_sha_before


def test_operational_recovery_wrong_target_sha_rejected(synthetic_source_db: Path, tmp_path: Path):
    """Test that invalid target SHA is rejected before any mutation."""
    invalid_target = tmp_path / "invalid_target.db"
    with sqlite3.connect(invalid_target) as conn:
        conn.execute("CREATE TABLE dummy (id INT)")

    backup_dir = tmp_path / "incident_backup"
    source_sha_before = calculate_file_sha256(synthetic_source_db)

    with pytest.raises(RuntimeError, match="RECOVERY_TARGET_SHA_MISMATCH"):
        run_operational_recovery(
            source_path=synthetic_source_db,
            target_path=invalid_target,
            expected_source_sha=APPROVED_RECOVERY_SOURCE_SHA256,
            expected_target_sha=APPROVED_TARGET_SHA256,
            external_backup_dir=backup_dir,
            enforce_sha_validation=True,
        )

    # Verify source remains completely untouched
    assert calculate_file_sha256(synthetic_source_db) == source_sha_before


def test_operational_recovery_successful_execution(
    synthetic_source_db: Path,
    synthetic_target_db: Path,
    tmp_path: Path,
):
    """Test full operational recovery execution and contract guarantees."""
    backup_dir = tmp_path / "incident_backup"
    source_sha_before = calculate_file_sha256(synthetic_source_db)
    target_sha_before = calculate_file_sha256(synthetic_target_db)

    result = run_operational_recovery(
        source_path=synthetic_source_db,
        target_path=synthetic_target_db,
        expected_source_sha=APPROVED_RECOVERY_SOURCE_SHA256,
        expected_target_sha=APPROVED_TARGET_SHA256,
        external_backup_dir=backup_dir,
        enforce_sha_validation=True,
    )

    assert isinstance(result, RecoveryResult)
    assert result.status == "RECOVERY_COMPLETE"
    assert result.students_count == 117
    assert result.attendance_count == 3651
    assert result.enrollments_count == 0
    assert result.schema_version == CURRENT_SCHEMA_VERSION

    # 1. Verify recovery source remains 100% byte-identical
    assert calculate_file_sha256(synthetic_source_db) == source_sha_before

    # 2. Verify incident backup matches pre-recovery target checksum exactly
    backup_file = Path(result.incident_backup_path)
    assert backup_file.exists()
    assert calculate_file_sha256(backup_file) == target_sha_before

    # 3. Verify target database integrity, foreign keys, row counts, and schema using ro&immutable=1
    with sqlite3.connect(f"file:{synthetic_target_db.as_posix()}?mode=ro&immutable=1", uri=True) as conn:
        conn.execute("PRAGMA foreign_keys=ON")
        assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []

        students_cnt = conn.execute("SELECT COUNT(*) FROM students").fetchone()[0]
        attendance_cnt = conn.execute("SELECT COUNT(*) FROM attendance").fetchone()[0]
        enrollments_cnt = conn.execute("SELECT COUNT(*) FROM student_enrollments").fetchone()[0]

        assert students_cnt == 117
        assert attendance_cnt == 3651
        assert enrollments_cnt == 0

        # Check required schema version in migration ledger
        ledger_versions = [
            row[0]
            for row in conn.execute(
                f"SELECT version FROM {LEDGER_TABLE} ORDER BY applied_at ASC"
            ).fetchall()
        ]
        assert CURRENT_SCHEMA_VERSION in ledger_versions

    # 4. Verify no target WAL/SHM sidecars exist
    for suffix in ("-wal", "-shm"):
        assert not Path(str(synthetic_target_db) + suffix).exists()

    # 5. Check trigger enforcement by making a disposable write connection to target
    with sqlite3.connect(f"file:{synthetic_target_db.as_posix()}?mode=rw", uri=True) as conn:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(attendance_override_history)").fetchall()]
        col_list = [c for c in cols if c != "id"]
        placeholders = ",".join("?" for _ in col_list)
        dummy_vals = ["1" if c.endswith("_id") or c == "attendance_id" else ("2026-07-25" if "date" in c or "at" in c else "test") for c in col_list]
        conn.execute(
            f"INSERT INTO attendance_override_history ({','.join(col_list)}) VALUES ({placeholders})",
            dummy_vals,
        )
        inserted_id = conn.execute("SELECT MAX(id) FROM attendance_override_history").fetchone()[0]
        conn.commit()

        with pytest.raises(sqlite3.Error, match="append-only"):
            conn.execute(f"DELETE FROM attendance_override_history WHERE id={inserted_id}")

    # 6. Verify second execution is rejected because target SHA changed
    with pytest.raises(RuntimeError, match="RECOVERY_TARGET_SHA_MISMATCH"):
        run_operational_recovery(
            source_path=synthetic_source_db,
            target_path=synthetic_target_db,
            expected_source_sha=APPROVED_RECOVERY_SOURCE_SHA256,
            expected_target_sha=APPROVED_TARGET_SHA256,
            external_backup_dir=backup_dir,
            enforce_sha_validation=True,
        )
