"""Explicit, isolated migration for enrollment-ledger lifecycle safety.

This module is never imported by application startup. Operators must run the
approved schema workflow against a copy; the protected repository database is
unconditionally refused.
"""

from __future__ import annotations

import os
import hashlib
import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
PROTECTED_DATABASES = {
    (ROOT / "backend" / "attendance.db").resolve(),
    (ROOT / "attendance.db").resolve(),
}
SQLITE_MIGRATION = ROOT / "backend" / "migrations" / "20260722_student_enrollment_ledger_safety_sqlite.sql"


def migrate_enrollment_ledger_sqlite(path: Path) -> str:
    target = path.resolve(strict=True)
    if target in PROTECTED_DATABASES:
        raise RuntimeError("PROTECTED_DATABASE_PATH_REJECTED")
    if os.environ.get("OPERATOROS_ISOLATED_TEST", "").lower() != "true":
        raise RuntimeError("ISOLATED_MIGRATION_APPROVAL_REQUIRED")
    with sqlite3.connect(target) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(student_enrollments)")}
        if "lifecycle_state" in columns:
            foreign_keys = connection.execute("PRAGMA foreign_key_list(student_enrollments)").fetchall()
            student_fk = next((row for row in foreign_keys if row[3] == "student_id"), None)
            if student_fk is None or student_fk[6].upper() != "SET NULL":
                raise RuntimeError("MIGRATION_VALIDATION_FAILED: student_id foreign key")
            return "MIGRATION_ALREADY_CURRENT"
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "operatoros_schema_migrations" in tables:
            revision = connection.execute("SELECT version FROM operatoros_schema_migrations ORDER BY applied_at DESC LIMIT 1").fetchone()
            if revision != ("20260722_s39",):
                raise RuntimeError("UNSUPPORTED_SCHEMA: S3.9 predecessor required")
        before_counts = {
            table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("students", "student_masters", "student_device_identities", "attendance", "student_enrollments")
            if table in tables
        }
    temporary = target.with_name(f".{target.name}.enrollment-ledger-migrating")
    if temporary.exists():
        temporary.unlink()
    shutil.copy2(target, temporary)
    try:
        with sqlite3.connect(temporary) as connection:
            connection.executescript(SQLITE_MIGRATION.read_text(encoding="utf-8"))
            after_counts = {table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in before_counts}
            if after_counts != before_counts:
                raise RuntimeError("MIGRATION_VALIDATION_FAILED: protected counts changed")
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if "operatoros_schema_migrations" in tables:
                objects = connection.execute(
                    "SELECT type,name,tbl_name,COALESCE(sql,'') FROM sqlite_master "
                    "WHERE name NOT LIKE 'sqlite_%' AND name != 'operatoros_schema_migrations' ORDER BY type,name"
                ).fetchall()
                fingerprint = hashlib.sha256(repr(objects).encode("utf-8")).hexdigest()
                protected = {table: {"count": count} for table, count in after_counts.items()}
                connection.execute(
                    "INSERT INTO operatoros_schema_migrations(version,predecessor,schema_fingerprint,protected_fingerprints,approved_by,applied_at) VALUES(?,?,?,?,?,?)",
                    ("20260722_s40", "20260722_s39", fingerprint, json.dumps(protected, sort_keys=True), "ENROLLMENT_LEDGER_SAFETY", datetime.now(timezone.utc).isoformat()),
                )
        with sqlite3.connect(temporary) as validation:
            validation.execute("PRAGMA foreign_keys=ON")
            if validation.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                raise RuntimeError("MIGRATION_VALIDATION_FAILED: integrity")
            if validation.execute("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("MIGRATION_VALIDATION_FAILED: foreign keys")
        os.replace(temporary, target)
        return "MIGRATION_COMPLETE"
    except Exception:
        if temporary.exists():
            temporary.unlink()
        raise
