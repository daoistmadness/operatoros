import hashlib
import json
import sqlite3
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from services import backup_service
from services.backup_service import BackupError, create_backup, resolve_backup_directory, resolve_sqlite_database_path


def _database(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA wal_autocheckpoint=0")
    connection.executescript(
        """
        CREATE TABLE attendance (id INTEGER PRIMARY KEY, status TEXT);
        CREATE TABLE attendance_override_history (id INTEGER PRIMARY KEY, note TEXT);
        CREATE TABLE student_enrollments (id INTEGER PRIMARY KEY, student_id INTEGER);
        CREATE TABLE student_subject_grades (id INTEGER PRIMARY KEY, score REAL);
        """
    )
    connection.execute("INSERT INTO attendance (status) VALUES ('hadir')")
    connection.execute("INSERT INTO attendance_override_history (note) VALUES ('created')")
    connection.execute("INSERT INTO student_enrollments (student_id) VALUES (101)")
    connection.execute("INSERT INTO student_subject_grades (score) VALUES (87.5)")
    connection.commit()
    return connection


@pytest.fixture
def source_database(tmp_path):
    path = tmp_path / "attendance.db"
    connection = _database(path)
    yield path, connection
    connection.close()


def _create(source: Path, directory: Path, **overrides):
    return create_backup(
        database_url=f"sqlite:///{source}",
        backup_dir=str(directory),
        retention_count=overrides.get("retention_count", 10),
        min_free_mb=overrides.get("min_free_mb", 0),
    )


def test_backup_creates_valid_sqlite_file_and_metadata(source_database, tmp_path):
    source, _ = source_database
    backup_dir = tmp_path / "backups"
    result = _create(source, backup_dir)
    database_path = backup_dir / result["filename"]
    metadata_path = Path(str(database_path) + ".meta.json")

    assert database_path.is_file()
    assert metadata_path.is_file()
    assert sqlite3.connect(database_path).execute("PRAGMA integrity_check").fetchone() == ("ok",)
    assert json.loads(metadata_path.read_text(encoding="utf-8"))["source_db_path"] == "attendance.db"
    assert str(source.resolve()) not in metadata_path.read_text(encoding="utf-8")


def test_sha256_matches_actual_backup(source_database, tmp_path):
    source, _ = source_database
    result = _create(source, tmp_path / "backups")
    body = (tmp_path / "backups" / result["filename"]).read_bytes()
    assert result["sha256"] == hashlib.sha256(body).hexdigest()


def test_wal_mode_committed_data_is_in_consistent_snapshot(source_database, tmp_path):
    source, writer = source_database
    writer.execute("INSERT INTO attendance (status) VALUES ('izin')")
    writer.commit()
    assert Path(str(source) + "-wal").stat().st_size > 0

    result = _create(source, tmp_path / "backups")
    backup = sqlite3.connect(tmp_path / "backups" / result["filename"])
    try:
        assert backup.execute("SELECT status FROM attendance ORDER BY id").fetchall() == [("hadir",), ("izin",)]
        assert backup.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    finally:
        backup.close()


def test_backup_contains_required_operational_and_grade_tables(source_database, tmp_path):
    source, _ = source_database
    result = _create(source, tmp_path / "backups")
    connection = sqlite3.connect(tmp_path / "backups" / result["filename"])
    try:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        connection.close()
    assert backup_service.REQUIRED_OPERATIONAL_TABLES <= tables
    assert "student_subject_grades" in tables


def test_retention_uses_metadata_time_and_removes_complete_oldest_pair(source_database, tmp_path, monkeypatch):
    source, _ = source_database
    backup_dir = tmp_path / "backups"
    start = datetime(2026, 7, 13, 4, 30, tzinfo=UTC)
    moments = iter([start, start + timedelta(minutes=1), start + timedelta(minutes=2)])
    monkeypatch.setattr(backup_service, "_utc_now", lambda: next(moments))

    first = _create(source, backup_dir, retention_count=2)
    second = _create(source, backup_dir, retention_count=2)
    third = _create(source, backup_dir, retention_count=2)

    assert not (backup_dir / first["filename"]).exists()
    assert not Path(str(backup_dir / first["filename"]) + ".meta.json").exists()
    assert (backup_dir / second["filename"]).exists()
    assert (backup_dir / third["filename"]).exists()
    assert len(list(backup_dir.glob("*.sqlite3"))) == 2
    assert len(list(backup_dir.glob("*.meta.json"))) == 2


def test_retention_removes_orphan_metadata(source_database, tmp_path):
    source, _ = source_database
    backup_dir = tmp_path / "backups"
    _create(source, backup_dir)
    orphan = backup_dir / "backup_2000-01-01T00-00-00Z.sqlite3.meta.json"
    orphan.write_text('{"created_at":"2000-01-01T00:00:00Z"}', encoding="utf-8")
    backup_service.apply_retention(backup_dir, 10)
    assert not orphan.exists()


def test_disk_space_refusal_leaves_no_partial_files(source_database, tmp_path, monkeypatch):
    source, _ = source_database
    backup_dir = tmp_path / "backups"
    usage = shutil_usage = type("Usage", (), {"total": 100, "used": 99, "free": 1})()
    monkeypatch.setattr(backup_service.shutil, "disk_usage", lambda _: usage)

    with pytest.raises(BackupError, match="Insufficient free disk space"):
        _create(source, backup_dir, min_free_mb=1)
    assert not list(backup_dir.glob("*"))


def test_filename_collision_never_overwrites(source_database, tmp_path, monkeypatch):
    source, writer = source_database
    backup_dir = tmp_path / "backups"
    fixed = datetime(2026, 7, 13, 4, 30, tzinfo=UTC)
    monkeypatch.setattr(backup_service, "_utc_now", lambda: fixed)
    first = _create(source, backup_dir)
    writer.execute("INSERT INTO attendance (status) VALUES ('alfa')")
    writer.commit()
    second = _create(source, backup_dir)

    assert first["filename"] == "backup_2026-07-13T04-30-00Z.sqlite3"
    assert second["filename"] == "backup_2026-07-13T04-30-00Z_1.sqlite3"
    assert (backup_dir / first["filename"]).read_bytes() != (backup_dir / second["filename"]).read_bytes()


def test_backup_directory_rejects_traversal_and_web_directories(tmp_path):
    with pytest.raises(BackupError, match="traversal"):
        resolve_backup_directory("../backups", project_root=tmp_path)
    with pytest.raises(BackupError, match="web-served"):
        resolve_backup_directory(str(tmp_path / "frontend" / "public"), project_root=tmp_path)


def test_sqlite_only_boundary_rejects_postgresql():
    with pytest.raises(BackupError, match="SQLite databases only"):
        resolve_sqlite_database_path("postgresql://user:secret@localhost/school")


def test_canonical_sqlite_path_resolution_is_absolute(tmp_path):
    resolved = resolve_sqlite_database_path("sqlite:///./attendance.db", cwd=tmp_path)
    assert resolved == (tmp_path / "attendance.db").resolve()
    assert resolved.is_absolute()
