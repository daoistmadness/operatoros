"""S4.4 migration preserves historical grade rows without inventing periods."""

from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from core.academic_timeline_migration import migrate_academic_timeline_sqlite, schema_fingerprint  # noqa: E402


def _s43_database(path: Path) -> None:
    with sqlite3.connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE operatoros_schema_migrations (
              version TEXT PRIMARY KEY, predecessor TEXT, schema_fingerprint TEXT NOT NULL,
              protected_fingerprints TEXT NOT NULL, approved_by TEXT NOT NULL, applied_at TEXT NOT NULL
            );
            CREATE TABLE academic_years (id INTEGER PRIMARY KEY, start_date TEXT, end_date TEXT);
            CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE student_masters (id TEXT PRIMARY KEY, full_name TEXT);
            CREATE TABLE student_device_identities (id INTEGER PRIMARY KEY, student_master_id TEXT, legacy_student_id INTEGER);
            CREATE TABLE attendance (id INTEGER PRIMARY KEY, student_id INTEGER, date TEXT);
            CREATE TABLE student_enrollments (id INTEGER PRIMARY KEY, student_id INTEGER, student_master_id TEXT, academic_year_id INTEGER);
            CREATE TABLE subjects (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE assessment_components (id INTEGER PRIMARY KEY, name TEXT, assessment_type TEXT);
            CREATE TABLE student_subject_grades (
              id INTEGER PRIMARY KEY, enrollment_id INTEGER NOT NULL, subject_id INTEGER NOT NULL,
              component_id INTEGER NOT NULL, score REAL, created_at TEXT, updated_at TEXT,
              UNIQUE (enrollment_id, subject_id, component_id)
            );
            INSERT INTO academic_years VALUES (1, '2026-07-01', '2027-06-30');
            INSERT INTO students VALUES (1, 'fixture-only');
            INSERT INTO student_masters VALUES ('master-1', 'fixture-only');
            INSERT INTO student_device_identities VALUES (1, 'master-1', 1);
            INSERT INTO attendance VALUES (1, 1, '2026-08-15');
            INSERT INTO student_enrollments VALUES (1, 1, 'master-1', 1);
            INSERT INTO subjects VALUES (1, 'Mathematics');
            INSERT INTO assessment_components VALUES (1, 'Exam', 'sumatif');
            INSERT INTO student_subject_grades VALUES (1, 1, 1, 1, 76.5, '2026-08-20T10:00:00', '2026-08-20T10:00:00');
            INSERT INTO operatoros_schema_migrations VALUES ('20260725_s43', '20260724_s42', 's43-fingerprint', '{}', 'TEST', '2026-08-21T10:00:00+00:00');
            """
        )


def test_migration_preserves_legacy_grade_values_and_is_idempotent(tmp_path: Path) -> None:
    database = tmp_path / "s43.db"
    _s43_database(database)

    assert migrate_academic_timeline_sqlite(database) == "MIGRATION_COMPLETE"
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT version FROM operatoros_schema_migrations ORDER BY applied_at DESC LIMIT 1").fetchone() == ("20260831_s44",)
        assert connection.execute("SELECT id, enrollment_id, subject_id, component_id, assessment_session_id, score, created_at, updated_at FROM student_subject_grades").fetchall() == [(1, 1, 1, 1, None, 76.5, "2026-08-20T10:00:00", "2026-08-20T10:00:00")]
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert schema_fingerprint(connection) == connection.execute("SELECT schema_fingerprint FROM operatoros_schema_migrations WHERE version = '20260831_s44'").fetchone()[0]

    assert migrate_academic_timeline_sqlite(database) == "MIGRATION_ALREADY_CURRENT"
