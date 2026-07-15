"""Experimental Windows sidecar entrypoint. Not a production deployment entrypoint."""

from __future__ import annotations

import argparse
import os
import secrets
import sqlite3
import sys
from contextlib import AbstractContextManager
from pathlib import Path
from typing import BinaryIO


APP_NAME = "Astryx"
IDENTITY_MIGRATION = "20260713_identity_schema_sqlite.sql"
SETUP_MIGRATION = "20260714_first_admin_setup_sqlite.sql"


class RuntimeLock(AbstractContextManager["RuntimeLock"]):
    """Hold the canonical data-root lock for the complete sidecar lifetime."""

    def __init__(self, root: Path):
        self.path = root / "runtime" / "sidecar.lock"
        self.handle: BinaryIO | None = None

    def __enter__(self) -> "RuntimeLock":
        if sys.platform != "win32":
            raise RuntimeError("The packaged desktop sidecar is supported on Windows only")
        import msvcrt

        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.path.open("r+b") if self.path.exists() else self.path.open("w+b")
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"\0")
            handle.flush()
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as error:
            handle.close()
            raise RuntimeError(
                "Another Astryx sidecar already owns this application data root"
            ) from error
        handle.seek(1)
        handle.truncate()
        handle.write(f"pid={os.getpid()}\n".encode("ascii"))
        handle.flush()
        self.handle = handle
        return self

    def __exit__(self, _type, _value, _traceback) -> None:
        if self.handle is None:
            return
        import msvcrt

        try:
            self.handle.seek(0)
            msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
        finally:
            self.handle.close()
            self.handle = None


def resource_root() -> Path:
    bundled = getattr(sys, "_MEIPASS", None)
    return Path(bundled) if bundled else Path(__file__).resolve().parent


def data_root() -> Path:
    override = os.environ.get("ASTRYX_DATA_ROOT")
    if override:
        return Path(override).expanduser().resolve()
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        raise RuntimeError("LOCALAPPDATA is required when ASTRYX_DATA_ROOT is unset")
    return (Path(local_app_data) / APP_NAME).resolve()


def ensure_secret(root: Path) -> str:
    secret_path = root / "config" / "auth-cookie-secret"
    secret_path.parent.mkdir(parents=True, exist_ok=True)
    if secret_path.exists():
        secret = secret_path.read_text(encoding="utf-8").strip()
        if len(secret) < 32:
            raise RuntimeError("Persisted authentication secret is invalid")
        return secret
    secret = secrets.token_urlsafe(48)
    secret_path.write_text(secret, encoding="utf-8")
    return secret


def apply_bootstrap_migrations(database: Path) -> None:
    migrations = resource_root() / "migrations"
    database.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        if "users" not in tables or "sessions" not in tables:
            if "users" in tables or "sessions" in tables:
                raise RuntimeError("Partial identity schema detected; refusing automatic repair")
            connection.executescript((migrations / IDENTITY_MIGRATION).read_text(encoding="utf-8"))
        connection.executescript((migrations / SETUP_MIGRATION).read_text(encoding="utf-8"))
        if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise RuntimeError("SQLite integrity check failed after migrations")


def configure_environment(root: Path) -> Path:
    database = root / "data" / "astryx.sqlite3"
    backup_dir = root / "backups"
    log_dir = root / "logs"
    runtime_dir = root / "runtime"
    for directory in (database.parent, backup_dir, log_dir, runtime_dir):
        directory.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("DATABASE_URL", f"sqlite:///{database.as_posix()}")
    os.environ.setdefault("BACKUP_DIR", str(backup_dir))
    os.environ.setdefault("AUTH_COOKIE_SECRET", ensure_secret(root))
    os.environ.setdefault("COOKIE_SECURE", "false")
    os.environ.setdefault("BACKEND_WORKERS", "1")
    os.environ.setdefault("RESTORE_SINGLE_WORKER_REQUIRED", "true")
    apply_bootstrap_migrations(database)
    return database


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Experimental Astryx FastAPI sidecar")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18080)
    parser.add_argument("--log-level", default="info")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.host not in {"127.0.0.1", "localhost"}:
        raise SystemExit("The desktop spike permits loopback binding only")
    root = data_root()
    with RuntimeLock(root):
        configure_environment(root)

        import uvicorn
        from main import app

        uvicorn.run(app, host="127.0.0.1", port=args.port, workers=1, log_level=args.log_level)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
