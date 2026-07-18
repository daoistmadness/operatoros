"""Fail-closed production database path and schema validation."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from sqlalchemy.engine import make_url

from core.config import settings
from core.database import engine, validate_student_linking_gate


CURRENT_SCHEMA_VERSION = "20260722_s38"
LEDGER_TABLE = "operatoros_schema_migrations"


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
        connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
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
            f"SELECT version FROM {LEDGER_TABLE} ORDER BY applied_at DESC, version DESC LIMIT 1"
        ).fetchone()
        if row != (CURRENT_SCHEMA_VERSION,):
            raise DatabaseStartupError(
                f"DATABASE_MIGRATION_REQUIRED: expected {CURRENT_SCHEMA_VERSION}"
            )
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
    validate_sqlite_startup(settings.database_url, engine)
