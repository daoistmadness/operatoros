from __future__ import annotations

import json
import logging
import os
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from core.config import settings
from core.database import SessionLocal
from models.backup_operation import BackupExecutionHistory, BackupSchedulerConfig
from services.backup_service import BackupError, create_backup, resolve_backup_directory

logger = logging.getLogger(__name__)
OPERATIONS_AUDIT_FILENAME = "backup_operations_audit.jsonl"
EXECUTION_LOCK = threading.Lock()


def utc_now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def append_operations_audit(event: str, metadata: dict[str, Any]) -> None:
    directory = resolve_backup_directory(settings.BACKUP_DIR)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = directory / OPERATIONS_AUDIT_FILENAME
    payload = json.dumps({"timestamp": utc_now().isoformat().replace("+00:00", "Z"), "event": event, "metadata": metadata}, sort_keys=True) + "\n"
    descriptor = os.open(path, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o600)
    try:
        os.write(descriptor, payload.encode("utf-8"))
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _safe_audit(event: str, metadata: dict[str, Any]) -> None:
    try:
        append_operations_audit(event, metadata)
    except OSError:
        logger.exception("Backup operations audit could not be persisted")


def get_or_create_config(db: Session) -> BackupSchedulerConfig:
    config = db.get(BackupSchedulerConfig, 1)
    if config is None:
        config = BackupSchedulerConfig(id=1)
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


def calculate_next_run(config: BackupSchedulerConfig, now: datetime | None = None) -> datetime:
    now = _aware(now) or utc_now()
    if config.schedule_type == "interval":
        return now + timedelta(minutes=config.interval_minutes)
    candidate = now.replace(hour=config.hour_utc, minute=config.minute_utc, second=0, microsecond=0)
    if config.schedule_type == "weekly":
        candidate += timedelta(days=(config.weekday_utc - candidate.weekday()) % 7)
        if candidate <= now:
            candidate += timedelta(days=7)
    elif candidate <= now:
        candidate += timedelta(days=1)
    return candidate


def apply_tiered_retention(config: BackupSchedulerConfig, preserve_filename: str | None = None) -> list[str]:
    directory = resolve_backup_directory(settings.BACKUP_DIR)
    entries: list[tuple[datetime, Path, Path]] = []
    for metadata_path in directory.glob("backup_*.sqlite3.meta.json"):
        database_path = Path(str(metadata_path)[:-len(".meta.json")])
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            if metadata.get("trigger") != "scheduled" or not database_path.is_file():
                continue
            created = datetime.fromisoformat(metadata["created_at"].replace("Z", "+00:00")).astimezone(UTC)
            entries.append((created, database_path, metadata_path))
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            continue
    entries.sort(key=lambda row: row[0], reverse=True)

    def newest_buckets(key, limit: int) -> set[str]:
        buckets: list[str] = []
        for created, _, _ in entries:
            bucket = key(created)
            if bucket not in buckets:
                buckets.append(bucket)
        return set(buckets[:limit])

    daily = newest_buckets(lambda value: value.strftime("%Y-%m-%d"), config.keep_daily)
    weekly = newest_buckets(lambda value: f"{value.isocalendar().year}-W{value.isocalendar().week:02d}", config.keep_weekly)
    monthly = newest_buckets(lambda value: value.strftime("%Y-%m"), config.keep_monthly)
    removed: list[str] = []
    for created, database_path, metadata_path in entries:
        keep = (
            created.strftime("%Y-%m-%d") in daily
            or f"{created.isocalendar().year}-W{created.isocalendar().week:02d}" in weekly
            or created.strftime("%Y-%m") in monthly
            or database_path.name == preserve_filename
        )
        if not keep:
            metadata_path.unlink(missing_ok=True)
            database_path.unlink(missing_ok=True)
            removed.append(database_path.name)
    return removed


def execute_backup(trigger_type: str, *, db_factory=SessionLocal) -> BackupExecutionHistory:
    if trigger_type not in {"MANUAL", "SCHEDULED"}:
        raise ValueError("Unsupported backup execution trigger")
    db = db_factory()
    history = BackupExecutionHistory(trigger_type=trigger_type, status="PENDING", started_at=utc_now())
    db.add(history)
    db.commit()
    db.refresh(history)
    if not EXECUTION_LOCK.acquire(blocking=False):
        history.status = "FAILED"
        history.completed_at = utc_now()
        history.duration_seconds = 0.0
        history.error_message = "Another backup execution is already active."
        db.commit()
        _safe_audit("backup_lock_rejected", {"execution_id": history.id, "trigger_type": trigger_type})
        db.close()
        return history
    try:
        history.status = "RUNNING"
        db.commit()
        _safe_audit("backup_started", {"execution_id": history.id, "trigger_type": trigger_type})
        result = create_backup(
            database_url=settings.database_url,
            backup_dir=settings.BACKUP_DIR,
            retention_count=settings.BACKUP_RETENTION_COUNT,
            min_free_mb=settings.BACKUP_MIN_FREE_MB,
            trigger=trigger_type.lower(),
        )
        config = get_or_create_config(db)
        removed = apply_tiered_retention(config, result["filename"]) if trigger_type == "SCHEDULED" else []
        history.status = "SUCCESS"
        history.backup_filename = result["filename"]
        history.size_bytes = result["sqlite_file_size_bytes"]
        history.checksum = result["sha256"]
        history.integrity_verified = True
        history.removed_backups_json = json.dumps(removed)
        _safe_audit("backup_succeeded", {"execution_id": history.id, "filename": result["filename"], "removed": removed})
    except Exception as exc:
        history.status = "FAILED"
        history.error_message = str(exc)[:2000]
        _safe_audit("backup_failed", {"execution_id": history.id, "error": exc.__class__.__name__})
    finally:
        history.completed_at = utc_now()
        history.duration_seconds = max(0.0, (history.completed_at - _aware(history.started_at)).total_seconds())
        db.commit()
        db.refresh(history)
        EXECUTION_LOCK.release()
        db.expunge(history)
        db.close()
    return history


class BackupScheduler:
    def __init__(self, *, poll_seconds: float = 30.0):
        self.poll_seconds = poll_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self.running or settings.BACKEND_WORKERS != 1:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="astryx-backup-scheduler", daemon=True)
        self._thread.start()

    def stop(self, timeout: float | None = None) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=timeout)
        self._thread = None

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                with SessionLocal() as db:
                    config = get_or_create_config(db)
                    now = utc_now()
                    next_run = _aware(config.next_run_at)
                    if config.enabled and (next_run is None or next_run <= now):
                        config.next_run_at = calculate_next_run(config, now)
                        db.commit()
                        execute_backup("SCHEDULED")
            except Exception:
                logger.exception("Scheduled backup loop failed")
            self._stop.wait(self.poll_seconds)


backup_scheduler = BackupScheduler()
