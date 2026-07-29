#!/usr/bin/env python3
"""Guarded S4.3 migration entry point for an explicitly supplied SQLite copy."""
from __future__ import annotations

import argparse
import fcntl
import sqlite3
from pathlib import Path

from core.attendance_followup_migration import migrate_attendance_followup_sqlite

CONFIRMATION = "MIGRATE_S43_EXPLICIT_DATABASE"
LOCK_PATH = Path("/tmp/operatoros-s43-operational-migration.lock")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--confirm", required=True)
    args = parser.parse_args()
    path = args.database.resolve(strict=True)
    if args.confirm != CONFIRMATION:
        raise SystemExit("confirmation token rejected")
    if path.name == "attendance.db" and path.parent.name == "backend":
        raise SystemExit("protected operational database requires the separate authorization phase")
    for suffix in ("-wal", "-shm"):
        if Path(f"{path}{suffix}").exists():
            raise SystemExit(f"database sidecar present: {path}{suffix}")
    with LOCK_PATH.open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True) as connection:
            head = connection.execute(
                "SELECT version FROM operatoros_schema_migrations "
                "ORDER BY applied_at DESC, version DESC LIMIT 1"
            ).fetchone()
        if head != ("20260724_s42",):
            raise SystemExit(f"unsupported source head: {head[0] if head else None}")
        print(migrate_attendance_followup_sqlite(path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
