"""Explicit SQLite schema manifest entry point; never imported by app startup."""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine

from core.database import Base
from core.schema_guard import CURRENT_SCHEMA_VERSION, LEDGER_TABLE


REQUIRED_TABLES = {
    "students",
    "student_masters",
    "student_device_identities",
    "attendance",
    "student_enrollments",
}
PROTECTED_TABLES = tuple(sorted(REQUIRED_TABLES))
REQUIRED_INDEXES = {
    "idx_attendance_student_date",
    "uq_active_student_device_identity",
    "uq_student_master_academic_year",
}
REQUIRED_TRIGGERS = {
    "trg_attendance_override_history_no_delete",
    "trg_attendance_override_history_no_update",
    "trg_student_master_change_history_no_delete",
    "trg_student_master_change_history_no_update",
}
MODEL_MODULES = (
    "models.absence_reason",
    "models.absence_reason_class_entry",
    "models.academic_config",
    "models.academic_intervention",
    "models.academic_mapping",
    "models.academic_master",
    "models.academic_roster",
    "models.academic_year",
    "models.assessment_component",
    "models.attendance",
    "models.attendance_import",
    "models.attendance_review",
    "models.backup_operation",
    "models.first_admin_setup",
    "models.heb_override",
    "models.jenjang",
    "models.jenjang_config",
    "models.report_builder",
    "models.student",
    "models.student_enrollment",
    "models.student_master",
    "models.student_subject_grade",
    "models.subject",
    "models.upload_log",
    "models.user",
    "models.user_session",
)


@dataclass(frozen=True)
class Migration:
    revision: str
    predecessor: str | None
    backup_required: bool
    description: str


BASELINE = Migration(
    revision=CURRENT_SCHEMA_VERSION,
    predecessor=None,
    backup_required=False,
    description="Adopt an already-current S3.8 SQLite schema into the version ledger",
)


def _schema_fingerprint(connection: sqlite3.Connection) -> str:
    rows = connection.execute(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_master "
        "WHERE name NOT LIKE 'sqlite_%' AND name != ? ORDER BY type, name",
        (LEDGER_TABLE,),
    ).fetchall()
    return hashlib.sha256(repr(rows).encode("utf-8")).hexdigest()


def protected_fingerprints(connection: sqlite3.Connection) -> dict[str, dict[str, object]]:
    result = {}
    for table in PROTECTED_TABLES:
        columns = [row[1] for row in connection.execute(f"PRAGMA table_info({table})")]
        order = ", ".join(f'"{column}"' for column in columns)
        rows = connection.execute(f"SELECT * FROM {table} ORDER BY {order}").fetchall()
        result[table] = {
            "count": len(rows),
            "sha256": hashlib.sha256(repr(rows).encode("utf-8")).hexdigest(),
        }
    return result


def _validate_current_schema(connection: sqlite3.Connection) -> str:
    if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
        raise RuntimeError("MIGRATION_VALIDATION_FAILED: integrity check")
    violations = connection.execute("PRAGMA foreign_key_check").fetchall()
    if violations:
        raise RuntimeError("MIGRATION_VALIDATION_FAILED: foreign-key violations")
    objects = connection.execute(
        "SELECT type, name FROM sqlite_master WHERE type IN ('table','index','trigger')"
    ).fetchall()
    tables = {name for kind, name in objects if kind == "table"}
    indexes = {name for kind, name in objects if kind == "index"}
    triggers = {name for kind, name in objects if kind == "trigger"}
    missing = sorted(REQUIRED_TABLES - tables)
    if missing:
        raise RuntimeError("UNSUPPORTED_SCHEMA: missing tables " + ", ".join(missing))
    if not REQUIRED_INDEXES.issubset(indexes):
        raise RuntimeError("UNSUPPORTED_SCHEMA: required indexes are missing")
    if not REQUIRED_TRIGGERS.issubset(triggers):
        raise RuntimeError("UNSUPPORTED_SCHEMA: append-only triggers are missing")
    attendance_columns = {row[1] for row in connection.execute("PRAGMA table_info(attendance)")}
    identity_columns = {
        row[1] for row in connection.execute("PRAGMA table_info(student_device_identities)")
    }
    if not {"status", "check_in", "check_out"}.issubset(attendance_columns):
        raise RuntimeError("UNSUPPORTED_SCHEMA: attendance schema is outdated")
    if not {"student_master_id", "legacy_student_id", "is_active"}.issubset(identity_columns):
        raise RuntimeError("UNSUPPORTED_SCHEMA: identity schema is outdated")
    return _schema_fingerprint(connection)


def adopt_current_sqlite_schema(
    path: Path,
    *,
    expected_counts: dict[str, int] | None = None,
    approved_by: str = "TEST_ONLY",
) -> str:
    """Record the baseline only after strict, non-mutating schema preconditions."""
    if not path.is_absolute():
        raise RuntimeError("DATABASE_PATH_INVALID: path must be absolute")
    resolved = path.resolve(strict=True)
    if not resolved.is_file():
        raise RuntimeError("DATABASE_PATH_INVALID")
    connection = sqlite3.connect(resolved)
    try:
        fingerprint = _validate_current_schema(connection)
        protected = protected_fingerprints(connection)
        if expected_counts is None:
            raise RuntimeError("BASELINE_APPROVAL_REQUIRED: protected counts must be supplied")
        actual_counts = {table: int(values["count"]) for table, values in protected.items()}
        if expected_counts != actual_counts:
            raise RuntimeError("MIGRATION_VALIDATION_FAILED: protected count mismatch")
        with connection:
            connection.execute(
                f"CREATE TABLE IF NOT EXISTS {LEDGER_TABLE} ("
                "version TEXT PRIMARY KEY, predecessor TEXT NULL, schema_fingerprint TEXT NOT NULL, "
                "protected_fingerprints TEXT NOT NULL, approved_by TEXT NOT NULL, applied_at TEXT NOT NULL)"
            )
            existing = connection.execute(
                f"SELECT schema_fingerprint, protected_fingerprints FROM {LEDGER_TABLE} WHERE version=?",
                (BASELINE.revision,),
            ).fetchone()
            protected_json = json.dumps(protected, sort_keys=True, separators=(",", ":"))
            if existing and existing != (fingerprint, protected_json):
                raise RuntimeError("DATABASE_MIGRATION_CHECKSUM_MISMATCH")
            connection.execute(
                f"INSERT OR IGNORE INTO {LEDGER_TABLE} "
                "(version, predecessor, schema_fingerprint, protected_fingerprints, approved_by, applied_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    BASELINE.revision,
                    BASELINE.predecessor,
                    fingerprint,
                    protected_json,
                    approved_by,
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
        return fingerprint
    finally:
        connection.close()


def initialize_fresh_sqlite_database(path: Path) -> str:
    """Create a fresh current schema explicitly and atomically, without seed data."""
    if not path.is_absolute():
        raise RuntimeError("DATABASE_PATH_INVALID: path must be absolute")
    target = path.resolve(strict=False)
    if target.exists():
        with sqlite3.connect(target) as connection:
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if LEDGER_TABLE in tables:
                row = connection.execute(
                    f"SELECT version FROM {LEDGER_TABLE} ORDER BY applied_at DESC LIMIT 1"
                ).fetchone()
                if row == (CURRENT_SCHEMA_VERSION,):
                    return "MIGRATION_COMPLETE"
        raise RuntimeError("DATABASE_ALREADY_EXISTS")
    if not target.parent.exists() or not target.parent.is_dir():
        raise RuntimeError("DATABASE_PATH_INVALID: parent directory is missing")
    temporary = target.with_name(f".{target.name}.migrating")
    if temporary.exists():
        raise RuntimeError("MIGRATION_RECOVERY_REQUIRED: interrupted temporary database exists")
    for module in MODEL_MODULES:
        importlib.import_module(module)
    migration_engine = create_engine(f"sqlite:///{temporary}")
    try:
        Base.metadata.create_all(migration_engine)
        migration_engine.dispose()
        with sqlite3.connect(temporary) as connection:
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance(student_id, date)"
            )
            for table in (
                "attendance_override_history",
                "student_master_change_history",
                "student_enrollment_class_history",
            ):
                connection.execute(
                    f"CREATE TRIGGER IF NOT EXISTS trg_{table}_no_update "
                    f"BEFORE UPDATE ON {table} BEGIN SELECT RAISE(ABORT, 'append-only'); END"
                )
                connection.execute(
                    f"CREATE TRIGGER IF NOT EXISTS trg_{table}_no_delete "
                    f"BEFORE DELETE ON {table} BEGIN SELECT RAISE(ABORT, 'append-only'); END"
                )
        expected = {table: 0 for table in PROTECTED_TABLES}
        adopt_current_sqlite_schema(temporary, expected_counts=expected, approved_by="FRESH_INSTALL")
        with sqlite3.connect(temporary) as connection:
            if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                raise RuntimeError("MIGRATION_VALIDATION_FAILED")
            if connection.execute("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("MIGRATION_VALIDATION_FAILED")
            connection.commit()
        with sqlite3.connect(temporary) as source, sqlite3.connect(target) as destination:
            source.backup(destination)
        with sqlite3.connect(target) as published:
            if published.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                raise RuntimeError("MIGRATION_VALIDATION_FAILED: published database")
        temporary.unlink()
        for suffix in ("-wal", "-shm"):
            sidecar = Path(str(temporary) + suffix)
            if sidecar.exists():
                sidecar.unlink()
        return "MIGRATION_COMPLETE"
    except Exception:
        migration_engine.dispose()
        if temporary.exists():
            temporary.unlink()
        if target.exists():
            target.unlink()
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="operatoros migrate")
    commands = parser.add_subparsers(dest="command", required=True)
    fresh = commands.add_parser("initialize-fresh")
    fresh.add_argument("--database", required=True, type=Path)
    adopt = commands.add_parser("adopt-baseline")
    adopt.add_argument("--database", required=True, type=Path)
    adopt.add_argument("--baseline", required=True)
    adopt.add_argument("--approval", required=True)
    adopt.add_argument("--approved-by", required=True)
    for table in PROTECTED_TABLES:
        adopt.add_argument(f"--expected-{table.replace('_', '-')}", required=True, type=int)
    arguments = parser.parse_args(argv)
    if arguments.command == "initialize-fresh":
        print(json.dumps({"status": initialize_fresh_sqlite_database(arguments.database)}))
        return 0
    if arguments.baseline != CURRENT_SCHEMA_VERSION:
        raise RuntimeError("BASELINE_ID_INVALID")
    if arguments.approval != "APPROVE_BASELINE_ADOPTION":
        raise RuntimeError("BASELINE_APPROVAL_REQUIRED")
    expected = {
        table: getattr(arguments, f"expected_{table}") for table in PROTECTED_TABLES
    }
    fingerprint = adopt_current_sqlite_schema(
        arguments.database,
        expected_counts=expected,
        approved_by=arguments.approved_by,
    )
    print(json.dumps({"status": "MIGRATION_COMPLETE", "schema_fingerprint": fingerprint}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
