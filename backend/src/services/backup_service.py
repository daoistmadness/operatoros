"""WAL-safe local SQLite backup creation and retention."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy.engine import make_url


BACKUP_TOOL_VERSION = "1.0"
BACKUP_OPERATION_LOCK = threading.RLock()
DESTRUCTIVE_OPERATION_LOCK = threading.Lock()
REQUIRED_OPERATIONAL_TABLES = {
    "attendance",
    "attendance_override_history",
    "student_enrollments",
}
OPTIONAL_GRADE_TABLES = {"student_subject_grades"}


class BackupError(RuntimeError):
    """Raised when a backup cannot be created or validated safely."""


def _utc_now() -> datetime:
    return datetime.now(UTC)


def resolve_sqlite_database_path(database_url: str, *, cwd: Path | None = None) -> Path:
    """Resolve the active SQLite URL to one canonical internal absolute path."""
    url = make_url(database_url)
    if not url.drivername.startswith("sqlite"):
        raise BackupError("Local backup supports SQLite databases only.")
    if not url.database or url.database == ":memory:":
        raise BackupError("A file-backed SQLite database is required for backup.")

    configured = Path(url.database).expanduser()
    if not configured.is_absolute():
        configured = (cwd or Path.cwd()) / configured
    return configured.resolve(strict=False)


def resolve_backup_directory(configured_dir: str, *, project_root: Path | None = None) -> Path:
    """Resolve and validate a non-web-served backup directory."""
    configured = Path(configured_dir).expanduser()
    if ".." in configured.parts:
        raise BackupError("BACKUP_DIR must not contain path traversal segments.")
    resolved = (configured if configured.is_absolute() else Path.cwd() / configured).resolve(strict=False)

    root = (project_root or Path(__file__).resolve().parents[3]).resolve(strict=False)
    forbidden = [root / "frontend", root / "backend" / "static", root / "backend" / "src" / "static"]
    if any(resolved == path or path in resolved.parents for path in forbidden):
        raise BackupError("BACKUP_DIR must not be inside a web-served or frontend directory.")
    return resolved


def calculate_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_tables(connection: sqlite3.Connection) -> set[str]:
    return {
        row[0]
        for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }


def validate_backup(path: Path, source_tables: set[str]) -> None:
    """Open a completed snapshot read-only and validate integrity and operational tables."""
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        integrity_rows = [row[0] for row in connection.execute("PRAGMA integrity_check")]
        if integrity_rows != ["ok"]:
            raise BackupError("Backup integrity validation failed.")
        backup_tables = read_tables(connection)
    finally:
        connection.close()

    required = REQUIRED_OPERATIONAL_TABLES | (OPTIONAL_GRADE_TABLES & source_tables)
    missing = sorted(required - backup_tables)
    if missing:
        raise BackupError("Backup is missing required operational tables: " + ", ".join(missing))


def _safe_created_at(metadata: dict[str, Any]) -> datetime:
    value = metadata.get("created_at")
    if not isinstance(value, str):
        raise BackupError("Backup metadata has no valid created_at timestamp.")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise BackupError("Backup metadata created_at must be timezone-aware.")
    return parsed.astimezone(UTC)


def apply_retention(backup_dir: Path, retention_count: int, preserve_filename: str | None = None) -> list[str]:
    """Remove oldest complete backup pairs using metadata timestamps."""
    if retention_count < 1:
        raise BackupError("Backup retention count must be at least 1.")

    complete: list[tuple[datetime, str, Path, Path]] = []
    for metadata_path in backup_dir.glob("backup_*.sqlite3.meta.json"):
        database_path = Path(str(metadata_path)[: -len(".meta.json")])
        if not database_path.is_file():
            metadata_path.unlink(missing_ok=True)
            continue
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            created_at = _safe_created_at(metadata)
        except (OSError, ValueError, TypeError, json.JSONDecodeError, BackupError):
            continue
        complete.append((created_at, str(metadata.get("trigger", "manual")), database_path, metadata_path))

    complete.sort(key=lambda item: (item[0], item[2].name))
    manual = [item for item in complete if item[1] == "manual"]
    safety = [item for item in complete if item[1] == "pre_restore_auto"]
    candidates = manual[: max(0, len(manual) - retention_count)] + safety[: max(0, len(safety) - 1)]
    removals = [item for item in candidates if item[2].name != preserve_filename]
    removed: list[str] = []
    for _, _, database_path, metadata_path in removals:
        # Remove metadata first: an interrupted deletion may leave an unlisted database
        # file, but must never leave metadata advertising a database that no longer exists.
        metadata_path.unlink(missing_ok=True)
        database_path.unlink(missing_ok=True)
        removed.append(database_path.name)
    return removed


def _available_filename(backup_dir: Path, timestamp: datetime) -> tuple[Path, Path]:
    stem = "backup_" + timestamp.astimezone(UTC).strftime("%Y-%m-%dT%H-%M-%SZ")
    suffix = 0
    while True:
        collision = "" if suffix == 0 else f"_{suffix}"
        database_path = backup_dir / f"{stem}{collision}.sqlite3"
        metadata_path = Path(str(database_path) + ".meta.json")
        if not database_path.exists() and not metadata_path.exists():
            return database_path, metadata_path
        suffix += 1


def create_backup(
    *,
    database_url: str,
    backup_dir: str,
    retention_count: int = 10,
    min_free_mb: int = 100,
    trigger: str = "manual",
    preserve_filename: str | None = None,
) -> dict[str, Any]:
    """Create, validate, publish, and retain a consistent manual SQLite snapshot."""
    with BACKUP_OPERATION_LOCK:
        if trigger not in {"manual", "scheduled", "pre_restore_auto"}:
            raise BackupError("Unsupported backup trigger.")
        source_path = resolve_sqlite_database_path(database_url)
        if not source_path.is_file():
            raise BackupError("Configured SQLite database file does not exist.")
        target_dir = resolve_backup_directory(backup_dir)
        target_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(target_dir, 0o700)

        source_size = source_path.stat().st_size
        minimum_free_bytes = min_free_mb * 1024 * 1024
        required_free_bytes = minimum_free_bytes + source_size
        available_bytes = shutil.disk_usage(target_dir).free
        if available_bytes < required_free_bytes:
            raise BackupError(
                "Insufficient free disk space for backup "
                f"(required {required_free_bytes} bytes, available {available_bytes} bytes)."
            )

        created = _utc_now()
        final_database, final_metadata = _available_filename(target_dir, created)
        token = uuid.uuid4().hex
        temporary_database = target_dir / f".{final_database.name}.{token}.tmp"
        temporary_metadata = target_dir / f".{final_metadata.name}.{token}.tmp"
        published_database = False

        try:
            source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
            destination = sqlite3.connect(temporary_database)
            try:
                source_tables = read_tables(source)
                source.backup(destination)
            finally:
                destination.close()
                source.close()

            os.chmod(temporary_database, 0o600)
            validate_backup(temporary_database, source_tables)
            checksum = calculate_sha256(temporary_database)
            metadata: dict[str, Any] = {
                "created_at": created.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
                "trigger": trigger,
                "schema_version": "unknown",
                "sqlite_file_size_bytes": temporary_database.stat().st_size,
                "sha256": checksum,
                "source_db_path": source_path.name,
                "backup_tool_version": BACKUP_TOOL_VERSION,
            }
            temporary_metadata.write_text(
                json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )
            os.chmod(temporary_metadata, 0o600)

            temporary_database.replace(final_database)
            published_database = True
            temporary_metadata.replace(final_metadata)
            apply_retention(target_dir, retention_count, preserve_filename)
            return {"filename": final_database.name, **metadata}
        except BackupError:
            raise
        except (OSError, sqlite3.Error, ValueError) as exc:
            raise BackupError(f"Backup creation failed: {exc.__class__.__name__}.") from exc
        finally:
            temporary_database.unlink(missing_ok=True)
            temporary_metadata.unlink(missing_ok=True)
            if published_database and not final_metadata.exists():
                final_database.unlink(missing_ok=True)
