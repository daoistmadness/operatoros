#!/usr/bin/env python3
"""Safe, persistent development-database lifecycle commands.

This tool never discovers or selects an old session database.  It owns only
the per-repository development data directory and accepts an old session only
when an operator supplies its exact identifier to ``adopt``.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import stat
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "src"))

SCHEMA_HEAD = "20260725_s43"
DATABASE_NAME = "operatoros-development.db"


def fail(code: str) -> None:
    raise SystemExit(code)


def contained(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def no_symlink_components(path: Path) -> None:
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        if current.is_symlink():
            fail("DEVELOPMENT_DATA_SYMLINK_REJECTED")


def common_directory(repo: Path) -> Path:
    result = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--git-common-dir"],
        text=True, capture_output=True, check=False,
    )
    if result.returncode:
        fail("DEVELOPMENT_REPOSITORY_ID_UNAVAILABLE")
    raw = Path(result.stdout.strip())
    return (repo / raw).resolve() if not raw.is_absolute() else raw.resolve()


def data_directory(repo: Path, override: str | None = None) -> tuple[Path, str, Path]:
    repo = repo.resolve(strict=True)
    common = common_directory(repo)
    digest = hashlib.sha256(str(common).encode()).hexdigest()[:16]
    source = override or os.environ.get("OPERATOROS_DEV_DATA_DIR")
    if source:
        supplied = Path(source)
        if not supplied.is_absolute():
            fail("DEVELOPMENT_DATA_PATH_NOT_ABSOLUTE")
        no_symlink_components(supplied)
        target = supplied.resolve(strict=False)
    else:
        root = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share")))
        no_symlink_components(root)
        target = root.resolve(strict=False) / "operatoros" / "development" / digest
    runtime_sessions = repo / ".runtime" / "operatoros-dev" / "sessions"
    protected_parent = repo / "backend"
    if contained(target, runtime_sessions) or contained(target, protected_parent):
        fail("DEVELOPMENT_DATA_PATH_REJECTED")
    if target.name == "attendance.db" or target == protected_parent:
        fail("DEVELOPMENT_DATA_PATH_REJECTED")
    return target, digest, common


def metadata(directory: Path, repository_id: str, common: Path) -> dict:
    return {
        "format_version": 1,
        "application": "OperatorOS",
        "repository_instance_id": repository_id,
        "git_common_directory_hash": hashlib.sha256(str(common).encode()).hexdigest(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "database_relative_filename": DATABASE_NAME,
        "schema_expectation": SCHEMA_HEAD,
        "persistence_classification": "PERSISTENT_LOCAL_DEVELOPMENT_DATABASE",
    }


def prepare(repo: Path, override: str | None = None) -> tuple[Path, Path]:
    directory, identifier, common = data_directory(repo, override)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    metadata_path = directory / "database.json"
    if not metadata_path.exists():
        fd, temporary = tempfile.mkstemp(prefix=".database.", dir=directory)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(metadata(directory, identifier, common), handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, metadata_path)
    return directory, directory / DATABASE_NAME


def inspect(database: Path) -> dict:
    if not database.exists():
        return {"exists": False, "schema_head": None, "ledger": "absent", "integrity": "absent", "administrator_configured": False, "file_size": 0}
    uri = f"file:{database.as_posix()}?mode=ro&immutable=1"
    try:
        with sqlite3.connect(uri, uri=True) as connection:
            head = connection.execute("SELECT version FROM operatoros_schema_migrations ORDER BY applied_at DESC, version DESC LIMIT 1").fetchone()
            ledger_count = connection.execute("SELECT COUNT(*) FROM operatoros_schema_migrations WHERE version=?", (SCHEMA_HEAD,)).fetchone()[0]
            users = connection.execute("SELECT COUNT(*) FROM users WHERE role='admin' AND is_active=1").fetchone()[0]
            return {"exists": True, "schema_head": head[0] if head else None, "ledger": "valid" if ledger_count == 1 else "invalid", "integrity": connection.execute("PRAGMA integrity_check").fetchone()[0], "quick_check": connection.execute("PRAGMA quick_check").fetchone()[0], "foreign_key_violations": len(connection.execute("PRAGMA foreign_key_check").fetchall()), "administrator_configured": bool(users), "file_size": database.stat().st_size}
    except sqlite3.Error:
        return {"exists": True, "schema_head": None, "ledger": "invalid", "integrity": "unreadable", "administrator_configured": False, "file_size": database.stat().st_size}


def initialize(database: Path) -> None:
    if database.exists():
        state = inspect(database)
        if state["schema_head"] != SCHEMA_HEAD or state["ledger"] != "valid" or state["integrity"] != "ok":
            fail("PERSISTENT_DEVELOPMENT_DATABASE_INCOMPATIBLE")
        return
    # Migration modules import the application database layer.  Point that
    # import at the exact disposable target; never let configuration fall back.
    os.environ["DATABASE_URL"] = f"sqlite:///{database}"
    os.environ.setdefault("OPERATOROS_ISOLATED_TEST", "true")
    from core.schema_migrations import bootstrap_fresh_sqlite_database
    bootstrap_fresh_sqlite_database(database)
    state = inspect(database)
    if state["schema_head"] != SCHEMA_HEAD or state["ledger"] != "valid" or state["integrity"] != "ok" or state["administrator_configured"]:
        fail("PERSISTENT_DEVELOPMENT_DATABASE_INITIALIZATION_FAILED")


def session_source(runtime: Path, session: str) -> Path:
    directory = (runtime / "sessions" / session).resolve(strict=True)
    if directory.parent != runtime / "sessions" or directory.name != session or directory.is_symlink():
        fail("SESSION_PATH_ESCAPE_REJECTED")
    ownership = json.loads((directory / "ownership.json").read_text(encoding="utf-8"))
    if ownership.get("application") != "OperatorOS" or ownership.get("session_id") != session:
        fail("SESSION_OWNERSHIP_UNVERIFIED")
    source = directory / "state" / DATABASE_NAME
    if not source.is_file() or source.is_symlink():
        fail("SESSION_DATABASE_UNAVAILABLE")
    return source


def candidates(runtime: Path) -> list[dict]:
    values = []
    for marker in (runtime / "sessions").glob("*/ownership.json"):
        try:
            ownership = json.loads(marker.read_text(encoding="utf-8"))
            session = ownership["session_id"]
            source = session_source(runtime, session)
            state = inspect(source)
            values.append({"session_id": session, "database_size": state["file_size"], "schema_head": state["schema_head"], "administrator_present": state["administrator_configured"], "compatibility": "compatible" if state["schema_head"] == SCHEMA_HEAD and state["ledger"] == "valid" and state["integrity"] == "ok" else "incompatible"})
        except (OSError, KeyError, ValueError, json.JSONDecodeError, SystemExit):
            continue
    return values


def adopt(repo: Path, runtime: Path, session: str, override: str | None) -> Path:
    _, destination = prepare(repo, override)
    if destination.exists():
        fail("PERSISTENT_DESTINATION_ALREADY_EXISTS")
    source = session_source(runtime, session)
    source_state = inspect(source)
    if source_state["schema_head"] != SCHEMA_HEAD or source_state["ledger"] != "valid" or source_state["integrity"] != "ok":
        fail("SESSION_DATABASE_INCOMPATIBLE")
    temporary = destination.with_name(f".{destination.name}.adopting")
    with sqlite3.connect(f"file:{source.as_posix()}?mode=ro&immutable=1", uri=True) as source_connection:
        with sqlite3.connect(temporary) as destination_connection:
            source_connection.backup(destination_connection)
    adopted = inspect(temporary)
    if adopted["schema_head"] != SCHEMA_HEAD or adopted["ledger"] != "valid" or adopted["integrity"] != "ok":
        temporary.unlink(missing_ok=True); fail("SESSION_ADOPTION_VALIDATION_FAILED")
    os.replace(temporary, destination)
    return destination


def command(args: argparse.Namespace) -> int:
    directory, database = prepare(Path(args.repo), getattr(args, "data_dir", None))
    if args.command == "path":
        print(database)
    elif args.command == "ensure":
        initialize(database); print(database)
    elif args.command == "status":
        state = inspect(database); state.update(path=str(database), protected=False, persistence_classification="PERSISTENT_LOCAL_DEVELOPMENT_DATABASE")
        print(json.dumps(state, sort_keys=True))
    elif args.command == "reset":
        if args.confirm != "RESET": fail("DEVELOPMENT_DATABASE_RESET_CONFIRMATION_REQUIRED")
        for suffix in ("", "-wal", "-shm", "-journal"):
            candidate = Path(str(database) + suffix)
            if candidate.exists(): candidate.unlink()
        initialize(database)
        print(database)
    elif args.command == "candidates":
        print(json.dumps(candidates(Path(args.runtime).resolve()), sort_keys=True))
    elif args.command == "adopt":
        print(adopt(Path(args.repo), Path(args.runtime).resolve(), args.session, getattr(args, "data_dir", None)))
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)
    for name in ("path", "ensure", "status", "reset"):
        item = commands.add_parser(name); item.add_argument("--repo", required=True); item.add_argument("--data-dir")
        if name == "reset": item.add_argument("--confirm", default="")
        item.set_defaults(func=command)
    candidate = commands.add_parser("candidates"); candidate.add_argument("--repo", required=True); candidate.add_argument("--runtime", required=True); candidate.add_argument("--data-dir"); candidate.set_defaults(func=command)
    adopt_command = commands.add_parser("adopt"); adopt_command.add_argument("--repo", required=True); adopt_command.add_argument("--runtime", required=True); adopt_command.add_argument("--session", required=True); adopt_command.add_argument("--data-dir"); adopt_command.set_defaults(func=command)
    return root


if __name__ == "__main__":
    args = parser().parse_args()
    raise SystemExit(args.func(args))
