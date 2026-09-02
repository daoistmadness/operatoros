#!/usr/bin/env python3
"""Safe, persistent development-database lifecycle commands.

This tool never discovers or selects an old session database.  It owns only
the per-repository development data directory and accepts an old session only
when an operator supplies its exact identifier to ``adopt``.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import re
import sqlite3
import tempfile
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "src"))

from core.development_database import (  # noqa: E402
    DATABASE_NAME,
    LEGACY_DATABASE_NAME,
    DevelopmentDatabaseResolutionError,
    common_directory as _common_directory,
    resolve_data_directory,
)

SCHEMA_HEAD = "20260901_s46"
SUPPORTED_SCHEMA_HEADS = frozenset({"20260724_s42", "20260725_s43", "20260831_s44", "20260901_s45", SCHEMA_HEAD})
REQUIRED_BASE_TABLES = frozenset({
    "operatoros_schema_migrations",
    "students",
    "student_masters",
    "student_device_identities",
    "attendance",
    "student_enrollments",
})
MIGRATION_SIDE_CAR_SUFFIXES = ("-wal", "-shm", "-journal")


def fail(code: str) -> None:
    raise SystemExit(code)


def common_directory(repo: Path) -> Path:
    try:
        return _common_directory(repo)
    except DevelopmentDatabaseResolutionError as exc:
        fail(exc.code)


def data_directory(repo: Path, override: str | None = None) -> tuple[Path, str, Path]:
    try:
        return resolve_data_directory(
            repo,
            override,
            common_directory_resolver=common_directory,
        )
    except DevelopmentDatabaseResolutionError as exc:
        fail(exc.code)


def entry_kind(path: Path) -> str:
    if path.is_symlink():
        return "symlink"
    if path.is_file():
        return "file"
    if path.exists():
        return "other"
    return "missing"


def database_layout(directory: Path) -> str:
    canonical = directory / DATABASE_NAME
    legacy = directory / LEGACY_DATABASE_NAME
    canonical_kind = entry_kind(canonical)
    legacy_kind = entry_kind(legacy)
    if canonical_kind != "missing" and legacy_kind != "missing":
        return "CONFLICT"
    if canonical_kind not in {"missing", "file"} or legacy_kind not in {"missing", "file"}:
        return "INVALID"
    if legacy_kind == "file":
        return "LEGACY"
    if canonical_kind == "file":
        return "CANONICAL"
    return "MISSING"


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


def dotenv_defines_database_url(path: Path) -> bool:
    """Detect an active DATABASE_URL assignment without evaluating its value."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return False
    assignment = re.compile(r"^(?:export\s+)?DATABASE_URL\s*=")
    return any(assignment.match(line.strip()) for line in lines if line.strip() and not line.lstrip().startswith("#"))


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
    kind = entry_kind(database)
    if kind == "missing":
        return {"exists": False, "regular_file": False, "schema_head": None, "ledger": "absent", "integrity": "absent", "foreign_key_violations": 0, "schema_recognized": False, "schema_checksum_valid": False, "administrator_configured": False, "users_count": 0, "file_size": 0}
    if kind != "file":
        return {"exists": True, "regular_file": False, "schema_head": None, "ledger": "invalid", "integrity": "unreadable", "foreign_key_violations": 0, "schema_recognized": False, "schema_checksum_valid": False, "administrator_configured": False, "users_count": 0, "file_size": 0}
    # Read-only mode still observes a live SQLite WAL during managed startup;
    # immutable mode would report stale pre-provisioning state.
    uri = f"file:{database.as_posix()}?mode=ro"
    try:
        with sqlite3.connect(uri, uri=True) as connection:
            ledger_rows = connection.execute("SELECT version, schema_fingerprint FROM operatoros_schema_migrations ORDER BY applied_at ASC, version ASC").fetchall()
            head = ledger_rows[-1] if ledger_rows else None
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            objects = connection.execute(
                "SELECT type,name,tbl_name,COALESCE(sql,'') FROM sqlite_master "
                "WHERE name NOT LIKE 'sqlite_%' AND name != ? ORDER BY type,name",
                ("operatoros_schema_migrations",),
            ).fetchall()
            actual_fingerprint = hashlib.sha256(repr(objects).encode("utf-8")).hexdigest()
            users = connection.execute("SELECT COUNT(*) FROM users WHERE role='admin' AND is_active=1").fetchone()[0] if "users" in tables else 0
            users_count = connection.execute("SELECT COUNT(*) FROM users").fetchone()[0] if "users" in tables else 0
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            foreign_key_violations = len(connection.execute("PRAGMA foreign_key_check").fetchall())
            schema_head = head[0] if head else None
            ledger_valid = bool(ledger_rows) and all(row[0] in SUPPORTED_SCHEMA_HEADS for row in ledger_rows) and schema_head in SUPPORTED_SCHEMA_HEADS
            return {
                "exists": True,
                "regular_file": True,
                "schema_head": schema_head,
                "ledger": "valid" if ledger_valid else "invalid",
                "integrity": integrity,
                "quick_check": connection.execute("PRAGMA quick_check").fetchone()[0],
                "foreign_key_violations": foreign_key_violations,
                "schema_recognized": schema_head in SUPPORTED_SCHEMA_HEADS and REQUIRED_BASE_TABLES <= tables,
                "schema_checksum_valid": schema_head == SCHEMA_HEAD and ledger_valid and actual_fingerprint == head[1],
                "administrator_configured": bool(users),
                "users_count": users_count,
                "file_size": database.stat().st_size,
            }
    except (OSError, sqlite3.Error):
        return {"exists": True, "regular_file": True, "schema_head": None, "ledger": "invalid", "integrity": "unreadable", "foreign_key_violations": 0, "schema_recognized": False, "schema_checksum_valid": False, "administrator_configured": False, "users_count": 0, "file_size": database.stat().st_size}


def table_counts(connection: sqlite3.Connection) -> dict[str, int]:
    tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    return {table: connection.execute(f'SELECT COUNT(*) FROM "{table.replace(chr(34), chr(34) * 2)}"').fetchone()[0] for table in tables}


def migration_recovery_path(legacy: Path) -> Path:
    return legacy.with_name(f"{legacy.name}.migrated")


def remove_sidecars(database: Path) -> None:
    for suffix in MIGRATION_SIDE_CAR_SUFFIXES:
        Path(f"{database}{suffix}").unlink(missing_ok=True)


def migrate_legacy_database(directory: Path) -> bool:
    legacy = directory / LEGACY_DATABASE_NAME
    database = directory / DATABASE_NAME
    layout = database_layout(directory)
    if layout in {"MISSING", "CANONICAL"}:
        return False
    if layout == "CONFLICT":
        fail("DEVELOPMENT_DATABASE_MIGRATION_CONFLICT")
    if layout == "INVALID":
        fail("DEVELOPMENT_DATABASE_LEGACY_LAYOUT_INVALID")

    if entry_kind(legacy) != "file":
        fail("DEVELOPMENT_DATABASE_LEGACY_FILE_INVALID")
    recovery = migration_recovery_path(legacy)
    recovery_sidecars = {suffix: Path(f"{recovery}{suffix}") for suffix in MIGRATION_SIDE_CAR_SUFFIXES}
    for candidate in (recovery, *recovery_sidecars.values()):
        if candidate.exists() or candidate.is_symlink():
            fail("DEVELOPMENT_DATABASE_MIGRATION_RECOVERY_EXISTS")
    for suffix in MIGRATION_SIDE_CAR_SUFFIXES:
        sidecar = Path(f"{legacy}{suffix}")
        if sidecar.is_symlink() or (sidecar.exists() and not sidecar.is_file()):
            fail("DEVELOPMENT_DATABASE_WAL_MIGRATION_UNSAFE")

    source_state = inspect(legacy)
    if source_state["integrity"] != "ok" or source_state["foreign_key_violations"]:
        fail("DEVELOPMENT_DATABASE_INTEGRITY_FAILURE")
    if not source_state["schema_recognized"]:
        fail("DEVELOPMENT_DATABASE_SCHEMA_MISMATCH")

    temporary = database.with_name(f".{database.name}.migrating")
    if any(
        candidate.exists() or candidate.is_symlink()
        for candidate in (temporary, *(Path(f"{temporary}{suffix}") for suffix in MIGRATION_SIDE_CAR_SUFFIXES))
    ):
        fail("DEVELOPMENT_DATABASE_MIGRATION_TEMPORARY_EXISTS")

    source_connection: sqlite3.Connection | None = None
    source_stat = legacy.stat()
    source_signature = (source_stat.st_dev, source_stat.st_ino, source_stat.st_size, source_stat.st_mtime_ns)
    published = False
    source_counts: dict[str, int] = {}
    try:
        try:
            source_connection = sqlite3.connect(legacy, timeout=0)
            source_connection.execute("PRAGMA busy_timeout=0")
            source_connection.execute("BEGIN IMMEDIATE")
        except sqlite3.Error:
            fail("DEVELOPMENT_DATABASE_BUSY")

        source_counts = table_counts(source_connection)
        locked_state = inspect(legacy)
        if locked_state["integrity"] != "ok" or locked_state["foreign_key_violations"]:
            fail("DEVELOPMENT_DATABASE_INTEGRITY_FAILURE")
        if locked_state["schema_head"] != source_state["schema_head"]:
            fail("DEVELOPMENT_DATABASE_CHANGED_DURING_MIGRATION")

        source_connection.rollback()
        source_connection.close()
        source_connection = None
        with sqlite3.connect(f"file:{legacy.as_posix()}?mode=ro", uri=True, timeout=0) as source_reader, sqlite3.connect(temporary, timeout=0) as destination_connection:
            source_reader.backup(destination_connection, sleep=0)
        os.chmod(temporary, 0o600)

        if locked_state["schema_head"] != SCHEMA_HEAD:
            previous_database_url = os.environ.get("DATABASE_URL")
            os.environ["DATABASE_URL"] = f"sqlite:///{temporary.resolve().as_posix()}"
            os.environ.setdefault("OPERATOROS_ISOLATED_TEST", "true")
            try:
                from core.schema_migrations import migrate_database_to_current
                with contextlib.redirect_stdout(sys.stderr):
                    migrate_database_to_current(temporary)
            except Exception:
                fail("DEVELOPMENT_DATABASE_MIGRATION_FAILED")
            finally:
                if previous_database_url is None:
                    os.environ.pop("DATABASE_URL", None)
                else:
                    os.environ["DATABASE_URL"] = previous_database_url

        destination_state = inspect(temporary)
        if destination_state["schema_head"] != SCHEMA_HEAD or destination_state["ledger"] != "valid" or destination_state["integrity"] != "ok" or destination_state["foreign_key_violations"] or not destination_state["schema_checksum_valid"]:
            fail("DEVELOPMENT_DATABASE_MIGRATION_VALIDATION_FAILED")
        with sqlite3.connect(f"file:{temporary.as_posix()}?mode=ro", uri=True) as destination_connection:
            destination_counts = table_counts(destination_connection)
        if any(
            table != "operatoros_schema_migrations" and destination_counts.get(table) != count
            for table, count in source_counts.items()
        ):
            fail("DEVELOPMENT_DATABASE_MIGRATION_DATA_LOSS")
        publish_guard = sqlite3.connect(legacy, timeout=0)
        try:
            publish_guard.execute("PRAGMA busy_timeout=0")
            publish_guard.execute("BEGIN IMMEDIATE")
            current_stat = legacy.stat()
            if (current_stat.st_dev, current_stat.st_ino, current_stat.st_size, current_stat.st_mtime_ns) != source_signature:
                fail("DEVELOPMENT_DATABASE_CHANGED_DURING_MIGRATION")

            # Link the validated file without ever replacing a concurrent target.
            os.link(temporary, database)
            published = True
            temporary.unlink()
            for suffix, recovery_sidecar in recovery_sidecars.items():
                sidecar = Path(f"{legacy}{suffix}")
                if sidecar.exists():
                    if sidecar.is_symlink() or not sidecar.is_file():
                        fail("DEVELOPMENT_DATABASE_WAL_MIGRATION_UNSAFE")
                    os.link(sidecar, recovery_sidecar)
            os.link(legacy, recovery)
            if recovery.stat().st_size != source_stat.st_size:
                fail("DEVELOPMENT_DATABASE_MIGRATION_RECOVERY_FAILED")
            for suffix in MIGRATION_SIDE_CAR_SUFFIXES:
                Path(f"{legacy}{suffix}").unlink(missing_ok=True)
            legacy.unlink()
        finally:
            publish_guard.rollback()
            publish_guard.close()
    except FileExistsError:
        fail("DEVELOPMENT_DATABASE_MIGRATION_CONFLICT")
    finally:
        if source_connection is not None:
            try:
                source_connection.rollback()
            finally:
                source_connection.close()
        if temporary.exists():
            temporary.unlink()
        remove_sidecars(temporary)

    if not published:
        fail("DEVELOPMENT_DATABASE_MIGRATION_FAILED")
    return True


def initialize(database: Path) -> None:
    if database.exists():
        state = inspect(database)
        if state["schema_head"] != SCHEMA_HEAD or state["ledger"] != "valid" or state["integrity"] != "ok" or not state["schema_checksum_valid"]:
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
    directory, destination = prepare(repo, override)
    if database_layout(directory) != "MISSING":
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
    repo = Path(args.repo)
    override = getattr(args, "data_dir", None)
    if args.command == "path":
        directory, _, _ = data_directory(repo, override)
        print(directory / DATABASE_NAME)
        return 0
    if args.command == "status":
        directory, _, _ = data_directory(repo, override)
        layout = database_layout(directory)
        state = inspect(directory / DATABASE_NAME) if layout == "CANONICAL" else {"exists": False}
        state.update(
            path=str(directory / DATABASE_NAME),
            legacy_path=str(directory / LEGACY_DATABASE_NAME),
            layout=layout,
            migration_required=layout == "LEGACY",
            protected=False,
            persistence_classification="PERSISTENT_LOCAL_DEVELOPMENT_DATABASE",
        )
        print(json.dumps(state, sort_keys=True))
        return 0
    directory, database = prepare(repo, override)
    if args.command == "ensure":
        migrate_legacy_database(directory)
        initialize(database)
        print(database)
    elif args.command == "reset":
        if args.confirm != "RESET": fail("DEVELOPMENT_DATABASE_RESET_CONFIRMATION_REQUIRED")
        if database_layout(directory) == "LEGACY": fail("DEVELOPMENT_DATABASE_MIGRATION_REQUIRED")
        if database_layout(directory) == "CONFLICT": fail("DEVELOPMENT_DATABASE_MIGRATION_CONFLICT")
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


def dotenv_database_url_command(args: argparse.Namespace) -> int:
    print("true" if dotenv_defines_database_url(Path(args.env_file)) else "false")
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
    dotenv = commands.add_parser("dotenv-database-url"); dotenv.add_argument("--env-file", required=True); dotenv.set_defaults(func=dotenv_database_url_command)
    return root


if __name__ == "__main__":
    args = parser().parse_args()
    try:
        raise SystemExit(args.func(args))
    except SystemExit as exc:
        if isinstance(exc.code, str):
            print(exc.code)
            raise SystemExit(2)
        raise
    except Exception:
        print("PERSISTENT_DEVELOPMENT_DATABASE_OPERATION_FAILED")
        raise SystemExit(2)
