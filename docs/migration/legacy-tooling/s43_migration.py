#!/usr/bin/env python3
"""Guarded S4.3 migration entry point for rehearsal and operational targets."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import os
import sqlite3
import subprocess
from pathlib import Path

from core.database_access_context import operational_migration_access_context


CONFIRMATION = "MIGRATE_S43_EXPLICIT_DATABASE"
OPERATIONAL_CONFIRMATION = "AUTHORIZE_OPERATIONAL_S43_MIGRATION"
S42_HEAD = "20260724_s42"
S43_HEAD = "20260725_s43"
LOCK_PATH = Path("/tmp/operatoros-s43-operational-migration.lock")
REPOSITORY = Path(__file__).resolve().parents[1]
OPERATIONAL_DATABASE = (REPOSITORY / "backend" / "attendance.db").resolve()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def schema_head(path: Path) -> str | None:
    with sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True) as connection:
        row = connection.execute(
            "SELECT version FROM operatoros_schema_migrations "
            "ORDER BY applied_at DESC, version DESC LIMIT 1"
        ).fetchone()
    return row[0] if row else None


def has_open_handle(path: Path) -> bool:
    try:
        result = subprocess.run(
            ["lsof", "--", str(path)], check=False, capture_output=True, text=True
        )
    except FileNotFoundError as exc:
        raise RuntimeError("OPERATIONAL_MIGRATION_LSOF_REQUIRED") from exc
    return result.returncode == 0 and bool(result.stdout.strip())


def verify_no_sidecars(path: Path) -> None:
    for suffix in ("-wal", "-shm", "-journal"):
        if Path(f"{path}{suffix}").exists():
            raise RuntimeError(f"DATABASE_SIDECAR_PRESENT: {path}{suffix}")


def verify_operational_preflight(path: Path, backup: Path) -> str:
    if path != OPERATIONAL_DATABASE:
        raise RuntimeError("OPERATIONAL_MIGRATION_PATH_MISMATCH")
    if not backup.is_file():
        raise RuntimeError("OPERATIONAL_MIGRATION_BACKUP_REQUIRED")
    verify_no_sidecars(path)
    if has_open_handle(path):
        raise RuntimeError("OPERATIONAL_MIGRATION_OPEN_HANDLE")
    source_checksum = sha256(path)
    if sha256(backup) != source_checksum:
        raise RuntimeError("OPERATIONAL_MIGRATION_BACKUP_CHECKSUM_MISMATCH")
    if schema_head(path) != S42_HEAD:
        raise RuntimeError("OPERATIONAL_MIGRATION_SOURCE_HEAD_INVALID")
    return source_checksum


def verify_post_migration(path: Path) -> None:
    with sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True) as connection:
        head = schema_head(path)
        ledger = connection.execute(
            "SELECT COUNT(*) FROM operatoros_schema_migrations WHERE version=?", (S43_HEAD,)
        ).fetchone()[0]
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        expected = {"attendance_follow_ups", "attendance_follow_up_notes", "attendance_follow_up_audit"}
        if head != S43_HEAD or ledger != 1 or not expected.issubset(tables):
            raise RuntimeError("S43_POST_MIGRATION_VERIFICATION_FAILED")
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("S43_POST_MIGRATION_INTEGRITY_FAILED")
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise RuntimeError("S43_POST_MIGRATION_QUICK_CHECK_FAILED")
        if connection.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("S43_POST_MIGRATION_FOREIGN_KEYS_FAILED")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--confirm")
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--operational-confirm")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    path = args.database.resolve(strict=True)
    operational = path == OPERATIONAL_DATABASE

    if not operational and args.confirm != CONFIRMATION:
        raise SystemExit("confirmation token rejected")
    if operational and args.backup is None:
        raise SystemExit("operational migration requires --backup")
    if operational:
        backup = args.backup.resolve(strict=True)
    else:
        verify_no_sidecars(path)
        if schema_head(path) != S42_HEAD:
            raise SystemExit(f"unsupported source head: {schema_head(path)}")

    with LOCK_PATH.open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if operational:
            source_checksum = verify_operational_preflight(path, backup)
            if args.dry_run:
                print("OPERATIONAL_PATH_PREFLIGHT_READY")
                return 0
            if args.confirm != CONFIRMATION or args.operational_confirm != OPERATIONAL_CONFIRMATION:
                raise SystemExit("operational confirmation token rejected")
            # Importing config and migration code happens only after immutable
            # preflight and the process-local operational context are active.
            with operational_migration_access_context(
                database_path=path,
                expected_source_sha256=source_checksum,
                expected_source_head=S42_HEAD,
                backup_path=backup,
                lock_path=LOCK_PATH,
                lock_held=True,
                preflight_verified=True,
            ):
                from core.attendance_followup_migration import migrate_attendance_followup_sqlite

                result = migrate_attendance_followup_sqlite(path)
        else:
            from core.attendance_followup_migration import migrate_attendance_followup_sqlite

            result = migrate_attendance_followup_sqlite(path)
    verify_post_migration(path)
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
