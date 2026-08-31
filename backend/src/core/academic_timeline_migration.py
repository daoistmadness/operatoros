"""Explicit S4.4 academic-assessment timeline migration for isolated SQLite databases."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from core.database_access_context import protected_path_is_permitted
from core.schema_guard import LEDGER_TABLE

S44_VERSION = "20260831_s44"
S44_PREDECESSOR = "20260725_s43"
ROOT = Path(__file__).resolve().parents[3]
PROTECTED_DATABASES = {
    (ROOT / "backend" / "attendance.db").resolve(),
    (ROOT / "attendance.db").resolve(),
}


def monotonic_applied_at(connection: sqlite3.Connection) -> str:
    proposed = datetime.now(timezone.utc)
    previous = connection.execute(f"SELECT MAX(applied_at) FROM {LEDGER_TABLE}").fetchone()[0]
    if previous:
        previous_timestamp = datetime.fromisoformat(previous)
        if proposed <= previous_timestamp:
            proposed = previous_timestamp + timedelta(microseconds=1)
    return proposed.isoformat()


def schema_fingerprint(connection: sqlite3.Connection) -> str:
    objects = connection.execute(
        "SELECT type,name,tbl_name,COALESCE(sql,'') FROM sqlite_master "
        "WHERE name NOT LIKE 'sqlite_%' AND name != ? ORDER BY type,name",
        (LEDGER_TABLE,),
    ).fetchall()
    return hashlib.sha256(repr(objects).encode("utf-8")).hexdigest()


def grade_rows_fingerprint(connection: sqlite3.Connection) -> dict[str, object]:
    columns = ("id", "enrollment_id", "subject_id", "component_id", "score", "created_at", "updated_at")
    order = ", ".join(f'"{column}"' for column in columns)
    values = connection.execute(f"SELECT {order} FROM student_subject_grades ORDER BY {order}").fetchall()
    return {"count": len(values), "sha256": hashlib.sha256(repr(values).encode("utf-8")).hexdigest()}


def migrate_academic_timeline_sqlite(path: Path) -> str:
    source = path.resolve(strict=True)
    if source in PROTECTED_DATABASES and not protected_path_is_permitted(source):
        raise RuntimeError("PROTECTED_DATABASE_PATH_REJECTED")
    temporary = source.with_name(f".{source.name}.s44-migrating")
    if temporary.exists():
        temporary.unlink()
    with sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True) as src, sqlite3.connect(temporary) as dst:
        src.backup(dst)
    shutil.copystat(source, temporary)
    try:
        connection = sqlite3.connect(temporary)
        connection.execute("PRAGMA journal_mode=DELETE")
        current = connection.execute(
            f"SELECT version,schema_fingerprint FROM {LEDGER_TABLE} ORDER BY applied_at DESC,version DESC LIMIT 1"
        ).fetchone()
        if current and current[0] == S44_VERSION:
            if schema_fingerprint(connection) != current[1]:
                raise RuntimeError("DATABASE_MIGRATION_CHECKSUM_MISMATCH")
            connection.close()
            temporary.unlink()
            return "MIGRATION_ALREADY_CURRENT"
        if not current or current[0] != S44_PREDECESSOR:
            raise RuntimeError(f"UNSUPPORTED_SCHEMA: {S44_PREDECESSOR} predecessor required")
        required_grade_columns = {row[1] for row in connection.execute("PRAGMA table_info(student_subject_grades)")}
        if "assessment_session_id" in required_grade_columns:
            raise RuntimeError("MIGRATION_VALIDATION_FAILED: timeline column already exists without S4.4 ledger")
        protected_before = {
            table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("students", "student_masters", "student_device_identities", "attendance", "student_enrollments")
        }
        grades_before = grade_rows_fingerprint(connection)
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.executescript(
            """
            CREATE TABLE academic_assessment_sessions (
              id INTEGER NOT NULL PRIMARY KEY,
              academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
              term_number INTEGER NOT NULL,
              label VARCHAR(120) NOT NULL,
              assessment_date DATE,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              CONSTRAINT ck_academic_assessment_term_number CHECK (term_number >= 1 AND term_number <= 4)
            );
            CREATE INDEX ix_academic_assessment_sessions_academic_year_id
              ON academic_assessment_sessions (academic_year_id);

            CREATE TABLE student_subject_grades_timeline_new (
              id INTEGER NOT NULL PRIMARY KEY,
              enrollment_id INTEGER NOT NULL REFERENCES student_enrollments(id) ON DELETE RESTRICT,
              subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
              component_id INTEGER NOT NULL REFERENCES assessment_components(id) ON DELETE RESTRICT,
              assessment_session_id INTEGER REFERENCES academic_assessment_sessions(id) ON DELETE RESTRICT,
              score FLOAT,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        connection.execute(
            "INSERT INTO student_subject_grades_timeline_new "
            "(id,enrollment_id,subject_id,component_id,assessment_session_id,score,created_at,updated_at) "
            "SELECT id,enrollment_id,subject_id,component_id,NULL,score,created_at,updated_at "
            "FROM student_subject_grades ORDER BY id"
        )
        connection.execute("DROP TABLE student_subject_grades")
        connection.execute("ALTER TABLE student_subject_grades_timeline_new RENAME TO student_subject_grades")
        connection.executescript(
            """
            CREATE INDEX ix_student_subject_grades_enrollment_id
              ON student_subject_grades (enrollment_id);
            CREATE INDEX ix_student_subject_grades_subject_id
              ON student_subject_grades (subject_id);
            CREATE INDEX ix_student_subject_grades_component_id
              ON student_subject_grades (component_id);
            CREATE INDEX ix_student_subject_grades_assessment_session_id
              ON student_subject_grades (assessment_session_id);
            CREATE UNIQUE INDEX uq_student_subject_grades_legacy_slot
              ON student_subject_grades (enrollment_id, subject_id, component_id)
              WHERE assessment_session_id IS NULL;
            CREATE UNIQUE INDEX uq_student_subject_grades_session_slot
              ON student_subject_grades (enrollment_id, subject_id, component_id, assessment_session_id)
              WHERE assessment_session_id IS NOT NULL;
            """
        )
        for table, expected in protected_before.items():
            actual = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            if actual != expected:
                raise RuntimeError(f"MIGRATION_VALIDATION_FAILED: {table} count changed")
        if grade_rows_fingerprint(connection) != grades_before:
            raise RuntimeError("MIGRATION_VALIDATION_FAILED: grade values changed")
        if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise RuntimeError("MIGRATION_VALIDATION_FAILED: integrity check")
        if connection.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("MIGRATION_VALIDATION_FAILED: foreign keys")
        connection.execute("PRAGMA foreign_keys=ON")
        fingerprint = schema_fingerprint(connection)
        with connection:
            connection.execute(
                f"INSERT INTO {LEDGER_TABLE} "
                "(version,predecessor,schema_fingerprint,protected_fingerprints,approved_by,applied_at) "
                "VALUES (?,?,?,?,?,?)",
                (
                    S44_VERSION,
                    S44_PREDECESSOR,
                    fingerprint,
                    json.dumps({"protected_counts": protected_before, "student_subject_grades": grades_before}, sort_keys=True, separators=(",", ":")),
                    "S44_MIGRATION",
                    monotonic_applied_at(connection),
                ),
            )
        connection.close()
        os.replace(temporary, source)
        return "MIGRATION_COMPLETE"
    except Exception:
        if temporary.exists():
            temporary.unlink()
        raise
