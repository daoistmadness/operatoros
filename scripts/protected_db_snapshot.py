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


def sidecars_for(path: Path) -> list[Path]:
    return [Path(f"{path}{suffix}") for suffix in ("-wal", "-shm", "-journal")]


def is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def git_worktree_roots(repository: Path) -> set[Path]:
    result = subprocess.run(
        ["git", "-C", str(repository), "worktree", "list", "--porcelain"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        fail("PROTECTED_DATABASE_WORKTREE_DISCOVERY_FAILED")
    return {
        Path(line.removeprefix("worktree ")).resolve(strict=True)
        for line in result.stdout.splitlines()
        if line.startswith("worktree ")
    }


def canonical_path(value: str) -> Path:
    candidate = Path(value)
    if not candidate.is_absolute():
        fail("PROTECTED_DATABASE_PATH_NOT_ABSOLUTE")
    if any(component.is_symlink() for component in (candidate, *candidate.parents)):
        fail("PROTECTED_DATABASE_SYMLINK_REJECTED")
    try:
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError:
        fail("PROTECTED_DATABASE_PATH_MISSING")
    if candidate != resolved:
        fail("PROTECTED_DATABASE_PATH_NOT_CANONICAL")
    return resolved


def validate_snapshot_path(path: Path, repository: Path, *, explicit: bool) -> Path:
    path = canonical_path(str(path))
    repository = repository.resolve(strict=True)
    if path.name != "attendance.db" or path.parent.name != "backend":
        fail("PROTECTED_DATABASE_PATH_MISMATCH")
    source_root = path.parent.parent
    if source_root / "backend" / "attendance.db" != path:
        fail("PROTECTED_DATABASE_PATH_MISMATCH")
    if is_within(path, repository):
        if explicit:
            fail("PROTECTED_DATABASE_PATH_INSIDE_WORKTREE")
        return path
    if explicit and source_root not in git_worktree_roots(repository):
        fail("PROTECTED_DATABASE_UNAPPROVED_WORKTREE")
    return path


def select_protected_database(repository: Path, explicit_path: str | None = None) -> tuple[str, Path]:
    repository = repository.resolve(strict=True)
    explicit_path = explicit_path if explicit_path is not None else os.environ.get("PROTECTED_DB_PATH")
    if explicit_path:
        return "snapshot", validate_snapshot_path(Path(explicit_path), repository, explicit=True)
    local_path = repository / "backend" / "attendance.db"
    if local_path.exists():
        return "snapshot", validate_snapshot_path(local_path, repository, explicit=False)
    return "absent", local_path


def assert_absent(path: Path) -> None:
    if path.exists() or any(sidecar.exists() for sidecar in sidecars_for(path)):
        fail("PROTECTED_DATABASE_UNEXPECTEDLY_PRESENT")


def snapshot(path: Path) -> dict[str, object]:
    path = canonical_path(str(path))
    if path.name != "attendance.db" or path.parent.name != "backend":
        fail("PROTECTED_DATABASE_PATH_MISMATCH")
    sidecars = [str(sidecar) for sidecar in sidecars_for(path) if sidecar.exists()]
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
    connection = sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True)
    try:
        head_row = connection.execute("SELECT version FROM operatoros_schema_migrations ORDER BY applied_at DESC, version DESC LIMIT 1").fetchone()
        head = head_row[0] if head_row else None
        ledger = connection.execute("SELECT COUNT(*) FROM operatoros_schema_migrations WHERE version=?", (S43_HEAD,)).fetchone()[0]
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        quick = connection.execute("PRAGMA quick_check").fetchone()[0]
        foreign_keys = len(connection.execute("PRAGMA foreign_key_check").fetchall())
    finally:
        connection.close()
    if head != S43_HEAD or ledger != 1 or not EXPECTED_TABLES.issubset(tables):
        fail("PROTECTED_DATABASE_S43_STATE_INVALID")
    if integrity != "ok" or quick != "ok" or foreign_keys:
        fail("PROTECTED_DATABASE_INTEGRITY_INVALID")
    return {"path": str(path), "sha256": digest, "size": stat.st_size, "inode": stat.st_ino,
            "mode": stat.st_mode & 0o7777, "mtime_ns": stat.st_mtime_ns, "ctime_ns": stat.st_ctime_ns,
            "head": head, "ledger": ledger, "integrity": integrity, "quick": quick,
            "foreign_key_violations": foreign_keys, "sidecars": sidecars}


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "select":
        mode, path = select_protected_database(Path(sys.argv[2]))
        print(f"{mode}\t{path}")
        return
    if len(sys.argv) == 3 and sys.argv[1] == "assert-absent":
        assert_absent(Path(sys.argv[2]))
        return
    if len(sys.argv) == 2:
        print(json.dumps(snapshot(Path(sys.argv[1])), sort_keys=True))
        return
    fail("usage: protected_db_snapshot.py [select REPOSITORY|assert-absent PATH|PATH]")


if __name__ == "__main__":
    main()
