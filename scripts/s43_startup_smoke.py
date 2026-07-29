#!/usr/bin/env python3
"""Bounded backend startup smoke for explicit rehearsal databases."""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

PROTECTED_NAME = "attendance.db"
REDACTIONS = (
    re.compile(r"(?i)(password|secret|token|authorization)([\"'=:\s]+)(\S+)"),
    re.compile(r"(?i)(cookie:\s*)(\S+)"),
)


def validate_rehearsal_database(path: Path, repository: Path, expected_head: str) -> Path:
    selected = path.resolve(strict=True)
    protected = (repository / "backend" / PROTECTED_NAME).resolve()
    if selected == protected or repository.resolve() in selected.parents:
        raise ValueError("REHEARSAL_DATABASE_PATH_REJECTED")
    with sqlite3.connect(f"file:{selected}?mode=ro&immutable=1", uri=True) as connection:
        head = connection.execute(
            "SELECT version FROM operatoros_schema_migrations "
            "ORDER BY applied_at DESC, version DESC LIMIT 1"
        ).fetchone()
    if head != (expected_head,):
        raise ValueError(f"REHEARSAL_SCHEMA_HEAD_MISMATCH: {head[0] if head else None}")
    return selected


def allocate_port(host: str = "127.0.0.1") -> int:
    with socket.socket() as listener:
        listener.bind((host, 0))
        return int(listener.getsockname()[1])


def assert_port_free(port: int, host: str = "127.0.0.1") -> None:
    with socket.socket() as listener:
        try:
            listener.bind((host, port))
        except OSError as exc:
            raise RuntimeError(f"PORT_CONFLICT: {host}:{port}") from exc


def sanitize_log_tail(path: Path, lines: int = 80) -> str:
    content = path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:]
    sanitized = "\n".join(content)
    for pattern in REDACTIONS:
        sanitized = pattern.sub(r"\1\2[REDACTED]", sanitized)
    return sanitized


def source_evidence(python: Path, backend: Path, environment: dict[str, str]) -> list[str]:
    command = [
        str(python),
        "-c",
        (
            "import pathlib,sys,src.main,core.schema_guard,models.student;"
            "print(pathlib.Path(src.main.__file__).resolve());"
            "print(pathlib.Path(core.schema_guard.__file__).resolve());"
            "print(pathlib.Path(models.student.__file__).resolve());"
            "print(pathlib.Path(sys.executable).absolute())"
        ),
    ]
    result = subprocess.run(
        command,
        cwd=backend,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    evidence = result.stdout.splitlines()
    expected_root = backend.resolve()
    if len(evidence) != 4 or any(
        expected_root not in Path(item).resolve().parents for item in evidence[:3]
    ):
        raise RuntimeError("WRONG_SOURCE_TREE_IMPORTED")
    if Path(evidence[3]).absolute() != python.absolute():
        raise RuntimeError("WRONG_PYTHON_EXECUTABLE")
    return evidence


def wait_for_readiness(
    process: subprocess.Popen[str],
    url: str,
    log_path: Path,
    timeout_seconds: float,
) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error = "readiness not attempted"
    while time.monotonic() < deadline:
        exit_code = process.poll()
        if exit_code is not None:
            raise RuntimeError(
                f"BACKEND_EXITED_EARLY: exit={exit_code}\n{sanitize_log_tail(log_path)}"
            )
        try:
            with urllib.request.urlopen(url, timeout=0.5) as response:
                if response.status == 200:
                    return
                last_error = f"HTTP {response.status}"
        except (urllib.error.URLError, TimeoutError) as exc:
            last_error = type(exc).__name__
        time.sleep(0.1)
    raise RuntimeError(
        f"BACKEND_READINESS_TIMEOUT: {last_error}\n{sanitize_log_tail(log_path)}"
    )


def terminate(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def checkpoint_sqlite_bookkeeping(database: Path) -> None:
    """Finish pre-smoke WAL bookkeeping without changing application data."""
    with sqlite3.connect(database) as connection:
        result = connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
    if result is None or result[0] != 0:
        raise RuntimeError(f"SQLITE_WAL_CHECKPOINT_FAILED: {result}")


def logical_sqlite_checksum(database: Path) -> str:
    """Hash schema and row content while ignoring SQLite file-header bookkeeping."""
    digest = hashlib.sha256()
    with sqlite3.connect(f"file:{database}?mode=ro&immutable=1", uri=True) as connection:
        for statement in connection.iterdump():
            digest.update(statement.encode("utf-8"))
            digest.update(b"\n")
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", required=True, type=Path)
    parser.add_argument("--backend", required=True, type=Path)
    parser.add_argument("--python", required=True, type=Path)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--expected-head", required=True)
    parser.add_argument("--log", required=True, type=Path)
    parser.add_argument("--port", type=int)
    parser.add_argument("--timeout", type=float, default=30)
    arguments = parser.parse_args()

    repository = arguments.repository.resolve(strict=True)
    backend = arguments.backend.resolve(strict=True)
    python = arguments.python.absolute()
    if not python.is_file():
        raise ValueError("PYTHON_EXECUTABLE_NOT_FOUND")
    database = validate_rehearsal_database(
        arguments.database, repository, arguments.expected_head
    )
    port = arguments.port or allocate_port()
    assert_port_free(port)
    arguments.log.parent.mkdir(parents=True, exist_ok=True)

    environment = os.environ.copy()
    environment.update(
        {
            "DATABASE_URL": f"sqlite:///{database}",
            "PYTHONPATH": str(backend / "src"),
            "AUTH_COOKIE_SECRET": "rehearsal-only-sanitized-secret-at-least-32-characters",
            "COOKIE_SECURE": "false",
            "ALLOW_LEGACY_STARTUP_SCHEMA_MUTATION": "false",
            # The scheduler intentionally persists its first-run configuration.
            # Disable that independent worker during this read-only startup drill.
            "BACKEND_WORKERS": "2",
        }
    )
    evidence = source_evidence(python, backend, environment)
    # Source verification imports the application once. Normalize any empty WAL
    # bookkeeping it leaves behind so the checksum comparison measures only the
    # bounded server startup that follows.
    checkpoint_sqlite_bookkeeping(database)
    bytes_before = hashlib.sha256(database.read_bytes()).hexdigest()
    logical_before = logical_sqlite_checksum(database)
    command = [
        str(python),
        "-m",
        "uvicorn",
        "src.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
    ]
    with arguments.log.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            command,
            cwd=backend,
            env=environment,
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
        )
    try:
        wait_for_readiness(
            process,
            f"http://127.0.0.1:{port}/health",
            arguments.log,
            arguments.timeout,
        )
        print("BACKEND_READINESS_PASSED")
        print(f"database={database}")
        print(f"source={evidence[0]}")
        print(f"python={evidence[3]}")
        print(f"port={port}")
    finally:
        terminate(process)
    bytes_after = hashlib.sha256(database.read_bytes()).hexdigest()
    logical_after = logical_sqlite_checksum(database)
    print(
        "database_changed_by_startup="
        f"{'yes' if logical_before != logical_after else 'no'}"
    )
    print(
        "database_file_bookkeeping_changed="
        f"{'yes' if bytes_before != bytes_after else 'no'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
