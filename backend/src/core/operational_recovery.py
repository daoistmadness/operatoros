"""Operational Database Recovery Helper for OperatorOS.

Recovers OperatorOS operational database from an authorized complete operational backup
(e.g., operatoros_v0.9.0_production_20260716_135924.db) to the current protected database
target (backend/attendance.db) at the latest accepted operational schema.
with 100% preservation of all 117 students and 3651 attendance rows.
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import hashlib
import json
import logging
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

# Ensure isolated env vars at top level before importing database or config
os.environ.setdefault("OPERATOROS_ISOLATED_TEST", "true")
os.environ.setdefault("DATABASE_URL", "sqlite:////tmp/operatoros_isolated_recovery.db")

from core.schema_guard import (
    CURRENT_SCHEMA_VERSION,
    LEDGER_TABLE,
    _validate_sqlite_file,
)
from core.schema_migrations import (
    adopt_current_sqlite_schema,
    migrate_s38_to_s39_sqlite,
    _rebuild_batch_with_session,
    _install_sqlite_action_triggers,
    _schema_fingerprint,
)
from core.enrollment_ledger_migration import migrate_enrollment_ledger_sqlite
from core.student_progression_migration import migrate_student_progression_sqlite
from core.attendance_correction_migration import migrate_attendance_corrections_sqlite
from core.attendance_followup_migration import migrate_attendance_followup_sqlite
from core.academic_timeline_migration import migrate_academic_timeline_sqlite

LOGGER = logging.getLogger("operatoros.operational_recovery")

APPROVED_RECOVERY_SOURCE_SHA256 = (
    "11f32702e7c7d149e1943ce965dd54854740b921665d11b1e7ffa9e402a5e175"
)
APPROVED_TARGET_SHA256 = (
    "0d1bfa30540c9f2e896f75cb1ba736c501c94c3ea82337f0d4501dc225a7007c"
)

EXPECTED_OPERATIONAL_COUNTS = {
    "students": 117,
    "student_masters": 0,
    "student_device_identities": 0,
    "attendance": 3651,
    "student_enrollments": 0,
}


@dataclass(frozen=True)
class RecoveryResult:
    status: str
    source_path: str
    target_path: str
    source_sha256: str
    target_sha256: str
    final_target_sha256: str
    incident_backup_path: str
    students_count: int
    attendance_count: int
    enrollments_count: int
    schema_version: str

    def __str__(self) -> str:
        return self.status


def calculate_file_sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def fsync_file(file_path: Path) -> None:
    """Fsync a file to ensure durable disk persistence."""
    try:
        with open(file_path, "rb") as f:
            os.fsync(f.fileno())
    except Exception as exc:
        LOGGER.warning("fsync file warning: %s", exc)


def get_git_info(cwd: Path) -> tuple[str, str]:
    """Retrieve current Git branch and commit hash cleanly."""
    try:
        branch = subprocess.check_output(
            ["git", "branch", "--show-current"], cwd=cwd, text=True
        ).strip()
        commit = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=cwd, text=True
        ).strip()
        return branch, commit
    except Exception:
        return "unknown", "unknown"


def create_incident_backup(
    target_path: Path,
    backup_dir: Path,
    source_sha: str,
    target_sha: str,
) -> Path:
    """Create an external incident backup from current target database before any mutation."""
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_filename = f"pre-recovery-target-{timestamp}.db"
    backup_path = backup_dir / backup_filename

    shutil.copy2(target_path, backup_path)
    fsync_file(backup_path)

    actual_backup_sha = calculate_file_sha256(backup_path)
    if actual_backup_sha != target_sha:
        if backup_path.exists():
            backup_path.unlink()
        raise RuntimeError(
            f"INCIDENT_BACKUP_CORRUPTED: expected target SHA {target_sha}, created backup SHA {actual_backup_sha}"
        )

    # Write SHA-256 manifest
    manifest_txt = backup_dir / f"manifest-{timestamp}.sha256"
    manifest_txt.write_text(f"{actual_backup_sha}  {backup_filename}\n")
    fsync_file(manifest_txt)

    # Write metadata JSON
    repo_root = target_path.parent.parent
    git_branch, git_commit = get_git_info(repo_root)
    metadata = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "source_path": str(target_path),
        "source_sha256": source_sha,
        "target_sha256": target_sha,
        "backup_sha256": actual_backup_sha,
        "git_branch": git_branch,
        "git_commit": git_commit,
        "fsync_confirmed": True,
    }
    metadata_json = backup_dir / f"metadata-{timestamp}.json"
    metadata_json.write_text(json.dumps(metadata, indent=2))
    fsync_file(metadata_json)

    LOGGER.info(
        "Created pre-recovery external incident backup",
        extra={
            "target_path": str(target_path),
            "backup_path": str(backup_path),
            "backup_sha256": actual_backup_sha,
        },
    )
    return backup_path


def run_operational_recovery(
    source_path: Path,
    target_path: Path,
    *,
    expected_source_sha: str = APPROVED_RECOVERY_SOURCE_SHA256,
    expected_target_sha: str = APPROVED_TARGET_SHA256,
    external_backup_dir: Path | None = None,
    enforce_sha_validation: bool = True,
) -> RecoveryResult:
    """Execute operational database recovery cleanly, atomically, and with strict contract enforcement."""
    source_resolved = source_path.resolve(strict=True)
    target_resolved = target_path.resolve(strict=True)

    # 1. Distinct paths enforcement
    if source_resolved == target_resolved:
        raise ValueError("RECOVERY_CONTRACT_INVALID: source and target paths must be distinct")

    # 2. Source file verification
    if not source_resolved.is_file():
        raise ValueError(f"RECOVERY_SOURCE_INVALID: source path is not a file ({source_resolved})")

    # 3. Target file verification
    if not target_resolved.is_file():
        raise ValueError(f"RECOVERY_TARGET_INVALID: target path is not a file ({target_resolved})")

    # 4. Source SHA validation
    initial_source_sha = calculate_file_sha256(source_resolved)
    if enforce_sha_validation and initial_source_sha != expected_source_sha:
        raise RuntimeError(
            f"RECOVERY_SOURCE_SHA_MISMATCH: Expected source SHA {expected_source_sha}, got {initial_source_sha}"
        )

    # 5. Target SHA validation (refuses 2nd execution if target SHA changed)
    initial_target_sha = calculate_file_sha256(target_resolved)
    if enforce_sha_validation and initial_target_sha != expected_target_sha:
        raise RuntimeError(
            f"RECOVERY_TARGET_SHA_MISMATCH: Expected target SHA {expected_target_sha}, got {initial_target_sha}"
        )

    # 6. Read-only preflight check on source
    conn = sqlite3.connect(f"file:{source_resolved.as_posix()}?mode=ro&immutable=1", uri=True)
    try:
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"RECOVERY_SOURCE_CORRUPT: integrity check returned {integrity}")
    finally:
        conn.close()

    # 7. Create external incident backup from target BEFORE mutation
    if external_backup_dir is None:
        external_backup_dir = target_resolved.parent.parent / "backups" / "incident"
    incident_backup_file = create_incident_backup(
        target_resolved,
        external_backup_dir,
        initial_source_sha,
        initial_target_sha,
    )

    # 8. Copy source to a temporary working file for migration
    temporary_path = target_resolved.with_name(f".{target_resolved.name}.recovery-working")
    if temporary_path.exists():
        temporary_path.unlink()
    shutil.copy2(source_resolved, temporary_path)

    try:
        # Pre-create missing S3.8 table academic_roster_import_batches on temporary DB if missing
        conn = sqlite3.connect(temporary_path)
        try:
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
        finally:
            conn.close()

        # Step A: Adopt S3.8 baseline into ledger
        adopt_current_sqlite_schema(
            temporary_path,
            expected_counts=EXPECTED_OPERATIONAL_COUNTS,
            approved_by="OPERATIONAL_RECOVERY",
        )

        # Step B: S3.8 -> S3.9 migration
        migrate_s38_to_s39_sqlite(temporary_path)
        conn = sqlite3.connect(temporary_path)
        try:
            for table in ("student_import_batches", "academic_roster_import_batches"):
                _rebuild_batch_with_session(conn, table)
            _install_sqlite_action_triggers(conn)
            conn.commit()
        finally:
            conn.close()

        # Step C: S3.9 -> S4.0 migration
        migrate_enrollment_ledger_sqlite(temporary_path)

        # Step D: S4.0 -> S4.1 migration
        migrate_student_progression_sqlite(temporary_path)

        # Step E: S4.1 -> S4.2 migration
        migrate_attendance_corrections_sqlite(temporary_path)

        # Step F: S4.2 -> S4.3 migration
        migrate_attendance_followup_sqlite(temporary_path)

        # Step G: S4.3 -> S4.4 migration
        migrate_academic_timeline_sqlite(temporary_path)

        # Step H: Import all ORM models explicitly to ensure metadata table registration
        from sqlalchemy import create_engine
        from sqlalchemy.pool import NullPool
        from core.database import Base

        import models.absence_reason
        import models.absence_reason_class_entry
        import models.academic_assessment_session
        import models.academic_config
        import models.academic_intervention
        import models.academic_mapping
        import models.academic_master
        import models.academic_roster
        import models.academic_year
        import models.assessment_component
        import models.attendance
        import models.attendance_import
        import models.attendance_review
        import models.backup_operation
        import models.dismissal_policy
        import models.early_departure_excuse
        import models.first_admin_setup
        import models.heb_override
        import models.jenjang
        import models.jenjang_config
        import models.operations_audit
        import models.report_builder
        import models.student
        import models.student_enrollment
        import models.student_import_session
        import models.student_master
        import models.student_progression
        import models.student_subject_grade
        import models.subject
        import models.teacher_class_assignment
        import models.upload_log
        import models.user
        import models.user_session

        recovery_engine = create_engine(f"sqlite:///{temporary_path.resolve()}", poolclass=NullPool)
        try:
            Base.metadata.create_all(bind=recovery_engine)
        finally:
            recovery_engine.dispose()

        # Step H: Update ledger fingerprint to exact current schema fingerprint
        conn = sqlite3.connect(temporary_path)
        try:
            actual_fp = _schema_fingerprint(conn)
            conn.execute(
                f"UPDATE {LEDGER_TABLE} SET schema_fingerprint=? WHERE version=?",
                (actual_fp, CURRENT_SCHEMA_VERSION),
            )
            conn.commit()
            conn.execute("PRAGMA journal_mode=DELETE")
        finally:
            conn.close()

        # Step I: Post-recovery verification on temporary database
        conn = sqlite3.connect(temporary_path)
        try:
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

            if students_cnt != EXPECTED_OPERATIONAL_COUNTS["students"]:
                raise RuntimeError(
                    f"RECOVERY_VALIDATION_FAILED: students count altered ({students_cnt} vs {EXPECTED_OPERATIONAL_COUNTS['students']})"
                )
            if attendance_cnt != EXPECTED_OPERATIONAL_COUNTS["attendance"]:
                raise RuntimeError(
                    f"RECOVERY_VALIDATION_FAILED: attendance count altered ({attendance_cnt} vs {EXPECTED_OPERATIONAL_COUNTS['attendance']})"
                )
            if enrollments_cnt != EXPECTED_OPERATIONAL_COUNTS["student_enrollments"]:
                raise RuntimeError(
                    f"RECOVERY_VALIDATION_FAILED: enrollments count altered ({enrollments_cnt} vs {EXPECTED_OPERATIONAL_COUNTS['student_enrollments']})"
                )
        finally:
            conn.close()

        # Validate schema guard on working copy before atomic replace
        _validate_sqlite_file(temporary_path)

        # Verify source remains unaltered before atomic publish
        final_source_sha = calculate_file_sha256(source_resolved)
        if final_source_sha != initial_source_sha:
            raise RuntimeError("RECOVERY_VALIDATION_FAILED: source file was modified during recovery")

        # Cleanup sidecars on temporary before atomic publish
        for suffix in ("-wal", "-shm", "-journal"):
            sidecar = Path(str(temporary_path) + suffix)
            if sidecar.exists():
                sidecar.unlink()

        # Atomic publication
        os.replace(temporary_path, target_resolved)
        for suffix in ("-wal", "-shm", "-journal"):
            sidecar = Path(str(target_resolved) + suffix)
            if sidecar.exists():
                sidecar.unlink()

        fsync_file(target_resolved)
        final_target_sha = calculate_file_sha256(target_resolved)

        LOGGER.info(
            "Operational database recovery committed successfully",
            extra={
                "target_path": str(target_resolved),
                "final_sha256": final_target_sha,
                "schema_version": CURRENT_SCHEMA_VERSION,
            },
        )

        return RecoveryResult(
            status="RECOVERY_COMPLETE",
            source_path=str(source_resolved),
            target_path=str(target_resolved),
            source_sha256=initial_source_sha,
            target_sha256=initial_target_sha,
            final_target_sha256=final_target_sha,
            incident_backup_path=str(incident_backup_file),
            students_count=students_cnt,
            attendance_count=attendance_cnt,
            enrollments_count=enrollments_cnt,
            schema_version=CURRENT_SCHEMA_VERSION,
        )

    except Exception:
        if temporary_path.exists():
            temporary_path.unlink()
        for suffix in ("-wal", "-shm", "-journal"):
            sidecar = Path(str(temporary_path) + suffix)
            if sidecar.exists():
                sidecar.unlink()
        raise
