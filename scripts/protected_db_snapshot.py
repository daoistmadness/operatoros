#!/usr/bin/env python3
"""Immutable, run-relative validation for the protected operational SQLite DB."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import fcntl
from pathlib import Path

S43_HEAD = "20260725_s43"
EXPECTED_TABLES = {
    "attendance_follow_ups",
    "attendance_follow_up_notes",
    "attendance_follow_up_audit",
}


def fail(message: str) -> None:
    raise SystemExit(message)


def snapshot(path: Path) -> dict[str, object]:
    path = path.resolve(strict=True)
    if path.name != "attendance.db" or path.parent.name != "backend":
        fail("PROTECTED_DATABASE_PATH_MISMATCH")
    sidecars = [str(Path(f"{path}{suffix}")) for suffix in ("-wal", "-shm", "-journal") if Path(f"{path}{suffix}").exists()]
    if sidecars:
        fail("PROTECTED_DATABASE_SIDECAR_PRESENT: " + ",".join(sidecars))
    lock = Path("/tmp/operatoros-s43-operational-migration.lock")
    if lock.exists():
        with lock.open("r") as stream:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                fail("PROTECTED_DATABASE_MIGRATION_LOCK_PRESENT")
            finally:
                try:
                    fcntl.flock(stream, fcntl.LOCK_UN)
                except OSError:
                    pass
    handles = subprocess.run(["lsof", "--", str(path)], capture_output=True, text=True, check=False)
    if handles.returncode == 0 and handles.stdout.strip():
        fail("PROTECTED_DATABASE_OPEN_HANDLE: " + handles.stdout.strip())
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    stat = path.stat()
    with sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True) as connection:
        head_row = connection.execute("SELECT version FROM operatoros_schema_migrations ORDER BY applied_at DESC, version DESC LIMIT 1").fetchone()
        head = head_row[0] if head_row else None
        ledger = connection.execute("SELECT COUNT(*) FROM operatoros_schema_migrations WHERE version=?", (S43_HEAD,)).fetchone()[0]
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        quick = connection.execute("PRAGMA quick_check").fetchone()[0]
        foreign_keys = len(connection.execute("PRAGMA foreign_key_check").fetchall())
    if head != S43_HEAD or ledger != 1 or not EXPECTED_TABLES.issubset(tables):
        fail("PROTECTED_DATABASE_S43_STATE_INVALID")
    if integrity != "ok" or quick != "ok" or foreign_keys:
        fail("PROTECTED_DATABASE_INTEGRITY_INVALID")
    return {"path": str(path), "sha256": digest, "size": stat.st_size, "inode": stat.st_ino,
            "mode": stat.st_mode & 0o7777, "mtime_ns": stat.st_mtime_ns, "ctime_ns": stat.st_ctime_ns,
            "head": head, "ledger": ledger, "integrity": integrity, "quick": quick,
            "foreign_key_violations": foreign_keys, "sidecars": sidecars}


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: protected_db_snapshot.py /absolute/path/to/attendance.db")
    print(json.dumps(snapshot(Path(sys.argv[1])), sort_keys=True))


if __name__ == "__main__":
    main()
