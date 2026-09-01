"""S4.5 migration adds explicit attendance-calendar authority only."""

import sqlite3
import os
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from core.attendance_calendar_migration import migrate_attendance_calendar_sqlite, schema_fingerprint


def _s44_database(path: Path) -> None:
    with sqlite3.connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE operatoros_schema_migrations (
              version TEXT PRIMARY KEY, predecessor TEXT, schema_fingerprint TEXT NOT NULL,
              protected_fingerprints TEXT NOT NULL, approved_by TEXT NOT NULL, applied_at TEXT NOT NULL
            );
            CREATE TABLE academic_years (id INTEGER PRIMARY KEY, start_date TEXT, end_date TEXT);
            CREATE TABLE jenjangs (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE student_masters (id TEXT PRIMARY KEY, full_name TEXT);
            CREATE TABLE student_device_identities (id INTEGER PRIMARY KEY, student_master_id TEXT);
            CREATE TABLE attendance (id INTEGER PRIMARY KEY, student_id INTEGER, date TEXT);
            CREATE TABLE student_enrollments (id INTEGER PRIMARY KEY, student_id INTEGER, student_master_id TEXT);
            INSERT INTO operatoros_schema_migrations VALUES ('20260831_s44', '20260725_s43', 's44-fingerprint', '{}', 'TEST', '2026-08-31T10:00:00+00:00');
            INSERT INTO academic_years VALUES (1, '2026-07-01', '2027-06-30');
            INSERT INTO jenjangs VALUES (1, 'SMP');
            INSERT INTO students VALUES (1, 'fixture');
            """
        )


def test_migration_adds_calendar_tables_and_is_idempotent(tmp_path: Path) -> None:
    database = tmp_path / "s44.db"
    _s44_database(database)

    assert migrate_attendance_calendar_sqlite(database) == "MIGRATION_COMPLETE"
    with sqlite3.connect(database) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert {"attendance_calendar_weekday_rules", "attendance_calendar_exceptions"} <= tables
        connection.execute("INSERT INTO attendance_calendar_weekday_rules (academic_year_id, jenjang_id, weekday, expectation) VALUES (1, 1, 1, 'EXPECTED')")
        connection.execute("INSERT INTO attendance_calendar_exceptions (academic_year_id, jenjang_id, date, expectation, reason, created_by) VALUES (1, 1, '2026-08-17', 'NOT_EXPECTED', 'HOLIDAY', 'test')")
        assert connection.execute("SELECT COUNT(*) FROM attendance").fetchone() == (0,)
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert schema_fingerprint(connection) == connection.execute("SELECT schema_fingerprint FROM operatoros_schema_migrations WHERE version = '20260901_s45'").fetchone()[0]

    assert migrate_attendance_calendar_sqlite(database) == "MIGRATION_ALREADY_CURRENT"
