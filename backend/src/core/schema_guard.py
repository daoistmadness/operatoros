"""Fail-closed production database path and schema validation."""

from __future__ import annotations

import os
import hashlib
import sqlite3
from pathlib import Path

from sqlalchemy.engine import make_url

from core.config import settings
from core.database import engine, validate_student_linking_gate
from core.schema_authority import current_schema_version, schema_head_order

LEDGER_TABLE = "operatoros_schema_migrations"
CURRENT_SCHEMA_TABLES = {
    "attendance_follow_ups",
    "attendance_follow_up_notes",
    "attendance_follow_up_audit",
    "academic_assessment_sessions",
    "attendance_calendar_weekday_rules",
    "attendance_calendar_exceptions",
    "attendance_submission_deadlines",
}
CURRENT_SCHEMA_TRIGGERS = {
    "trg_attendance_follow_up_audit_no_update",
    "trg_attendance_follow_up_audit_no_delete",
}


class DatabaseStartupError(RuntimeError):
    pass


def resolve_existing_sqlite_path(database_url: str) -> Path:
    url = make_url(database_url)
    if not url.drivername.startswith("sqlite"):
        raise DatabaseStartupError("DATABASE_PATH_INVALID: production reconciliation requires SQLite")
    database = url.database
    if not database or database == ":memory:":
        raise DatabaseStartupError("DATABASE_PATH_INVALID: a persistent SQLite file is required")
    path = Path(database)
    if not path.is_absolute():
        raise DatabaseStartupError("DATABASE_PATH_INVALID: production SQLite path must be absolute")
    resolved = path.resolve(strict=False)
    if not resolved.exists():
        raise DatabaseStartupError("DATABASE_PATH_MISSING: refusing to create an empty production database")
    if not resolved.is_file():
        raise DatabaseStartupError("DATABASE_PATH_INVALID: configured SQLite path is not a file")
    if not os.access(resolved, os.R_OK | os.W_OK) or not os.access(resolved.parent, os.R_OK | os.W_OK):
        raise DatabaseStartupError("DATABASE_PATH_INACCESSIBLE: service account lacks database access")
    return resolved


def _validate_sqlite_file(path: Path) -> None:
    try:
        connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro&immutable=1", uri=True)
    except sqlite3.Error as exc:
        raise DatabaseStartupError("DATABASE_ACCESS_FAILED") from exc
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()
        if integrity != ("ok",):
            raise DatabaseStartupError("DATABASE_INTEGRITY_FAILED")
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        if LEDGER_TABLE not in tables:
            raise DatabaseStartupError("DATABASE_MIGRATION_REQUIRED: schema ledger is missing")
        row = connection.execute(
            f"SELECT version, schema_fingerprint FROM {LEDGER_TABLE} "
            "ORDER BY applied_at DESC, version DESC LIMIT 1"
        ).fetchone()
        source_head = current_schema_version()
        known_heads = schema_head_order()
        if row and row[0] in known_heads[:-1]:
            raise DatabaseStartupError(
                f"DATABASE_MIGRATION_REQUIRED: eligible {row[0]} -> {source_head}"
            )
        if not row or row[0] != source_head:
            raise DatabaseStartupError(
                f"DATABASE_MIGRATION_REQUIRED: expected {source_head}"
            )
        required_tables = {"student_import_sessions", "student_import_applied_actions"}
        if not required_tables.issubset(tables):
            raise DatabaseStartupError("DATABASE_SCHEMA_INVALID: S3.9 provenance tables missing")
        if not CURRENT_SCHEMA_TABLES.issubset(tables):
            missing = sorted(CURRENT_SCHEMA_TABLES - tables)
            raise DatabaseStartupError(
                "DATABASE_SCHEMA_INVALID: S4.6 tables missing: " + ", ".join(missing)
            )
        if "student_enrollment_lifecycle_audit" not in tables:
            raise DatabaseStartupError("DATABASE_SCHEMA_INVALID: enrollment lifecycle audit missing")
        progression_tables = {
            "student_progression_mapping_rules",
            "student_progression_preview_batches",
            "student_progression_audit",
        }
        if not progression_tables.issubset(tables):
            raise DatabaseStartupError("DATABASE_SCHEMA_INVALID: progression tables missing")
        triggers = {
            item[0] for item in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='trigger'"
            )
        }
        required_triggers = {
            "trg_student_import_actions_no_delete",
            "trg_student_import_actions_immutable",
            "trg_student_import_batch_session_type",
            "trg_academic_roster_batch_session_type",
            "trg_student_enrollment_lifecycle_audit_no_delete",
            "trg_student_enrollment_lifecycle_audit_no_update",
            "trg_student_progression_audit_no_delete",
            "trg_student_progression_audit_no_update",
        }
        if not required_triggers.issubset(triggers):
            raise DatabaseStartupError("DATABASE_SCHEMA_INVALID: S3.9 provenance triggers missing")
        if not CURRENT_SCHEMA_TRIGGERS.issubset(triggers):
            missing = sorted(CURRENT_SCHEMA_TRIGGERS - triggers)
            raise DatabaseStartupError(
                "DATABASE_SCHEMA_INVALID: S4.6 triggers missing: " + ", ".join(missing)
            )
        grade_columns = {item[1] for item in connection.execute("PRAGMA table_info(student_subject_grades)")}
        if "assessment_session_id" not in grade_columns:
            raise DatabaseStartupError("DATABASE_SCHEMA_INVALID: student_subject_grades.assessment_session_id missing")
        for table in ("student_import_batches", "academic_roster_import_batches"):
            session_column = next(
                (item for item in connection.execute(f"PRAGMA table_info({table})") if item[1] == "session_id"),
                None,
            )
            if session_column is None or session_column[3] != 1:
                raise DatabaseStartupError(f"DATABASE_SCHEMA_INVALID: {table}.session_id")
            if connection.execute(f"SELECT COUNT(*) FROM {table} WHERE session_id IS NULL").fetchone()[0]:
                raise DatabaseStartupError(f"DATABASE_SCHEMA_INVALID: orphan {table}")
        objects = connection.execute(
            "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_master "
            "WHERE name NOT LIKE 'sqlite_%' AND name != ? ORDER BY type, name",
            (LEDGER_TABLE,),
        ).fetchall()
        actual_fingerprint = hashlib.sha256(repr(objects).encode("utf-8")).hexdigest()
        if actual_fingerprint != row[1]:
            raise DatabaseStartupError("DATABASE_MIGRATION_CHECKSUM_MISMATCH")
    except sqlite3.DatabaseError as exc:
        if isinstance(exc, DatabaseStartupError):
            raise
        raise DatabaseStartupError("DATABASE_SCHEMA_INVALID") from exc
    finally:
        connection.close()


def validate_sqlite_startup(database_url: str, engine_arg) -> None:
    if os.environ.get("BYPASS_STUDENT_LINKING_GATE", "false").lower() == "true":
        raise DatabaseStartupError("PRODUCTION_BYPASS_FORBIDDEN: BYPASS_STUDENT_LINKING_GATE")
    path = resolve_existing_sqlite_path(database_url)
    _validate_sqlite_file(path)
    validate_student_linking_gate(engine_arg, bypass=False)


def validate_database_startup() -> None:
    url = make_url(settings.database_url)
    if url.drivername.startswith("sqlite") and url.database and url.database != ":memory:":
        configured = Path(url.database)
        if configured.is_absolute() and not configured.resolve(strict=False).exists():
            from core.schema_migrations import bootstrap_fresh_sqlite_database

            bootstrap_fresh_sqlite_database(configured.resolve(strict=False))
    validate_sqlite_startup(settings.database_url, engine)
