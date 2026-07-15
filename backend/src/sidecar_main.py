"""Production entry point for the packaged OperatorOS FastAPI sidecar."""

from __future__ import annotations

import argparse
import logging
import logging.handlers
import os
import sqlite3
import sys
from pathlib import Path

from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse

from core.runtime import (
    DesktopRuntime,
    RuntimeLock,
    RuntimeConfigurationError,
    apply_runtime_environment,
    prepare_desktop_runtime,
    resolve_desktop_runtime,
)


LOGGER = logging.getLogger("operatoros.sidecar")
IDENTITY_MIGRATION = "20260713_identity_schema_sqlite.sql"
SETUP_MIGRATION = "20260714_first_admin_setup_sqlite.sql"


def resource_root() -> Path:
    bundled = getattr(sys, "_MEIPASS", None)
    if bundled:
        return Path(bundled)
    return Path(__file__).resolve().parents[2]


def migration_root() -> Path:
    root = resource_root()
    return root / "migrations" if getattr(sys, "_MEIPASS", None) else root / "backend" / "migrations"


def frontend_root() -> Path:
    root = resource_root()
    return root / "frontend" if getattr(sys, "_MEIPASS", None) else root / "frontend" / "build"


def configure_logging(runtime: DesktopRuntime, log_level: str) -> None:
    level = getattr(logging, log_level.upper(), logging.INFO)
    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s",
        "%Y-%m-%dT%H:%M:%S%z",
    )
    file_handler = logging.handlers.RotatingFileHandler(
        runtime.log_dir / "operatoros-sidecar.log",
        maxBytes=5 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    stream_handler = logging.StreamHandler(sys.stderr)
    stream_handler.setFormatter(formatter)
    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.setLevel(level)
    root_logger.addHandler(file_handler)
    root_logger.addHandler(stream_handler)


def apply_bootstrap_migrations(runtime: DesktopRuntime) -> None:
    """Apply the migration-owned identity/setup bootstrap before app import."""

    migrations = migration_root()
    identity = migrations / IDENTITY_MIGRATION
    setup = migrations / SETUP_MIGRATION
    if not identity.is_file() or not setup.is_file():
        raise RuntimeConfigurationError("Required desktop migration resources are missing")

    with sqlite3.connect(runtime.database_path) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        if "users" not in tables or "sessions" not in tables:
            if "users" in tables or "sessions" in tables:
                raise RuntimeConfigurationError(
                    "Partial identity schema detected; refusing automatic repair"
                )
            connection.executescript(identity.read_text(encoding="utf-8"))
        connection.executescript(setup.read_text(encoding="utf-8"))
        if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise RuntimeConfigurationError("SQLite integrity check failed after migrations")


class SpaStaticFiles(StaticFiles):
    """Serve built React assets and fall back to index.html for client routes."""

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 404 and scope["method"] in {"GET", "HEAD"}:
            return FileResponse(Path(self.directory) / "index.html")
        return response


def mount_frontend(app) -> None:
    frontend = frontend_root()
    if not (frontend / "index.html").is_file():
        raise RuntimeConfigurationError("Packaged frontend assets are missing")
    app.router.routes = [
        route for route in app.router.routes if getattr(route, "path", None) != "/"
    ]
    app.mount("/", SpaStaticFiles(directory=frontend, html=True), name="desktop-frontend")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="OperatorOS FastAPI sidecar")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--log-level", default="info")
    return parser.parse_args(argv)


def run(argv: list[str] | None = None) -> int:
    runtime: DesktopRuntime | None = None
    engine = None
    runtime_lock: RuntimeLock | None = None
    try:
        args = parse_args(argv)
        if args.host != "127.0.0.1":
            raise RuntimeConfigurationError("The production sidecar binds only to 127.0.0.1")
        if not 1 <= args.port <= 65535:
            raise RuntimeConfigurationError("Sidecar port must be between 1 and 65535")

        runtime = resolve_desktop_runtime()
        prepare_desktop_runtime(runtime)
        runtime_lock = RuntimeLock(runtime)
        runtime_lock.acquire()
        configure_logging(runtime, args.log_level)
        apply_runtime_environment(runtime)
        LOGGER.info("sidecar startup version=%s", runtime.version)
        LOGGER.info(
            "runtime directories data=%s backups=%s logs=%s runtime=%s exports=%s",
            runtime.data_dir,
            runtime.backup_dir,
            runtime.log_dir,
            runtime.runtime_dir,
            runtime.export_dir,
        )
        apply_bootstrap_migrations(runtime)
        LOGGER.info("migration status=ok")

        import uvicorn
        from core.database import engine as application_engine
        from main import app

        engine = application_engine
        mount_frontend(app)
        uvicorn.run(
            app,
            host="127.0.0.1",
            port=args.port,
            workers=1,
            log_level=args.log_level,
            access_log=False,
            log_config=None,
        )
        return 0
    except (RuntimeConfigurationError, OSError, sqlite3.Error, ValueError) as exc:
        if logging.getLogger().handlers:
            LOGGER.exception("fatal sidecar startup error: %s", exc)
        else:
            print(f"fatal sidecar startup error: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:
        if logging.getLogger().handlers:
            LOGGER.exception("fatal sidecar error: %s", exc)
        else:
            print(f"fatal sidecar error: {exc}", file=sys.stderr)
        return 1
    finally:
        if engine is not None:
            engine.dispose()
        if runtime_lock is not None:
            runtime_lock.release()
        if runtime is not None and logging.getLogger().handlers:
            LOGGER.info("sidecar shutdown complete")
        logging.shutdown()


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
