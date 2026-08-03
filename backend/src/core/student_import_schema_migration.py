"""Explicit, additive SQLite schema support for canonical student imports."""

from __future__ import annotations

import sqlite3
from pathlib import Path


STUDENT_IMPORT_SCHEMA_VERSION = "20260803_student_import_linking"


def _safe_database_path(database: str | Path) -> Path:
    path = Path(database)
    if not path.is_absolute():
        raise ValueError("STUDENT_IMPORT_DATABASE_PATH_MUST_BE_ABSOLUTE")
    resolved = path.resolve()
    repository = Path(__file__).resolve().parents[3]
    if resolved.name == "attendance.db":
        raise ValueError("PROTECTED_OPERATIONAL_DATABASE_REJECTED")
    session_root = (repository / ".runtime" / "operatoros-dev" / "sessions").resolve()
    if resolved == session_root or session_root in resolved.parents:
        raise ValueError("EPHEMERAL_SESSION_DATABASE_REJECTED")
    if resolved.suffix.lower() not in {".db", ".sqlite", ".sqlite3"}:
        raise ValueError("STUDENT_IMPORT_DATABASE_MUST_BE_SQLITE")
    if not resolved.is_file():
        raise ValueError("STUDENT_IMPORT_DATABASE_MUST_ALREADY_EXIST")
    return resolved


def _columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}


def ensure_student_import_schema(database: str | Path) -> str:
    """Apply only the additive import columns to an explicitly supplied DB."""

    path = _safe_database_path(database)
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise RuntimeError("STUDENT_IMPORT_SCHEMA_INTEGRITY_CHECK_FAILED")
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        required = {"student_masters", "student_enrollments", "academic_classes"}
        missing = sorted(required - tables)
        if missing:
            raise ValueError("STUDENT_IMPORT_SCHEMA_UNSUPPORTED: " + ", ".join(missing))

        additions = {
            "student_masters": {
                "dapodik_peserta_didik_id": "VARCHAR(64) NULL",
                "dapodik_sekolah_id": "VARCHAR(64) NULL",
                "dapodik_last_update_at": "DATETIME NULL",
            },
            "student_enrollments": {
                "dapodik_registrasi_id": "VARCHAR(64) NULL",
                "dapodik_anggota_rombel_id": "VARCHAR(64) NULL",
                "dapodik_sekolah_id": "VARCHAR(64) NULL",
                "dapodik_semester_id": "VARCHAR(32) NULL",
            },
            "academic_classes": {
                "dapodik_rombongan_belajar_id": "VARCHAR(64) NULL",
                "dapodik_sekolah_id": "VARCHAR(64) NULL",
                "dapodik_semester_id": "VARCHAR(32) NULL",
                "dapodik_last_update_at": "DATETIME NULL",
            },
        }
        for table, fields in additions.items():
            present = _columns(connection, table)
            for name, definition in fields.items():
                if name not in present:
                    connection.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")

        indexes = (
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_student_masters_dapodik_peserta_didik_id "
            "ON student_masters(dapodik_peserta_didik_id) WHERE dapodik_peserta_didik_id IS NOT NULL",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_student_enrollments_dapodik_registrasi_id "
            "ON student_enrollments(dapodik_registrasi_id) WHERE dapodik_registrasi_id IS NOT NULL",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_student_enrollments_dapodik_anggota_rombel_id "
            "ON student_enrollments(dapodik_anggota_rombel_id) WHERE dapodik_anggota_rombel_id IS NOT NULL",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_academic_classes_dapodik_rombongan_belajar_id "
            "ON academic_classes(dapodik_rombongan_belajar_id) WHERE dapodik_rombongan_belajar_id IS NOT NULL",
            "CREATE INDEX IF NOT EXISTS ix_student_masters_dapodik_school "
            "ON student_masters(dapodik_sekolah_id)",
            "CREATE INDEX IF NOT EXISTS ix_student_enrollments_dapodik_scope "
            "ON student_enrollments(dapodik_sekolah_id, dapodik_semester_id)",
            "CREATE INDEX IF NOT EXISTS ix_academic_classes_dapodik_scope "
            "ON academic_classes(dapodik_sekolah_id, dapodik_semester_id)",
        )
        for statement in indexes:
            connection.execute(statement)
        if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise RuntimeError("STUDENT_IMPORT_SCHEMA_INTEGRITY_CHECK_FAILED")
        if connection.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("STUDENT_IMPORT_SCHEMA_FOREIGN_KEY_CHECK_FAILED")
    return STUDENT_IMPORT_SCHEMA_VERSION


def student_import_schema_ready(database: str | Path) -> bool:
    path = _safe_database_path(database)
    with sqlite3.connect(path) as connection:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        if not {"student_masters", "student_enrollments", "academic_classes"}.issubset(tables):
            return False
        return all(
            required in _columns(connection, table)
            for table, required in (
                ("student_masters", "dapodik_peserta_didik_id"),
                ("student_enrollments", "dapodik_registrasi_id"),
                ("academic_classes", "dapodik_rombongan_belajar_id"),
            )
        )
