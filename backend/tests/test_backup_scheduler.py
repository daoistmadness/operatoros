import json
import sqlite3
import threading
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from core.database import Base
from models.backup_operation import BackupExecutionHistory, BackupSchedulerConfig
from services import backup_scheduler as scheduler


@pytest.fixture
def scheduler_context(tmp_path, monkeypatch):
    database = tmp_path / "live.db"
    connection = sqlite3.connect(database)
    connection.executescript("""
    CREATE TABLE attendance(id INTEGER PRIMARY KEY);
    CREATE TABLE attendance_override_history(id INTEGER PRIMARY KEY);
    CREATE TABLE student_enrollments(id INTEGER PRIMARY KEY);
    """)
    connection.close()
    history_database = tmp_path / "history.db"
    engine = create_engine(f"sqlite:///{history_database}")
    Base.metadata.create_all(engine, tables=[BackupSchedulerConfig.__table__, BackupExecutionHistory.__table__])
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr(scheduler.settings, "DATABASE_URL", f"sqlite:///{database}")
    monkeypatch.setattr(scheduler.settings, "BACKUP_DIR", str(tmp_path / "backups"))
    monkeypatch.setattr(scheduler.settings, "BACKUP_MIN_FREE_MB", 0)
    return tmp_path, factory


def test_successful_scheduled_execution_is_verified_and_persisted(scheduler_context):
    tmp_path, factory = scheduler_context
    result = scheduler.execute_backup("SCHEDULED", db_factory=factory)
    assert result.status == "SUCCESS" and result.integrity_verified is True
    assert (tmp_path / "backups" / result.backup_filename).is_file()
    with factory() as db:
        stored = db.get(BackupExecutionHistory, result.id)
        assert stored.status == "SUCCESS" and stored.duration_seconds >= 0
    assert '"event": "backup_succeeded"' in (tmp_path / "backups" / scheduler.OPERATIONS_AUDIT_FILENAME).read_text()


def test_failed_execution_is_recorded(scheduler_context, monkeypatch):
    _, factory = scheduler_context
    monkeypatch.setattr(scheduler, "create_backup", lambda **_: (_ for _ in ()).throw(RuntimeError("forced failure")))
    result = scheduler.execute_backup("SCHEDULED", db_factory=factory)
    assert result.status == "FAILED" and "forced failure" in result.error_message


def test_execution_lock_rejects_overlap(scheduler_context):
    _, factory = scheduler_context
    assert scheduler.EXECUTION_LOCK.acquire(blocking=False)
    try:
        result = scheduler.execute_backup("SCHEDULED", db_factory=factory)
    finally:
        scheduler.EXECUTION_LOCK.release()
    assert result.status == "FAILED" and "already active" in result.error_message


def test_tiered_retention_preserves_newest_bucket(scheduler_context):
    tmp_path, factory = scheduler_context
    directory = tmp_path / "backups"
    directory.mkdir()
    for day in (1, 2, 3):
        filename = f"backup_2026-01-0{day}T00-00-00Z.sqlite3"
        (directory / filename).write_bytes(b"valid-complete-artifact")
        Path(str(directory / filename) + ".meta.json").write_text(json.dumps({"trigger":"scheduled","created_at":f"2026-01-0{day}T00:00:00Z"}))
    with factory() as db:
        config = scheduler.get_or_create_config(db)
        config.keep_daily = 1; config.keep_weekly = 0; config.keep_monthly = 0
        db.commit()
        removed = scheduler.apply_tiered_retention(config)
    assert len(removed) == 2
    assert (directory / "backup_2026-01-03T00-00-00Z.sqlite3").exists()


def test_scheduler_start_and_shutdown(monkeypatch):
    instance = scheduler.BackupScheduler(poll_seconds=0.01)
    entered = threading.Event()
    def loop():
        entered.set(); instance._stop.wait()
    monkeypatch.setattr(instance, "_loop", loop)
    monkeypatch.setattr(scheduler.settings, "BACKEND_WORKERS", 1)
    instance.start()
    assert entered.wait(1) and instance.running
    instance.stop(timeout=1)
    assert not instance.running


def test_next_run_persists_from_config():
    config = BackupSchedulerConfig(schedule_type="interval", interval_minutes=30)
    now = datetime(2026, 7, 14, tzinfo=UTC)
    assert scheduler.calculate_next_run(config, now).isoformat() == "2026-07-14T00:30:00+00:00"
