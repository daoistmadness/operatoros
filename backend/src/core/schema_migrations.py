"""Explicit SQLite schema manifest entry point; never imported by app startup."""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import sqlite3
import os
import shutil
import uuid
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine

from core.database import Base
from core.schema_guard import CURRENT_SCHEMA_VERSION, LEGACY_SCHEMA_VERSION, LEDGER_TABLE, PREVIOUS_SCHEMA_VERSION


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
S39_TABLES = {"student_import_sessions", "student_import_applied_actions"}
S39_TRIGGERS = {
    "trg_student_import_actions_no_delete",
    "trg_student_import_actions_immutable",
    "trg_student_import_batch_session_type",
    "trg_academic_roster_batch_session_type",
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
    "models.student_import_session",
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
    revision=LEGACY_SCHEMA_VERSION,
    predecessor=None,
    backup_required=False,
    description="Adopt an already-current S3.8 SQLite schema into the version ledger",
)

S39 = Migration(
    revision=PREVIOUS_SCHEMA_VERSION,
    predecessor=LEGACY_SCHEMA_VERSION,
    backup_required=True,
    description="Add unified student import sessions and immutable applied-action provenance",
)

STUDENT_IMPORT_SESSION_NAMESPACE = uuid.UUID("9e81c7d8-e73f-4eac-bb72-d55b004297e1")
LOGGER = logging.getLogger("operatoros.schema_migration")


def _install_sqlite_action_triggers(connection: sqlite3.Connection) -> None:
    connection.execute(
        "CREATE TRIGGER IF NOT EXISTS trg_student_import_actions_no_delete "
        "BEFORE DELETE ON student_import_applied_actions BEGIN "
        "SELECT RAISE(ABORT, 'student import actions are append-only'); END"
    )
    immutable = (
        "session_id", "student_import_batch_id", "academic_roster_import_batch_id",
        "source_row_number", "action_sequence", "action_type", "entity_type", "entity_id",
        "entity_reference", "operation_id", "parent_action_id", "applied_at", "applied_by",
        "request_correlation_id", "before_state", "after_state", "before_state_checksum",
        "after_state_checksum", "dependency_checkpoint", "compensation_type",
        "rollback_eligibility", "schema_version",
    )
    predicate = " OR ".join(f"OLD.{column} IS NOT NEW.{column}" for column in immutable)
    connection.execute(
        "CREATE TRIGGER IF NOT EXISTS trg_student_import_actions_immutable "
        f"BEFORE UPDATE ON student_import_applied_actions WHEN {predicate} BEGIN "
        "SELECT RAISE(ABORT, 'student import action provenance is immutable'); END"
    )
    for trigger, table, import_type in (
        ("trg_student_import_batch_session_type", "student_import_batches", "STUDENT_DATA_UPDATE"),
        ("trg_academic_roster_batch_session_type", "academic_roster_import_batches", "STUDENT_ROSTER"),
    ):
        connection.execute(
            f"CREATE TRIGGER IF NOT EXISTS {trigger} BEFORE INSERT ON {table} "
            f"WHEN (SELECT import_type FROM student_import_sessions WHERE id=NEW.session_id) IS NOT '{import_type}' "
            "BEGIN SELECT RAISE(ABORT, 'import session type mismatch'); END"
        )
        connection.execute(
            f"CREATE TRIGGER IF NOT EXISTS {trigger}_update BEFORE UPDATE OF session_id ON {table} "
            f"WHEN (SELECT import_type FROM student_import_sessions WHERE id=NEW.session_id) IS NOT '{import_type}' "
            "BEGIN SELECT RAISE(ABORT, 'import session type mismatch'); END"
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


def _validate_current_schema(connection: sqlite3.Connection, *, require_s39: bool = False) -> str:
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
    if require_s39:
        if not S39_TABLES.issubset(tables) or not S39_TRIGGERS.issubset(triggers):
            raise RuntimeError("UNSUPPORTED_SCHEMA: S3.9 provenance objects are missing")
        for table in ("student_import_batches", "academic_roster_import_batches"):
            session_column = next(
                (row for row in connection.execute(f"PRAGMA table_info({table})") if row[1] == "session_id"),
                None,
            )
            if session_column is None or session_column[3] != 1:
                raise RuntimeError(f"UNSUPPORTED_SCHEMA: {table}.session_id must be NOT NULL")
            if connection.execute(f"SELECT COUNT(*) FROM {table} WHERE session_id IS NULL").fetchone()[0]:
                raise RuntimeError(f"MIGRATION_VALIDATION_FAILED: {table} has orphan batches")
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
                "student_enrollment_lifecycle_audit",
            ):
                if table == "student_enrollment_class_history":
                    immutable = ("id", "enrollment_id", "class_name", "effective_from", "changed_by", "changed_at", "source", "import_batch_id")
                    same = " AND ".join(f"OLD.{column} IS NEW.{column}" for column in immutable)
                    connection.execute(
                        "CREATE TRIGGER IF NOT EXISTS trg_student_enrollment_class_history_no_update "
                        "BEFORE UPDATE ON student_enrollment_class_history WHEN NOT ("
                        f"{same} AND OLD.effective_to IS NULL AND NEW.effective_to IS NOT NULL "
                        "AND NEW.effective_to >= OLD.effective_from) BEGIN "
                        "SELECT RAISE(ABORT, 'class history permits only one-way interval closure'); END"
                    )
                else:
                    connection.execute(
                        f"CREATE TRIGGER IF NOT EXISTS trg_{table}_no_update "
                        f"BEFORE UPDATE ON {table} BEGIN SELECT RAISE(ABORT, 'append-only'); END"
                    )
                connection.execute(
                    f"CREATE TRIGGER IF NOT EXISTS trg_{table}_no_delete "
                    f"BEFORE DELETE ON {table} BEGIN SELECT RAISE(ABORT, 'append-only'); END"
                )
            _install_sqlite_action_triggers(connection)
            fingerprint = _validate_current_schema(connection, require_s39=True)
            protected = protected_fingerprints(connection)
            connection.execute(
                f"CREATE TABLE IF NOT EXISTS {LEDGER_TABLE} ("
                "version TEXT PRIMARY KEY, predecessor TEXT NULL, schema_fingerprint TEXT NOT NULL, "
                "protected_fingerprints TEXT NOT NULL, approved_by TEXT NOT NULL, applied_at TEXT NOT NULL)"
            )
            connection.execute(
                f"INSERT INTO {LEDGER_TABLE} "
                "(version, predecessor, schema_fingerprint, protected_fingerprints, approved_by, applied_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (CURRENT_SCHEMA_VERSION, None, fingerprint,
                 json.dumps(protected, sort_keys=True, separators=(",", ":")),
                 "FRESH_INSTALL", datetime.now(timezone.utc).isoformat()),
            )
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


def _rebuild_batch_with_session(connection: sqlite3.Connection, table: str) -> None:
    columns = [row[1] for row in connection.execute(f"PRAGMA table_info({table})")]
    if "session_id" not in columns:
        raise RuntimeError(f"MIGRATION_VALIDATION_FAILED: {table}.session_id missing")
    if next(row for row in connection.execute(f"PRAGMA table_info({table})") if row[1] == "session_id")[3] == 1:
        return
    original_sql = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()[0]
    indexes = [row[0] for row in connection.execute(
        "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL", (table,)
    ).fetchall()]
    temporary = f"{table}_s39_new"
    create_sql = original_sql.replace(f"CREATE TABLE {table}", f"CREATE TABLE {temporary}", 1)
    create_sql = create_sql.replace("session_id VARCHAR(36)", "session_id VARCHAR(36) NOT NULL", 1)
    connection.execute(create_sql)
    column_list = ",".join(f'"{column}"' for column in columns)
    connection.execute(f"INSERT INTO {temporary} ({column_list}) SELECT {column_list} FROM {table}")
    connection.execute(f"DROP TABLE {table}")
    connection.execute(f"ALTER TABLE {temporary} RENAME TO {table}")
    for statement in indexes:
        connection.execute(statement)


def migrate_s38_to_s39_sqlite(path: Path, *, failure_step: str | None = None) -> str:
    """Atomically publish an S3.9 copy; the S3.8 source is unchanged on failure."""
    source = path.resolve(strict=True)
    temporary = source.with_name(f".{source.name}.s39-migrating")
    if temporary.exists():
        temporary.unlink()
    with sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True) as source_connection:
        with sqlite3.connect(temporary) as temporary_connection:
            source_connection.backup(temporary_connection)
    shutil.copystat(source, temporary)
    try:
        connection = sqlite3.connect(temporary)
        connection.execute("PRAGMA journal_mode=DELETE")
        connection.execute("PRAGMA foreign_keys=ON")
        revision = connection.execute(
            f"SELECT version, schema_fingerprint FROM {LEDGER_TABLE} ORDER BY applied_at DESC, version DESC LIMIT 1"
        ).fetchone()
        if revision and revision[0] == S39.revision:
            actual = _validate_current_schema(connection, require_s39=True)
            if actual != revision[1]:
                raise RuntimeError("DATABASE_MIGRATION_CHECKSUM_MISMATCH")
            connection.close(); temporary.unlink(); return "MIGRATION_ALREADY_CURRENT"
        if not revision or revision[0] != S39.predecessor:
            raise RuntimeError("UNSUPPORTED_SCHEMA: S3.8 predecessor required")
        protected_before = protected_fingerprints(connection)
        update_count = connection.execute("SELECT COUNT(*) FROM student_import_batches").fetchone()[0]
        roster_count = connection.execute("SELECT COUNT(*) FROM academic_roster_import_batches").fetchone()[0]
        LOGGER.info("schema_migration_inventory", extra={"historical_update_batch_count": update_count, "historical_roster_batch_count": roster_count})
        connection.close()
        for module in MODEL_MODULES:
            importlib.import_module(module)
        LOGGER.info("schema_migration_started", extra={"source_revision": S39.predecessor, "target_revision": S39.revision, "database_engine": "sqlite"})
        migration_engine = create_engine(f"sqlite:///{temporary}")
        from models.student_import_session import StudentImportAppliedAction, StudentImportSession
        Base.metadata.create_all(migration_engine, tables=[StudentImportSession.__table__])
        migration_engine.dispose()
        if failure_step in {"session_table", "tables"}: raise RuntimeError("INJECTED_FAILURE:session_table")
        migration_engine = create_engine(f"sqlite:///{temporary}")
        Base.metadata.create_all(migration_engine, tables=[StudentImportAppliedAction.__table__])
        migration_engine.dispose()
        if failure_step == "ledger_table": raise RuntimeError("INJECTED_FAILURE:ledger_table")
        connection = sqlite3.connect(temporary)
        connection.execute("PRAGMA foreign_keys=OFF")
        with connection:
            for position, table in enumerate(("student_import_batches", "academic_roster_import_batches")):
                columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
                if "session_id" not in columns:
                    connection.execute(f"ALTER TABLE {table} ADD COLUMN session_id VARCHAR(36) NULL REFERENCES student_import_sessions(id) ON DELETE RESTRICT")
                if position == 0 and failure_step == "first_ownership_column":
                    raise RuntimeError("INJECTED_FAILURE:first_ownership_column")
            if failure_step == "columns": raise RuntimeError("INJECTED_FAILURE")
            mappings = (
                ("student_import_batches", "STUDENT_DATA_UPDATE", "student-update", "file_checksum", "total_rows"),
                ("academic_roster_import_batches", "STUDENT_ROSTER", "academic-roster", "checksum", None),
            )
            for table, import_type, label, checksum_column, count_column in mappings:
                select_count = count_column or "0"
                rows = connection.execute(f"SELECT id, filename, {checksum_column}, created_by, created_at, status, committed_at, {select_count} FROM {table} WHERE session_id IS NULL ORDER BY id").fetchall()
                for batch_id, filename, checksum, actor, created_at, status, committed_at, row_count in rows:
                    stable_uuid = str(uuid.uuid5(STUDENT_IMPORT_SESSION_NAMESPACE, f"{label}:{batch_id}"))
                    session_id = stable_uuid
                    legacy_expiry = connection.execute(
                        "SELECT datetime(?, '+24 hours')", (created_at,)
                    ).fetchone()[0]
                    connection.execute("INSERT OR IGNORE INTO student_import_sessions (id,session_uuid,import_type,status,provenance_status,created_at,created_by,updated_at,committed_at,expires_at,source_filename,source_file_checksum,idempotency_key,row_count,selected_row_count,applied_action_count,rollback_state,metadata,schema_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (session_id,stable_uuid,import_type,"COMMITTED" if status == "committed" else "ARCHIVED","LEGACY_PROVENANCE_UNAVAILABLE",created_at,actor,created_at,committed_at,legacy_expiry,filename or "legacy-import.xlsx",checksum,None,row_count or 0,0,0,"NOT_AVAILABLE",json.dumps({"legacy_batch_model":table,"legacy_batch_id":batch_id,"migration_revision":S39.revision,"backfill_version":"1"}),"1"))
                    if failure_step == "historical_session_backfill":
                        raise RuntimeError("INJECTED_FAILURE:historical_session_backfill")
                    connection.execute(f"UPDATE {table} SET session_id=? WHERE id=?", (session_id,batch_id))
                    if failure_step == "batch_linking":
                        raise RuntimeError("INJECTED_FAILURE:batch_linking")
            if failure_step == "backfill": raise RuntimeError("INJECTED_FAILURE")
            for table in ("student_import_batches", "academic_roster_import_batches"):
                if connection.execute(f"SELECT COUNT(*) FROM {table} WHERE session_id IS NULL").fetchone()[0]:
                    raise RuntimeError("MIGRATION_VALIDATION_FAILED: orphan batch")
                _rebuild_batch_with_session(connection, table)
            if failure_step == "not_null": raise RuntimeError("INJECTED_FAILURE:not_null")
            _install_sqlite_action_triggers(connection)
            if failure_step == "triggers": raise RuntimeError("INJECTED_FAILURE")
            if protected_fingerprints(connection) != protected_before:
                raise RuntimeError("MIGRATION_VALIDATION_FAILED: protected data changed")
            if failure_step == "fingerprint_validation": raise RuntimeError("INJECTED_FAILURE:fingerprint_validation")
            if connection.execute("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("MIGRATION_VALIDATION_FAILED: foreign keys")
            fingerprint = _schema_fingerprint(connection)
            if failure_step == "before_revision": raise RuntimeError("INJECTED_FAILURE:before_revision")
            connection.execute(f"INSERT INTO {LEDGER_TABLE} (version,predecessor,schema_fingerprint,protected_fingerprints,approved_by,applied_at) VALUES (?,?,?,?,?,?)", (S39.revision,S39.predecessor,fingerprint,json.dumps(protected_fingerprints(connection),sort_keys=True,separators=(",",":")),"S39_MIGRATION",datetime.now(timezone.utc).isoformat()))
        connection.close()
        if failure_step == "revision": raise RuntimeError("INJECTED_FAILURE")
        os.replace(temporary, source)
        LOGGER.info("schema_migration_committed", extra={"source_revision": S39.predecessor, "target_revision": S39.revision, "sessions_created": update_count + roster_count, "batches_linked": update_count + roster_count, "triggers_installed": True, "validation_passed": True})
        return "MIGRATION_COMPLETE"
    except Exception:
        if temporary.exists(): temporary.unlink()
        LOGGER.exception("schema_migration_failed", extra={"safe_failure_code": "S39_MIGRATION_ABORTED"})
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
    upgrade = commands.add_parser("upgrade-s39")
    upgrade.add_argument("--database", required=True, type=Path)
    upgrade_s40 = commands.add_parser("upgrade-s40")
    upgrade_s40.add_argument("--database", required=True, type=Path)
    for table in PROTECTED_TABLES:
        adopt.add_argument(f"--expected-{table.replace('_', '-')}", required=True, type=int)
    arguments = parser.parse_args(argv)
    if arguments.command == "initialize-fresh":
        print(json.dumps({"status": initialize_fresh_sqlite_database(arguments.database)}))
        return 0
    if arguments.command == "upgrade-s39":
        print(json.dumps({"status": migrate_s38_to_s39_sqlite(arguments.database)}))
        return 0
    if arguments.command == "upgrade-s40":
        from core.enrollment_ledger_migration import migrate_enrollment_ledger_sqlite
        print(json.dumps({"status": migrate_enrollment_ledger_sqlite(arguments.database)}))
        return 0
    if arguments.baseline != BASELINE.revision:
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
