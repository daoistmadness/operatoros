"""S4.6 migration adds only explicit attendance submission deadline policy."""

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from core.attendance_submission_deadline_migration import migrate_attendance_submission_deadline_sqlite, schema_fingerprint


def _s45_database(path: Path) -> None:
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
            INSERT INTO operatoros_schema_migrations VALUES ('20260901_s45', '20260831_s44', 's45-fingerprint', '{}', 'TEST', '2026-08-31T10:00:00+00:00');
            INSERT INTO academic_years VALUES (1, '2026-07-01', '2027-06-30');
            INSERT INTO jenjangs VALUES (1, 'SMP');
            """
        )


def test_migration_preserves_data_and_is_idempotent(tmp_path: Path) -> None:
    database = tmp_path / "s45.db"
    _s45_database(database)
    assert migrate_attendance_submission_deadline_sqlite(database) == "MIGRATION_COMPLETE"
    with sqlite3.connect(database) as connection:
        connection.execute("INSERT INTO attendance_submission_deadlines (academic_year_id, jenjang_id, cutoff_time) VALUES (1, 1, '08:00')")
        assert connection.execute("SELECT cutoff_time FROM attendance_submission_deadlines").fetchone() == ("08:00",)
        assert connection.execute("SELECT COUNT(*) FROM attendance").fetchone() == (0,)
        assert schema_fingerprint(connection) == connection.execute("SELECT schema_fingerprint FROM operatoros_schema_migrations WHERE version = '20260901_s46'").fetchone()[0]
        connection.commit()
    assert migrate_attendance_submission_deadline_sqlite(database) == "MIGRATION_ALREADY_CURRENT"
