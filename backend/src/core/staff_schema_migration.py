"""Explicit additive staff schema extension for current S4.3 SQLite databases."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from sqlalchemy import create_engine, inspect, text

from core.database import Base
from models.user import User  # noqa: F401 - resolve the batch actor FK
from models.staff import (
    StaffContactDetail, StaffIdentifier, StaffImportBatch, StaffImportIssue,
    StaffEducation, StaffImportRow, StaffJenjangAssignment, StaffJobTitleMapping, StaffMember,
)

STAFF_SCHEMA_VERSION = "20260802_staff_v2"
STAFF_TABLES = (
    StaffMember.__table__, StaffIdentifier.__table__, StaffContactDetail.__table__,
    StaffImportBatch.__table__, StaffImportRow.__table__, StaffImportIssue.__table__,
    StaffJobTitleMapping.__table__, StaffJenjangAssignment.__table__, StaffEducation.__table__,
)


def _reject_unsafe_database(path: Path) -> Path:
    if not path.is_absolute():
        raise ValueError("STAFF_DATABASE_PATH_MUST_BE_ABSOLUTE")
    resolved = path.resolve()
    repo_root = Path(__file__).resolve().parents[3]
    protected = repo_root / "backend" / "attendance.db"
    if resolved == protected:
        raise ValueError("PROTECTED_OPERATIONAL_DATABASE_REJECTED")
    session_root = repo_root / ".runtime" / "operatoros-dev" / "sessions"
    if resolved == session_root or session_root in resolved.parents:
        raise ValueError("EPHEMERAL_SESSION_DATABASE_REJECTED")
    if resolved.suffix.lower() not in {".db", ".sqlite", ".sqlite3"}:
        raise ValueError("STAFF_DATABASE_MUST_BE_SQLITE")
    return resolved


def ensure_staff_schema(database: str | Path) -> str:
    path = _reject_unsafe_database(Path(database))
    if not path.exists():
        raise ValueError("STAFF_DATABASE_MUST_ALREADY_EXIST")
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise RuntimeError("STAFF_SCHEMA_INTEGRITY_CHECK_FAILED")
        ledger = connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='operatoros_schema_migrations'"
        ).fetchone()
        if not ledger:
            raise ValueError("UNSUPPORTED_SCHEMA_NO_CORE_LEDGER")
        current = connection.execute(
            "SELECT version FROM operatoros_schema_migrations ORDER BY applied_at DESC LIMIT 1"
        ).fetchone()
        if not current or current[0] != "20260725_s43":
            raise ValueError("UNSUPPORTED_SCHEMA_REQUIRES_S43")
    engine = create_engine(f"sqlite:///{path}")
    try:
        inspector = inspect(engine)
        if "staff_members" in inspector.get_table_names() and "employment_end_date" not in {column["name"] for column in inspector.get_columns("staff_members")}:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE staff_members ADD COLUMN employment_end_date DATE NULL"))
        Base.metadata.create_all(bind=engine, tables=STAFF_TABLES)
        with engine.begin() as connection:
            connection.execute(text(
                "CREATE TABLE IF NOT EXISTS staff_schema_migrations ("
                "version VARCHAR(64) PRIMARY KEY, applied_at VARCHAR(64) NOT NULL)"
            ))
            connection.execute(
                text("INSERT OR IGNORE INTO staff_schema_migrations(version, applied_at) VALUES (:v, datetime('now'))"),
                {"v": STAFF_SCHEMA_VERSION},
            )
            if connection.execute(text("PRAGMA integrity_check")).scalar() != "ok":
                raise RuntimeError("STAFF_SCHEMA_INTEGRITY_CHECK_FAILED")
            if connection.execute(text("PRAGMA foreign_key_check")).fetchall():
                raise RuntimeError("STAFF_SCHEMA_FOREIGN_KEY_CHECK_FAILED")
    finally:
        engine.dispose()
    return STAFF_SCHEMA_VERSION


def staff_schema_ready(database: str | Path) -> bool:
    path = _reject_unsafe_database(Path(database))
    if not path.exists():
        return False
    with sqlite3.connect(path) as connection:
        return bool(connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='staff_members'"
        ).fetchone())
