"""Explicit S4.5 attendance-calendar authority migration for isolated SQLite databases."""

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

S45_VERSION = "20260901_s45"
S45_PREDECESSOR = "20260831_s44"
ROOT = Path(__file__).resolve().parents[3]
PROTECTED_DATABASES = {
    (ROOT / "backend" / "attendance.db").resolve(),
    (ROOT / "attendance.db").resolve(),
}


def _monotonic_applied_at(connection: sqlite3.Connection) -> str:
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


def migrate_attendance_calendar_sqlite(path: Path) -> str:
    source = path.resolve(strict=True)
    if source in PROTECTED_DATABASES and not protected_path_is_permitted(source):
        raise RuntimeError("PROTECTED_DATABASE_PATH_REJECTED")
    temporary = source.with_name(f".{source.name}.s45-migrating")
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
        if current and current[0] == S45_VERSION:
            if schema_fingerprint(connection) != current[1]:
                raise RuntimeError("DATABASE_MIGRATION_CHECKSUM_MISMATCH")
            connection.close()
            temporary.unlink()
            return "MIGRATION_ALREADY_CURRENT"
        if not current or current[0] != S45_PREDECESSOR:
            raise RuntimeError(f"UNSUPPORTED_SCHEMA: {S45_PREDECESSOR} predecessor required")

        protected_before = {
            table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("students", "student_masters", "student_device_identities", "attendance", "student_enrollments")
        }
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.executescript(
            """
            CREATE TABLE attendance_calendar_weekday_rules (
              id INTEGER NOT NULL PRIMARY KEY,
              academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
              jenjang_id INTEGER NOT NULL REFERENCES jenjangs(id) ON DELETE RESTRICT,
              weekday INTEGER NOT NULL,
              expectation VARCHAR(16) NOT NULL,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              CONSTRAINT ck_attendance_calendar_weekday CHECK (weekday >= 0 AND weekday <= 6),
              CONSTRAINT ck_attendance_calendar_weekday_expectation CHECK (expectation IN ('EXPECTED','NOT_EXPECTED')),
              CONSTRAINT _attendance_calendar_weekday_uc UNIQUE (academic_year_id, jenjang_id, weekday)
            );
            CREATE TABLE attendance_calendar_exceptions (
              id INTEGER NOT NULL PRIMARY KEY,
              academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
              jenjang_id INTEGER NOT NULL REFERENCES jenjangs(id) ON DELETE RESTRICT,
              date DATE NOT NULL,
              expectation VARCHAR(16) NOT NULL,
              reason VARCHAR(40) NOT NULL,
              created_by VARCHAR(255) NOT NULL,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              CONSTRAINT ck_attendance_calendar_exception_expectation CHECK (expectation IN ('EXPECTED','NOT_EXPECTED')),
              CONSTRAINT ck_attendance_calendar_exception_reason CHECK (reason IN ('HOLIDAY','SCHOOL_BREAK','SCHOOL_CLOSED','NON_INSTRUCTIONAL_DAY','PROGRAM_NOT_IN_SESSION','REPLACEMENT_SCHOOL_DAY','SPECIAL_INSTRUCTIONAL_DAY')),
              CONSTRAINT _attendance_calendar_exception_uc UNIQUE (academic_year_id, jenjang_id, date)
            );
            """
        )
        for table, expected in protected_before.items():
            actual = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            if actual != expected:
                raise RuntimeError(f"MIGRATION_VALIDATION_FAILED: {table} count changed")
        connection.execute("PRAGMA foreign_keys=ON")
        if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise RuntimeError("MIGRATION_VALIDATION_FAILED: integrity check")
        if connection.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("MIGRATION_VALIDATION_FAILED: foreign keys")
        fingerprint = schema_fingerprint(connection)
        with connection:
            connection.execute(
                f"INSERT INTO {LEDGER_TABLE} "
                "(version,predecessor,schema_fingerprint,protected_fingerprints,approved_by,applied_at) "
                "VALUES (?,?,?,?,?,?)",
                (
                    S45_VERSION,
                    S45_PREDECESSOR,
                    fingerprint,
                    json.dumps({"protected_counts": protected_before}, sort_keys=True, separators=(",", ":")),
                    "S45_MIGRATION",
                    _monotonic_applied_at(connection),
                ),
            )
        connection.close()
        os.replace(temporary, source)
        return "MIGRATION_COMPLETE"
    except Exception:
        if temporary.exists():
            temporary.unlink()
        raise
