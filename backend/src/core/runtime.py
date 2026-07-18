"""OperatorOS desktop runtime path resolution.

This module has no dependency on application settings or SQLAlchemy so the
sidecar can establish absolute writable paths before importing the FastAPI app.
"""

from __future__ import annotations

import os
import secrets
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, MutableMapping


DEFAULT_VERSION = "0.9.0"
SECRET_FILENAME = "auth-cookie-secret"


class RuntimeConfigurationError(RuntimeError):
    """Raised when desktop runtime paths are absent or unsafe."""


@dataclass(frozen=True)
class DesktopRuntime:
    root_dir: Path
    data_dir: Path
    backup_dir: Path
    log_dir: Path
    runtime_dir: Path
    export_dir: Path
    database_path: Path
    secret_path: Path
    version: str

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.database_path.as_posix()}"


class RuntimeLock:
    """Hold an OS-level lock for the complete sidecar/data-root lifetime."""

    def __init__(self, runtime: DesktopRuntime):
        self.path = runtime.runtime_dir / "sidecar.lock"
        self._handle = None

    def acquire(self) -> None:
        handle = self.path.open("a+b")
        handle.seek(0)
        try:
            if sys.platform == "win32":
                import msvcrt

                if self.path.stat().st_size == 0:
                    handle.write(b"\0")
                    handle.flush()
                    handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            handle.close()
            raise RuntimeConfigurationError(
                "Another OperatorOS sidecar already owns this application data root"
            ) from exc
        handle.seek(1)
        handle.truncate()
        handle.write(f"pid={os.getpid()}\n".encode("ascii"))
        handle.flush()
        self._handle = handle

    def release(self) -> None:
        if self._handle is None:
            return
        try:
            self._handle.seek(0)
            if sys.platform == "win32":
                import msvcrt

                msvcrt.locking(self._handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(self._handle.fileno(), fcntl.LOCK_UN)
        finally:
            self._handle.close()
            self._handle = None


def _absolute_directory(raw_value: str, variable: str) -> Path:
    value = Path(os.path.expandvars(raw_value)).expanduser()
    if not value.is_absolute():
        raise RuntimeConfigurationError(f"{variable} must be an absolute path")
    resolved = value.resolve(strict=False)
    if resolved.exists() and not resolved.is_dir():
        raise RuntimeConfigurationError(f"{variable} must resolve to a directory")
    return resolved


def _expected_child(root: Path, supplied: str | None, name: str, variable: str) -> Path:
    expected = (root / name).resolve(strict=False)
    if not supplied:
        return expected
    resolved = _absolute_directory(supplied, variable)
    if resolved != expected:
        raise RuntimeConfigurationError(
            f"{variable} must resolve to the OperatorOS {name} directory"
        )
    return resolved


def resolve_desktop_runtime(
    environ: Mapping[str, str] | None = None,
) -> DesktopRuntime:
    """Resolve the frozen OperatorOS desktop directory contract.

    Explicit OPERATOROS_* paths take priority. When the data directory is not
    supplied, the Windows LOCALAPPDATA location is used.
    """

    values = os.environ if environ is None else environ
    configured_data = values.get("OPERATOROS_DATA_DIR", "").strip()
    if configured_data:
        data_dir = _absolute_directory(configured_data, "OPERATOROS_DATA_DIR")
        if data_dir.name.casefold() != "data":
            raise RuntimeConfigurationError("OPERATOROS_DATA_DIR must end with Data")
        root = data_dir.parent
    else:
        local_app_data = values.get("LOCALAPPDATA", "").strip()
        if not local_app_data:
            raise RuntimeConfigurationError(
                "OPERATOROS_DATA_DIR or LOCALAPPDATA is required for the desktop sidecar"
            )
        root = (_absolute_directory(local_app_data, "LOCALAPPDATA") / "OperatorOS").resolve(
            strict=False
        )
        data_dir = root / "Data"

    if root.name.casefold() != "operatoros":
        raise RuntimeConfigurationError(
            "OPERATOROS_DATA_DIR must be inside a directory named OperatorOS"
        )

    log_dir = _expected_child(
        root, values.get("OPERATOROS_LOG_DIR"), "Logs", "OPERATOROS_LOG_DIR"
    )
    runtime_dir = _expected_child(
        root,
        values.get("OPERATOROS_RUNTIME_DIR"),
        "Runtime",
        "OPERATOROS_RUNTIME_DIR",
    )
    version = values.get("OPERATOROS_VERSION", DEFAULT_VERSION).strip() or DEFAULT_VERSION
    if any(character in version for character in "\r\n\0"):
        raise RuntimeConfigurationError("OPERATOROS_VERSION contains invalid characters")

    return DesktopRuntime(
        root_dir=root,
        data_dir=data_dir,
        backup_dir=root / "Backups",
        log_dir=log_dir,
        runtime_dir=runtime_dir,
        export_dir=root / "Exports",
        database_path=data_dir / "operatoros.db",
        secret_path=runtime_dir / SECRET_FILENAME,
        version=version,
    )


def prepare_desktop_runtime(runtime: DesktopRuntime) -> None:
    """Create the frozen writable directory tree with user-only intent."""

    for directory in (
        runtime.root_dir,
        runtime.data_dir,
        runtime.backup_dir,
        runtime.log_dir,
        runtime.runtime_dir,
        runtime.export_dir,
    ):
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if not directory.is_dir():
            raise RuntimeConfigurationError(f"Runtime path is not a directory: {directory}")
        try:
            directory.chmod(0o700)
        except OSError as exc:
            raise RuntimeConfigurationError(
                f"Could not protect runtime directory: {directory}"
            ) from exc


def load_or_create_cookie_secret(runtime: DesktopRuntime) -> str:
    """Load or atomically create the persistent sidecar cookie secret."""

    if runtime.secret_path.exists():
        secret = runtime.secret_path.read_text(encoding="utf-8").strip()
        if len(secret) < 32:
            raise RuntimeConfigurationError("Persisted authentication secret is invalid")
        return secret

    secret = secrets.token_urlsafe(48)
    try:
        descriptor = os.open(runtime.secret_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return load_or_create_cookie_secret(runtime)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(secret)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        runtime.secret_path.chmod(0o600)
    except OSError as exc:
        runtime.secret_path.unlink(missing_ok=True)
        raise RuntimeConfigurationError("Could not protect authentication secret") from exc
    return secret


def apply_runtime_environment(
    runtime: DesktopRuntime,
    environ: MutableMapping[str, str] | None = None,
) -> None:
    """Set authoritative sidecar settings before importing application modules."""

    target = os.environ if environ is None else environ
    target["DATABASE_URL"] = runtime.database_url
    target["BACKUP_DIR"] = str(runtime.backup_dir)
    target["AUTH_COOKIE_SECRET"] = load_or_create_cookie_secret(runtime)
    target["OPERATOROS_DATA_DIR"] = str(runtime.data_dir)
    target["OPERATOROS_LOG_DIR"] = str(runtime.log_dir)
    target["OPERATOROS_RUNTIME_DIR"] = str(runtime.runtime_dir)
    target["OPERATOROS_EXPORT_DIR"] = str(runtime.export_dir)
    target["OPERATOROS_VERSION"] = runtime.version
    target["HOST"] = "127.0.0.1"
    target["BACKEND_WORKERS"] = "1"
    target["RESTORE_SINGLE_WORKER_REQUIRED"] = "true"
    target["OPERATOROS_PRODUCTION"] = "true"
    target["ALLOW_LEGACY_STARTUP_SCHEMA_MUTATION"] = "false"
    target.setdefault("COOKIE_SECURE", "false")
