"""Guarded single-process restore for validated local SQLite backups."""

from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from sqlalchemy.engine import Engine

from services.backup_service import (
    BACKUP_OPERATION_LOCK,
    DESTRUCTIVE_OPERATION_LOCK,
    BackupError,
    REQUIRED_OPERATIONAL_TABLES,
    calculate_sha256,
    create_backup,
    read_tables,
    resolve_backup_directory,
    resolve_sqlite_database_path,
    validate_backup,
)


BACKUP_FILENAME = re.compile(r"^backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(?:_\d+)?\.sqlite3$")
PROTECTED_TABLES = ("attendance", "attendance_override_history", "student_enrollments", "student_subject_grades")
AUDIT_FILENAME = "backup_restore_audit.jsonl"
REQUIRED_USER_COLUMNS = {"id", "username", "password_hash", "role", "is_active", "failed_login_attempts", "locked_until"}
REQUIRED_SESSION_COLUMNS = {"id", "user_id", "token_hash", "created_at", "last_used_at", "expires_at", "absolute_expires_at", "revoked_at"}


class RestoreError(BackupError):
    def __init__(self, message: str, *, status_code: int = 400, reason: str = "restore_invalid"):
        super().__init__(message)
        self.status_code = status_code
        self.reason = reason


def _now_text() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def append_restore_audit(backup_dir: Path, entry: dict[str, Any]) -> None:
    backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(backup_dir, 0o700)
    path = backup_dir / AUDIT_FILENAME
    payload = json.dumps(entry, sort_keys=True, ensure_ascii=True) + "\n"
    try:
        descriptor = os.open(path, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o600)
        try:
            os.write(descriptor, payload.encode("utf-8"))
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.chmod(path, 0o600)
    except OSError as exc:
        raise RestoreError("Restore audit log could not be persisted.", status_code=500) from exc


def _audit_entry(filename: str, event: str, reason: str, snapshot: str | None = None, verified: bool = False, actor: dict[str, Any] | None = None, context: dict[str, Any] | None = None) -> dict[str, Any]:
    actor = actor or {}
    return {
        "timestamp": _now_text(),
        "event": event,
        "target_filename": filename,
        "outcome": event.removeprefix("restore_"),
        "reason": reason,
        "pre_restore_snapshot_filename": snapshot,
        "post_restore_verified": verified,
        "authenticated_user_id": actor.get("user_id"),
        "authenticated_username": actor.get("username"),
        "authenticated_role": actor.get("role"),
        "session_digest": actor.get("session_digest"),
        "request_context": context or {},
    }


def validate_identity_compatibility(path: Path) -> None:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        tables = read_tables(connection)
        if "users" not in tables or "sessions" not in tables:
            raise RestoreError("Backup identity schema is incompatible.", reason="identity_schema_missing")
        user_columns = {row[1] for row in connection.execute("PRAGMA table_info(users)")}
        session_columns = {row[1] for row in connection.execute("PRAGMA table_info(sessions)")}
        if not REQUIRED_USER_COLUMNS <= user_columns or not REQUIRED_SESSION_COLUMNS <= session_columns:
            raise RestoreError("Backup identity schema is incomplete.", reason="identity_columns_incomplete")
        admin = connection.execute("SELECT locked_until FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1").fetchone()
        if admin is None:
            raise RestoreError("Backup has no active administrator.", reason="no_active_admin")
        if admin[0] is not None:
            try:
                datetime.fromisoformat(str(admin[0]).replace("Z", "+00:00"))
            except ValueError as exc:
                raise RestoreError("Backup administrator lockout state is invalid.", reason="no_active_admin") from exc
    finally:
        connection.close()


def revoke_restored_sessions(path: Path) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.execute("UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL", (_now_text(),))
        connection.commit()
    finally:
        connection.close()


@contextmanager
def destructive_restore_guard():
    if not DESTRUCTIVE_OPERATION_LOCK.acquire(blocking=False):
        raise RestoreError("Another destructive operation is already active.", status_code=409, reason="restore_lock_unavailable")
    try:
        yield
    finally:
        DESTRUCTIVE_OPERATION_LOCK.release()


def _validate_filename(filename: str) -> None:
    decoded = unquote(filename)
    if decoded != filename or Path(filename).name != filename or not BACKUP_FILENAME.fullmatch(filename):
        raise RestoreError("Invalid backup filename.")


def _load_metadata(path: Path) -> dict[str, Any]:
    try:
        metadata = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RestoreError("Backup metadata is missing or invalid.") from exc
    required = {"created_at", "trigger", "schema_version", "sqlite_file_size_bytes", "sha256", "source_db_path", "backup_tool_version"}
    if not required <= metadata.keys() or not isinstance(metadata["sha256"], str):
        raise RestoreError("Backup metadata is missing or invalid.")
    return metadata


def _table_counts(path: Path, tables: tuple[str, ...]) -> dict[str, int]:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        existing = read_tables(connection)
        missing = set(tables) - existing
        if missing:
            raise RestoreError("Backup is missing required operational tables: " + ", ".join(sorted(missing)))
        return {table: int(connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]) for table in tables}
    finally:
        connection.close()


def _remove_sidecars(database_path: Path) -> None:
    for suffix in ("-wal", "-shm", "-journal"):
        Path(str(database_path) + suffix).unlink(missing_ok=True)


def _replace_with_retry(source: Path, destination: Path, *, attempts: int = 50, delay: float = 0.1) -> None:
    """Preserve atomic replacement while transient Windows file handles drain."""
    for attempt in range(attempts):
        try:
            source.replace(destination)
            return
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(delay)


def verify_restored_database(path: Path, expected_counts: dict[str, int], engine: Engine) -> None:
    validate_backup(path, set(PROTECTED_TABLES))
    if _table_counts(path, PROTECTED_TABLES) != expected_counts:
        raise RestoreError("Post-restore protected-table verification failed.")
    engine.dispose()
    with engine.connect() as connection:
        for table, expected in expected_counts.items():
            actual = int(connection.exec_driver_sql(f'SELECT COUNT(*) FROM "{table}"').scalar_one())
            if actual != expected:
                raise RestoreError("Post-restore SQLAlchemy verification failed.")


def restore_backup(
    *,
    filename: str,
    confirmation: str | None,
    database_url: str,
    backup_dir: str,
    retention_count: int,
    min_free_mb: int,
    destructive_enabled: bool,
    engine: Engine,
    current_schema_version: str = "unknown",
    actor: dict[str, Any] | None = None,
    request_context: dict[str, Any] | None = None,
    worker_count: int = 1,
    single_worker_required: bool = True,
) -> dict[str, Any]:
    target_dir = resolve_backup_directory(backup_dir)

    def refuse(error: RestoreError) -> None:
        append_restore_audit(target_dir, _audit_entry(filename, "restore_denied", error.reason, actor=actor, context=request_context))
        raise error

    append_restore_audit(target_dir, _audit_entry(filename, "restore_requested", "requested", actor=actor, context=request_context))
    if single_worker_required and worker_count != 1:
        refuse(RestoreError("Restore requires a single-worker runtime.", status_code=409, reason="restore_requires_single_worker"))

    try:
        live_path = resolve_sqlite_database_path(database_url)
    except BackupError as exc:
        refuse(RestoreError(str(exc)))
    if not destructive_enabled:
        refuse(RestoreError("Destructive operations are disabled.", status_code=403, reason="feature_disabled"))
    try:
        _validate_filename(filename)
    except RestoreError as exc:
        refuse(exc)
    if confirmation != filename:
        refuse(RestoreError("Confirmation must exactly match the backup filename.", reason="confirmation_mismatch"))

    try:
      guard = destructive_restore_guard()
      guard.__enter__()
    except RestoreError as exc:
      refuse(exc)
    try:
      with BACKUP_OPERATION_LOCK:
        target = target_dir / filename
        metadata_path = Path(str(target) + ".meta.json")
        if not target.is_file():
            refuse(RestoreError("Backup file was not found.", status_code=404))
        if not metadata_path.is_file():
            refuse(RestoreError("Backup metadata was not found.", status_code=404))
        try:
            metadata = _load_metadata(metadata_path)
            if calculate_sha256(target) != metadata["sha256"]:
                raise RestoreError("Backup checksum verification failed.")

            current_connection = sqlite3.connect(f"file:{live_path}?mode=ro", uri=True)
            try:
                current_tables = read_tables(current_connection)
            finally:
                current_connection.close()
            validate_backup(target, current_tables)
            validate_identity_compatibility(target)
            expected_counts = _table_counts(target, PROTECTED_TABLES)

            backup_schema = metadata["schema_version"]
            if current_schema_version != backup_schema:
                raise RestoreError("Backup schema version is incompatible with the current application.")
            if current_schema_version != "unknown" and backup_schema != current_schema_version:
                raise RestoreError("Backup schema version is incompatible with the current application.")
        except RestoreError as exc:
            refuse(exc)
        except BackupError as exc:
            refuse(RestoreError(str(exc)))
        except (sqlite3.Error, OSError, ValueError) as exc:
            refuse(RestoreError("Backup integrity validation failed."))

        append_restore_audit(target_dir, _audit_entry(filename, "restore_started", "validation_passed", actor=actor, context=request_context))
        try:
            snapshot = create_backup(
                database_url=database_url,
                backup_dir=backup_dir,
                retention_count=retention_count,
                min_free_mb=min_free_mb,
                trigger="pre_restore_auto",
                preserve_filename=filename,
            )
        except BackupError as exc:
            append_restore_audit(target_dir, _audit_entry(filename, "restore_failed", "snapshot_failed", actor=actor, context=request_context))
            raise RestoreError("Pre-restore safety snapshot could not be created.", status_code=500) from exc
        snapshot_name = snapshot["filename"]
        candidate = live_path.parent / f".{live_path.name}.{uuid.uuid4().hex}.restore-candidate"
        rollback = live_path.parent / f".{live_path.name}.{uuid.uuid4().hex}.restore-rollback"
        replaced = False
        try:
            shutil.copyfile(target, candidate)
            os.chmod(candidate, 0o600)
            validate_backup(candidate, current_tables)
            if _table_counts(candidate, PROTECTED_TABLES) != expected_counts:
                raise RestoreError("Restore candidate verification failed.")

            with engine.connect() as connection:
                connection.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")
            engine.dispose()
            _replace_with_retry(live_path, rollback)
            _replace_with_retry(candidate, live_path)
            replaced = True
            _remove_sidecars(live_path)
            revoke_restored_sessions(live_path)
            verify_restored_database(live_path, expected_counts, engine)
            result = {
                "success": True,
                "status": "restored",
                "reauthentication_required": True,
                "message": "Restore completed successfully. Please sign in again.",
                "restored_filename": filename,
                "pre_restore_snapshot_filename": snapshot_name,
                "checksum_verified": True,
                "schema_verified": True,
                "integrity_verified": True,
                "required_tables_verified": True,
                "completed_at": _now_text(),
            }
            append_restore_audit(target_dir, _audit_entry(filename, "restore_completed", "completed", snapshot_name, True, actor, request_context))
            rollback.unlink(missing_ok=True)
            return result
        except Exception as exc:
            engine.dispose()
            if replaced and rollback.exists():
                live_path.unlink(missing_ok=True)
                _replace_with_retry(rollback, live_path)
                _remove_sidecars(live_path)
                engine.dispose()
                validate_backup(live_path, current_tables)
                append_restore_audit(target_dir, _audit_entry(filename, "restore_rolled_back", "rollback_succeeded", snapshot_name, False, actor, request_context))
            reason = str(exc) if isinstance(exc, (BackupError, RestoreError)) else "Restore failed during isolated replacement."
            category = exc.reason if isinstance(exc, RestoreError) else "replacement_failed"
            append_restore_audit(target_dir, _audit_entry(filename, "restore_failed", category, snapshot_name, False, actor, request_context))
            raise RestoreError(reason, status_code=500) from exc
        finally:
            candidate.unlink(missing_ok=True)
            rollback.unlink(missing_ok=True)
    finally:
      guard.__exit__(None, None, None)
