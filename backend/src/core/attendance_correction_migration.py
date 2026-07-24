"""Explicit S4.2 attendance-correction migration for isolated SQLite databases."""

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

S42_VERSION = "20260724_s42"
S42_PREDECESSOR = "20260722_s41"


def migrate_attendance_corrections_sqlite(path: Path) -> str:
    source = path.resolve(strict=True)
    temporary = source.with_name(f".{source.name}.s42-migrating")
    if temporary.exists():
        temporary.unlink()
    # A copied main file must not be swapped underneath stale source WAL
    # sidecars: SQLite would replay the pre-migration pages on the next open.
    with sqlite3.connect(source) as source_connection:
        source_connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    with sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True) as src, sqlite3.connect(temporary) as dst:
        src.backup(dst)
    shutil.copystat(source, temporary)
    try:
        connection = sqlite3.connect(temporary)
        connection.execute("PRAGMA journal_mode=DELETE")
        if connection.execute(
            f"SELECT 1 FROM {LEDGER_TABLE} WHERE version=?", (S42_VERSION,)
        ).fetchone():
            connection.close(); temporary.unlink(); return "MIGRATION_ALREADY_CURRENT"
        current = connection.execute(
            f"SELECT version FROM {LEDGER_TABLE} ORDER BY applied_at DESC, version DESC LIMIT 1"
        ).fetchone()
        if current != (S42_PREDECESSOR,):
            raise RuntimeError("UNSUPPORTED_SCHEMA: S4.1 predecessor required")
        attendance_count = connection.execute("SELECT COUNT(*) FROM attendance").fetchone()[0]
        override_count = connection.execute("SELECT COUNT(*) FROM attendance_overrides").fetchone()[0]
        connection.close()

        from models.attendance_review import AttendanceCorrectionAudit, AttendanceCorrectionRequest, AttendancePeriod, AttendancePeriodAudit
        migration_engine = create_engine(f"sqlite:///{temporary}")
        Base.metadata.create_all(migration_engine, tables=[
            AttendanceCorrectionRequest.__table__, AttendanceCorrectionAudit.__table__,
            AttendancePeriod.__table__, AttendancePeriodAudit.__table__,
        ])
        migration_engine.dispose()
        connection = sqlite3.connect(temporary)
        connection.execute("PRAGMA journal_mode=DELETE")
        with connection:
            for table, column, definition in (
                ("attendance_overrides", "override_check_in", "TIME NULL"),
                ("attendance_overrides", "override_check_out", "TIME NULL"),
                ("attendance_override_history", "previous_values", "JSON NULL"),
                ("attendance_override_history", "new_values", "JSON NULL"),
            ):
                columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
                if column not in columns:
                    connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
            for table in ("attendance_correction_audit", "attendance_period_audit"):
                connection.execute(
                    f"CREATE TRIGGER IF NOT EXISTS trg_{table}_no_update BEFORE UPDATE ON {table} "
                    f"BEGIN SELECT RAISE(ABORT, '{table} is append-only'); END"
                )
                connection.execute(
                    f"CREATE TRIGGER IF NOT EXISTS trg_{table}_no_delete BEFORE DELETE ON {table} "
                    f"BEGIN SELECT RAISE(ABORT, '{table} is append-only'); END"
                )
            if connection.execute("SELECT COUNT(*) FROM attendance").fetchone()[0] != attendance_count:
                raise RuntimeError("MIGRATION_VALIDATION_FAILED: attendance changed")
            if connection.execute("SELECT COUNT(*) FROM attendance_overrides").fetchone()[0] != override_count:
                raise RuntimeError("MIGRATION_VALIDATION_FAILED: overrides changed")
            if connection.execute("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("MIGRATION_VALIDATION_FAILED: foreign keys")
            connection.execute(
                f"INSERT INTO {LEDGER_TABLE} "
                "(version,predecessor,schema_fingerprint,protected_fingerprints,approved_by,applied_at) "
                "VALUES (?,?,?,?,?,?)",
                (S42_VERSION, S42_PREDECESSOR, "S42_ATTENDANCE_CORRECTION",
                 json.dumps({"attendance": attendance_count, "attendance_overrides": override_count}),
                 "S42_MIGRATION", datetime.now(timezone.utc).isoformat()),
            )
        connection.close()
        os.replace(temporary, source)
        return "MIGRATION_COMPLETE"
    except Exception:
        if temporary.exists():
            temporary.unlink()
        raise
