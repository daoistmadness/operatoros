#!/usr/bin/env python3
"""Independent database writer quiescence verifier for OperatorOS operational maintenance."""

from __future__ import annotations

import os
from pathlib import Path
import sqlite3
import subprocess
import sys


def check_open_handles_proc(targets: set[Path]) -> list[str]:
    """Scan /proc/*/fd for processes holding any target database file open."""
    findings: list[str] = []
    proc_root = Path("/proc")
    if not proc_root.is_dir():
        return findings
    my_pid = str(os.getpid())
    for entry in proc_root.iterdir():
        if not entry.name.isdigit() or entry.name == my_pid:
            continue
        fd_dir = entry / "fd"
        try:
            for fd in fd_dir.iterdir():
                try:
                    resolved = Path(os.readlink(fd)).resolve()
                except OSError:
                    continue
                if resolved in targets:
                    findings.append(f"pid={entry.name} fd={fd.name} target={resolved}")
        except OSError:
            continue
    return findings


def check_open_handles_lsof(targets: list[Path]) -> list[str]:
    """Run lsof on existing database and sidecar paths when available."""
    existing = [str(p) for p in targets if p.exists()]
    if not existing:
        return []
    for cmd in (["lsof", "-nP", "--", *existing], ["sudo", "-n", "lsof", "-nP", "--", *existing]):
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=10, check=False)
        except FileNotFoundError:
            return []
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("lsof timed out while checking database handles") from exc
        if proc.returncode == 0:
            lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
            return lines[1:] if len(lines) > 1 else lines
        if proc.returncode == 1:
            # Exit 1 means no open handles found (or partial permission warning if unprivileged)
            if "Permission denied" not in proc.stderr:
                return []
            continue
    return []


def verify_quiescence(data_dir: Path, *, require_db: bool = True) -> tuple[bool, str]:
    """Verify no active writers, open handles, pending sidecars, or SQLite locks remain."""
    if not data_dir.is_dir():
        return False, f"Data directory does not exist: {data_dir}"

    resolved_dir = data_dir.resolve()
    db_path = resolved_dir / "operatoros.sqlite"
    if not db_path.exists():
        if require_db:
            return False, f"Operational database missing: {db_path}"
        return True, "No live database present"

    wal_path = Path(f"{db_path}-wal")
    shm_path = Path(f"{db_path}-shm")
    journal_path = Path(f"{db_path}-journal")
    target_list = [db_path, wal_path, shm_path, journal_path]
    target_set = {p.resolve() if p.exists() else p for p in target_list}

    # 1. Check for open file handles regardless of WAL/SHM presence
    lsof_hits = check_open_handles_lsof(target_list)
    if lsof_hits:
        return False, f"Open database file handle(s) detected via lsof: {'; '.join(lsof_hits[:5])}"

    proc_hits = check_open_handles_proc(target_set)
    if proc_hits:
        return False, f"Open database file handle(s) detected via /proc: {'; '.join(proc_hits[:5])}"

    # 2. Check sidecar state (absence of WAL/SHM is necessary for migration, never sufficient alone)
    if journal_path.exists():
        return False, f"Rollback journal sidecar present: {journal_path}"
    if wal_path.exists() and wal_path.stat().st_size > 0:
        return False, f"Non-empty WAL sidecar present ({wal_path.stat().st_size} bytes): {wal_path}"

    # 3. Non-blocking SQLite exclusive lock probe to prove zero active SQLite readers/writers
    try:
        conn = sqlite3.connect(str(db_path), timeout=0.0, isolation_level=None)
        try:
            conn.execute("PRAGMA busy_timeout = 0")
            conn.execute("BEGIN EXCLUSIVE")
            conn.execute("ROLLBACK")
        finally:
            conn.close()
    except sqlite3.OperationalError as exc:
        return False, f"SQLite exclusive lock probe failed (active database lock): {exc}"
    except sqlite3.Error as exc:
        return False, f"SQLite database inspection failed: {exc}"

    return True, f"Writer quiescence verified for {db_path}"


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 1:
        sys.stderr.write("Usage: verify-writer-quiescence.py <data-dir>\n")
        return 2
    ok, message = verify_quiescence(Path(args[0]))
    if not ok:
        sys.stderr.write(f"Error: {message}\n")
        return 1
    print(message)
    return 0


if __name__ == "__main__":
    sys.exit(main())
