"""Explicit S4.3 attendance-followup migration for isolated SQLite databases."""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import create_engine

from core.database import Base
from core.database_access_context import protected_path_is_permitted
from core.schema_guard import LEDGER_TABLE

S43_VERSION = "20260725_s43"
S43_PREDECESSOR = "20260724_s42"
ROOT = Path(__file__).resolve().parents[3]
PROTECTED_DATABASES = {
    (ROOT / "backend" / "attendance.db").resolve(),
    (ROOT / "attendance.db").resolve(),
}


def monotonic_applied_at(connection: sqlite3.Connection) -> str:
    """Return a ledger timestamp that is strictly newer than every existing row.

    applied_at values come from the wall clock. A backward clock step (for
    example an NTP correction) would otherwise give a later migration row an
    earlier timestamp than its predecessor and break head selection, which
    orders by applied_at.
    """
    proposed = datetime.now(timezone.utc)
    row = connection.execute(f"SELECT MAX(applied_at) FROM {LEDGER_TABLE}").fetchone()
    previous = row[0] if row else None
    if previous:
        previous_timestamp = datetime.fromisoformat(previous)
        if proposed <= previous_timestamp:
            proposed = previous_timestamp + timedelta(microseconds=1)
    return proposed.isoformat()

def migrate_attendance_followup_sqlite(path: Path) -> str:
    source = path.resolve(strict=True)
    if source in PROTECTED_DATABASES and not protected_path_is_permitted(source):
        raise RuntimeError("PROTECTED_DATABASE_PATH_REJECTED")
    temporary = source.with_name(f".{source.name}.s43-migrating")
    if temporary.exists():
        temporary.unlink()
    with sqlite3.connect(source) as source_connection:
        source_connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    with sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True) as src, sqlite3.connect(temporary) as dst:
        src.backup(dst)
    shutil.copystat(source, temporary)
    try:
        connection = sqlite3.connect(temporary)
        connection.execute("PRAGMA journal_mode=DELETE")
        if connection.execute(
            f"SELECT 1 FROM {LEDGER_TABLE} WHERE version=?", (S43_VERSION,)
        ).fetchone():
            connection.close()
            temporary.unlink()
            return "MIGRATION_ALREADY_CURRENT"
        current = connection.execute(
            f"SELECT version FROM {LEDGER_TABLE} ORDER BY applied_at DESC, version DESC LIMIT 1"
        ).fetchone()
        if current != (S43_PREDECESSOR,):
            raise RuntimeError("UNSUPPORTED_SCHEMA: S4.2 predecessor required")
        student_count = connection.execute("SELECT COUNT(*) FROM students").fetchone()[0]
        attendance_count = connection.execute("SELECT COUNT(*) FROM attendance").fetchone()[0]
        connection.close()

        # Import referenced model tables so SQLAlchemy can resolve the foreign
        # keys while creating only the three new S4.3 tables below.
        from models import academic_roster, academic_year, attendance, attendance_review
        from models import early_departure_excuse, student_enrollment, student_master, user
        from models.attendance_followup import (
            AttendanceFollowUp,
            AttendanceFollowUpAudit,
            AttendanceFollowUpNote,
        )

        migration_engine = create_engine(f"sqlite:///{temporary}")
        Base.metadata.create_all(
            migration_engine,
            tables=[
                AttendanceFollowUp.__table__,
                AttendanceFollowUpNote.__table__,
                AttendanceFollowUpAudit.__table__,
            ],
        )
        migration_engine.dispose()

        connection = sqlite3.connect(temporary)
        connection.execute("PRAGMA journal_mode=DELETE")
        with connection:
            connection.execute(
                "CREATE TRIGGER IF NOT EXISTS trg_attendance_follow_up_audit_no_update "
                "BEFORE UPDATE ON attendance_follow_up_audit "
                "BEGIN SELECT RAISE(ABORT, 'attendance_follow_up_audit is append-only'); END"
            )
            connection.execute(
                "CREATE TRIGGER IF NOT EXISTS trg_attendance_follow_up_audit_no_delete "
                "BEFORE DELETE ON attendance_follow_up_audit "
                "BEGIN SELECT RAISE(ABORT, 'attendance_follow_up_audit is append-only'); END"
            )
            if connection.execute("SELECT COUNT(*) FROM students").fetchone()[0] != student_count:
                raise RuntimeError("MIGRATION_VALIDATION_FAILED: students changed")
            if connection.execute("SELECT COUNT(*) FROM attendance").fetchone()[0] != attendance_count:
                raise RuntimeError("MIGRATION_VALIDATION_FAILED: attendance changed")
            if connection.execute("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("MIGRATION_VALIDATION_FAILED: foreign keys")
            objects = connection.execute(
                "SELECT type,name,tbl_name,COALESCE(sql,'') FROM sqlite_master "
                "WHERE name NOT LIKE 'sqlite_%' AND name != ? ORDER BY type,name",
                (LEDGER_TABLE,),
            ).fetchall()
            fingerprint = hashlib.sha256(repr(objects).encode("utf-8")).hexdigest()
            connection.execute(
                f"INSERT INTO {LEDGER_TABLE} "
                "(version,predecessor,schema_fingerprint,protected_fingerprints,approved_by,applied_at) "
                "VALUES (?,?,?,?,?,?)",
                (
                    S43_VERSION,
                    S43_PREDECESSOR,
                    fingerprint,
                    json.dumps({"students": student_count, "attendance": attendance_count}),
                    "S43_MIGRATION",
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
