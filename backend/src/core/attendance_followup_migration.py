"""Explicit S4.3 attendance-followup migration for isolated SQLite databases."""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine

from core.database import Base
from core.schema_guard import LEDGER_TABLE

S43_VERSION = "20260725_s43"
S43_PREDECESSOR = "20260724_s42"


def migrate_attendance_followup_sqlite(path: Path) -> str:
    source = path.resolve(strict=True)
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
            connection.execute(
                f"INSERT INTO {LEDGER_TABLE} "
                "(version,predecessor,schema_fingerprint,protected_fingerprints,approved_by,applied_at) "
                "VALUES (?,?,?,?,?,?)",
                (
                    S43_VERSION,
                    S43_PREDECESSOR,
                    "S43_ATTENDANCE_FOLLOWUP",
                    json.dumps({"students": student_count, "attendance": attendance_count}),
                    "S43_MIGRATION",
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
        connection.close()
        os.replace(temporary, source)
        return "MIGRATION_COMPLETE"
    except Exception:
        if temporary.exists():
            temporary.unlink()
        raise
