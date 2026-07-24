"""Unit tests for operational database recovery module."""

import os
import shutil
import sqlite3
import pytest
from pathlib import Path

from core.operational_recovery import (
    run_operational_recovery,
    calculate_file_sha256,
    EXPECTED_SEED_SHA256,
)
from core.schema_guard import CURRENT_SCHEMA_VERSION, LEDGER_TABLE


@pytest.fixture
def synthetic_seed_db(tmp_path: Path) -> Path:
    """Fixture providing a disposable copy of the July 15 seed database."""
    protected_db = Path("backend/attendance.db").resolve(strict=True)
    target_db = tmp_path / "synthetic-attendance.db"
    shutil.copy2(protected_db, target_db)

    # Calculate actual seed checksum
    actual_sha = calculate_file_sha256(target_db)
    assert actual_sha == EXPECTED_SEED_SHA256
    return target_db


def test_operational_recovery_successful_execution(synthetic_seed_db: Path, tmp_path: Path):
    backups_dir = tmp_path / "backups"
    result = run_operational_recovery(
        synthetic_seed_db,
        backups_dir=backups_dir,
        enforce_seed_sha=True,
    )
    assert result == "RECOVERY_COMPLETE"

    # Verify database integrity and tables
    with sqlite3.connect(synthetic_seed_db) as conn:
        conn.execute("PRAGMA foreign_keys=ON")
        assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []

        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        assert "teacher_class_assignments" in tables
        assert "dismissal_policies" in tables
        assert "early_departure_excuses" in tables
        assert "student_enrollment_lifecycle_audit" in tables
        assert "attendance_correction_requests" in tables

        students_cnt = conn.execute("SELECT COUNT(*) FROM students").fetchone()[0]
        attendance_cnt = conn.execute("SELECT COUNT(*) FROM attendance").fetchone()[0]
        enrollments_cnt = conn.execute("SELECT COUNT(*) FROM student_enrollments").fetchone()[0]

        assert students_cnt == 107
        assert attendance_cnt == 3409
        assert enrollments_cnt == 0

        ledger_entries = [
            row[0]
            for row in conn.execute(
                f"SELECT version FROM {LEDGER_TABLE} ORDER BY applied_at ASC"
            ).fetchall()
        ]
        assert CURRENT_SCHEMA_VERSION in ledger_entries

    # Backup should exist
    backup_files = list(backups_dir.glob("pre-recovery-*.db"))
    assert len(backup_files) == 1


def test_operational_recovery_source_checksum_rejection(tmp_path: Path):
    invalid_db = tmp_path / "invalid.db"
    with sqlite3.connect(invalid_db) as conn:
        conn.execute("CREATE TABLE dummy (id INT)")

    backups_dir = tmp_path / "backups"
    with pytest.raises(RuntimeError, match="RECOVERY_SOURCE_SHA_MISMATCH"):
        run_operational_recovery(
            invalid_db,
            expected_seed_sha=EXPECTED_SEED_SHA256,
            backups_dir=backups_dir,
            enforce_seed_sha=True,
        )


def test_operational_recovery_idempotency(synthetic_seed_db: Path, tmp_path: Path):
    backups_dir = tmp_path / "backups"
    first_res = run_operational_recovery(
        synthetic_seed_db,
        backups_dir=backups_dir,
        enforce_seed_sha=True,
    )
    assert first_res == "RECOVERY_COMPLETE"

    # Second execution should recognize database is already current
    second_res = run_operational_recovery(
        synthetic_seed_db,
        backups_dir=backups_dir,
        enforce_seed_sha=False,
    )
    assert second_res == "RECOVERY_ALREADY_CURRENT"
