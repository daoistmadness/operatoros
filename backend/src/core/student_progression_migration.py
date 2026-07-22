"""Explicit S4.0 to S4.1 progression-schema migration for isolated databases."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
PROTECTED_DATABASES = {(ROOT / "backend" / "attendance.db").resolve(), (ROOT / "attendance.db").resolve()}
SQLITE_MIGRATION = ROOT / "backend" / "migrations" / "20260722_student_progression_rollover_sqlite.sql"
PRESERVED_TABLES = (
    "students", "student_masters", "student_device_identities", "student_enrollments",
    "student_enrollment_class_history", "student_enrollment_lifecycle_audit",
    "attendance", "student_subject_grades", "academic_interventions",
    "student_import_sessions", "student_import_applied_actions",
)


def _fingerprints(connection: sqlite3.Connection) -> dict[str, dict[str, object]]:
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    result = {}
    for table in PRESERVED_TABLES:
        if table not in tables:
            continue
        columns = [row[1] for row in connection.execute(f"PRAGMA table_info({table})")]
        ordering = ",".join(f'"{column}"' for column in columns)
        rows = connection.execute(f"SELECT * FROM {table} ORDER BY {ordering}").fetchall()
        result[table] = {"count": len(rows), "sha256": hashlib.sha256(repr(rows).encode()).hexdigest()}
    return result


def migrate_student_progression_sqlite(path: Path, *, failure_step: str | None = None) -> str:
    target = path.resolve(strict=True)
    if target in PROTECTED_DATABASES:
        raise RuntimeError("PROTECTED_DATABASE_PATH_REJECTED")
    if os.environ.get("OPERATOROS_ISOLATED_TEST", "").lower() != "true":
        raise RuntimeError("ISOLATED_MIGRATION_APPROVAL_REQUIRED")
    with sqlite3.connect(target) as source:
        tables = {row[0] for row in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "student_progression_preview_batches" in tables:
            triggers = {row[0] for row in source.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
            if not {"trg_student_progression_audit_no_update", "trg_student_progression_audit_no_delete"}.issubset(triggers):
                raise RuntimeError("MIGRATION_VALIDATION_FAILED: progression audit triggers")
            return "MIGRATION_ALREADY_CURRENT"
        if "operatoros_schema_migrations" not in tables:
            raise RuntimeError("UNSUPPORTED_SCHEMA: S4.0 ledger required")
        revision = source.execute("SELECT version FROM operatoros_schema_migrations ORDER BY applied_at DESC, version DESC LIMIT 1").fetchone()
        if revision != ("20260722_s40",):
            raise RuntimeError("UNSUPPORTED_SCHEMA: S4.0 predecessor required")
        before = _fingerprints(source)

    temporary = target.with_name(f".{target.name}.progression-migrating")
    if temporary.exists():
        temporary.unlink()
    # SQLite's backup API includes committed WAL pages; copying only the main
    # file can publish an older schema when the source uses WAL mode.
    with sqlite3.connect(f"file:{target.as_posix()}?mode=ro", uri=True) as source, sqlite3.connect(temporary) as destination:
        source.backup(destination)
    shutil.copystat(target, temporary)
    try:
        with sqlite3.connect(temporary) as connection:
            connection.execute("PRAGMA journal_mode=DELETE")
            connection.executescript(SQLITE_MIGRATION.read_text(encoding="utf-8"))
            if failure_step == "schema":
                raise RuntimeError("INJECTED_FAILURE:schema")
            if _fingerprints(connection) != before:
                raise RuntimeError("MIGRATION_VALIDATION_FAILED: preserved data changed")
            if connection.execute("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("MIGRATION_VALIDATION_FAILED: foreign keys")
            objects = connection.execute(
                "SELECT type,name,tbl_name,COALESCE(sql,'') FROM sqlite_master "
                "WHERE name NOT LIKE 'sqlite_%' AND name != 'operatoros_schema_migrations' ORDER BY type,name"
            ).fetchall()
            fingerprint = hashlib.sha256(repr(objects).encode()).hexdigest()
            connection.execute(
                "INSERT INTO operatoros_schema_migrations(version,predecessor,schema_fingerprint,protected_fingerprints,approved_by,applied_at) VALUES(?,?,?,?,?,?)",
                ("20260722_s41", "20260722_s40", fingerprint, json.dumps(before, sort_keys=True, separators=(",", ":")), "STUDENT_PROGRESSION_ROLLOVER", datetime.now(timezone.utc).isoformat()),
            )
            if failure_step == "ledger":
                raise RuntimeError("INJECTED_FAILURE:ledger")
        with sqlite3.connect(temporary) as validation:
            validation.execute("PRAGMA foreign_keys=ON")
            if validation.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                raise RuntimeError("MIGRATION_VALIDATION_FAILED: integrity")
            if validation.execute("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("MIGRATION_VALIDATION_FAILED: foreign keys")
        # The published main file must never be paired with stale sidecars from
        # the S4.0 source. This path is already restricted to isolated targets.
        for suffix in ("-wal", "-shm"):
            sidecar = Path(str(target) + suffix)
            if sidecar.exists():
                sidecar.unlink()
        os.replace(temporary, target)
        for suffix in ("-wal", "-shm"):
            temporary_sidecar = Path(str(temporary) + suffix)
            if temporary_sidecar.exists():
                temporary_sidecar.unlink()
        return "MIGRATION_COMPLETE"
    except Exception:
        if temporary.exists():
            temporary.unlink()
        raise
