"""Operational Database Recovery Helper for OperatorOS.

Recovers backend/attendance.db from the restored July 15 seed baseline to the
latest accepted operational schema (S4.2 / 20260724_s42) without losing surviving
data or fabricating missing records.
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import hashlib
import logging
from datetime import datetime, timezone
from pathlib import Path

from core.schema_guard import CURRENT_SCHEMA_VERSION, LEDGER_TABLE
from core.schema_migrations import (
    adopt_current_sqlite_schema,
    migrate_s38_to_s39_sqlite,
)
from core.enrollment_ledger_migration import migrate_enrollment_ledger_sqlite
from core.student_progression_migration import migrate_student_progression_sqlite
from core.attendance_correction_migration import migrate_attendance_corrections_sqlite
from core.early_departure_migration import ensure_early_departure_tables_exist
from core.database import init_db


LOGGER = logging.getLogger("operatoros.operational_recovery")

EXPECTED_SEED_SHA256 = "0d1bfa30540c9f2e896f75cb1ba736c501c94c3ea82337f0d4501dc225a7007c"

SEED_EXPECTED_PROTECTED_COUNTS = {
    "students": 107,
    "student_masters": 0,
    "student_device_identities": 0,
    "attendance": 3409,
    "student_enrollments": 0,
}


def calculate_file_sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def create_pre_recovery_backup(target_path: Path, backups_dir: Path) -> Path:
    backups_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_path = backups_dir / f"pre-recovery-{timestamp}.db"
    shutil.copy2(target_path, backup_path)
    LOGGER.info(
        "Created pre-recovery backup",
        extra={"target_path": str(target_path), "backup_path": str(backup_path)},
    )
    return backup_path


def run_operational_recovery(
    target_path: Path,
    *,
    expected_seed_sha: str = EXPECTED_SEED_SHA256,
    backups_dir: Path | None = None,
    enforce_seed_sha: bool = True,
) -> str:
    """Execute operational database recovery on target_path cleanly and atomically."""
    target_resolved = target_path.resolve(strict=True)

    # 1. Source DB SHA gate matching known restored baseline
    current_sha = calculate_file_sha256(target_resolved)
    if enforce_seed_sha and current_sha != expected_seed_sha:
        raise RuntimeError(
            f"RECOVERY_SOURCE_SHA_MISMATCH: Expected {expected_seed_sha}, got {current_sha}"
        )

    # 2. Check if already at latest schema version
    with sqlite3.connect(f"file:{target_resolved.as_posix()}?mode=ro", uri=True) as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if LEDGER_TABLE in tables:
            last_version = conn.execute(
                f"SELECT version FROM {LEDGER_TABLE} ORDER BY applied_at DESC LIMIT 1"
            ).fetchone()
            if last_version and last_version[0] == CURRENT_SCHEMA_VERSION:
                LOGGER.info("Operational recovery skipped: target database is already current.")
                return "RECOVERY_ALREADY_CURRENT"

    # 3. Create pre-recovery backup
    if backups_dir is None:
        backups_dir = target_resolved.parent / ".local-dev" / "backups"
    create_pre_recovery_backup(target_resolved, backups_dir)

    # 4. Perform rehearsed migration chain on temporary database file
    temporary_path = target_resolved.with_name(f".{target_resolved.name}.recovery-working")
    if temporary_path.exists():
        temporary_path.unlink()
    shutil.copy2(target_resolved, temporary_path)

    try:
        # Pre-create missing S3.8 table academic_roster_import_batches on temporary DB
        with sqlite3.connect(temporary_path) as conn:
            tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if "academic_roster_import_batches" not in tables:
                conn.execute(
                    "CREATE TABLE academic_roster_import_batches ("
                    "id VARCHAR(36) NOT NULL PRIMARY KEY, "
                    "filename VARCHAR(255) NOT NULL, "
                    "checksum VARCHAR(64) NOT NULL, "
                    "status VARCHAR(32) NOT NULL DEFAULT 'preview', "
                    "total_rows INTEGER NOT NULL DEFAULT 0, "
                    "created_by VARCHAR(255) NOT NULL, "
                    "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                    "committed_at DATETIME)"
                )
                conn.commit()

        # Step A: Adopt S3.8 baseline into ledger
        adopt_current_sqlite_schema(
            temporary_path,
            expected_counts=SEED_EXPECTED_PROTECTED_COUNTS,
            approved_by="OPERATIONAL_RECOVERY",
        )

        # Step B: S3.8 -> S3.9 migration
        migrate_s38_to_s39_sqlite(temporary_path)

        # Step C: S3.9 -> S4.0 migration
        os.environ["OPERATOROS_ISOLATED_TEST"] = "true"
        migrate_enrollment_ledger_sqlite(temporary_path)

        # Step D: S4.0 -> S4.1 migration
        migrate_student_progression_sqlite(temporary_path)

        # Step E: S4.1 -> S4.2 migration
        migrate_attendance_corrections_sqlite(temporary_path)

        # Step F: Initialize remaining ORM tables and early departure triggers
        from sqlalchemy import create_engine
        from core.database import Base
        recovery_engine = create_engine(f"sqlite:///{temporary_path.resolve()}")
        try:
            Base.metadata.create_all(bind=recovery_engine)
            ensure_early_departure_tables_exist()
        finally:
            recovery_engine.dispose()

        # Step G: Post-recovery verification on temporary database
        with sqlite3.connect(temporary_path) as conn:
            conn.execute("PRAGMA foreign_keys=ON")
            integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                raise RuntimeError(f"RECOVERY_VALIDATION_FAILED: integrity check ({integrity})")

            fk_errors = conn.execute("PRAGMA foreign_key_check").fetchall()
            if fk_errors:
                raise RuntimeError(f"RECOVERY_VALIDATION_FAILED: foreign key errors ({fk_errors})")

            students_cnt = conn.execute("SELECT COUNT(*) FROM students").fetchone()[0]
            attendance_cnt = conn.execute("SELECT COUNT(*) FROM attendance").fetchone()[0]
            enrollments_cnt = conn.execute("SELECT COUNT(*) FROM student_enrollments").fetchone()[0]
            if students_cnt != SEED_EXPECTED_PROTECTED_COUNTS["students"]:
                raise RuntimeError("RECOVERY_VALIDATION_FAILED: students count altered")
            if attendance_cnt != SEED_EXPECTED_PROTECTED_COUNTS["attendance"]:
                raise RuntimeError("RECOVERY_VALIDATION_FAILED: attendance count altered")
            if enrollments_cnt != SEED_EXPECTED_PROTECTED_COUNTS["student_enrollments"]:
                raise RuntimeError("RECOVERY_VALIDATION_FAILED: enrollments count altered")

            ledger_entries = [
                row[0]
                for row in conn.execute(
                    f"SELECT version FROM {LEDGER_TABLE} ORDER BY applied_at ASC"
                ).fetchall()
            ]
            if CURRENT_SCHEMA_VERSION not in ledger_entries:
                raise RuntimeError("RECOVERY_VALIDATION_FAILED: current schema version missing from ledger")

        # Atomic publication
        os.replace(temporary_path, target_resolved)
        for suffix in ("-wal", "-shm"):
            sidecar = Path(str(target_resolved) + suffix)
            if sidecar.exists():
                sidecar.unlink()

        LOGGER.info(
            "Operational database recovery committed successfully",
            extra={
                "target_path": str(target_resolved),
                "final_sha256": calculate_file_sha256(target_resolved),
                "table_count": len(ledger_entries),
            },
        )
        return "RECOVERY_COMPLETE"

    except Exception:
        if temporary_path.exists():
            temporary_path.unlink()
        for suffix in ("-wal", "-shm"):
            sidecar = Path(str(temporary_path) + suffix)
            if sidecar.exists():
                sidecar.unlink()
        raise
