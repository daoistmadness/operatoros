"""Canonical resolution for the managed local development database.

This module is intentionally pure with respect to database contents. The
management script owns lifecycle operations; application configuration and the
launcher use this module only to agree on the database path.
"""
from __future__ import annotations

import hashlib
import os
import subprocess
from pathlib import Path
from typing import Callable


DATABASE_NAME = "operatoros-development.db"


class DevelopmentDatabaseResolutionError(ValueError):
    """A managed-development path failed an isolation or normalization guard."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _fail(code: str) -> None:
    raise DevelopmentDatabaseResolutionError(code)


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
            _fail("DEVELOPMENT_DATA_SYMLINK_REJECTED")


def common_directory(repo: Path) -> Path:
    result = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--git-common-dir"],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        _fail("DEVELOPMENT_REPOSITORY_ID_UNAVAILABLE")
    raw = Path(result.stdout.strip())
    return (repo / raw).resolve() if not raw.is_absolute() else raw.resolve()


def resolve_data_directory(
    repo: Path,
    override: str | None = None,
    *,
    common_directory_resolver: Callable[[Path], Path] = common_directory,
) -> tuple[Path, str, Path]:
    """Return the normalized persistent data directory and repository identity."""
    repo = repo.resolve(strict=True)
    common = common_directory_resolver(repo)
    repository_id = hashlib.sha256(str(common).encode("utf-8")).hexdigest()[:16]

    source = override if override is not None else os.environ.get("OPERATOROS_DEV_DATA_DIR")
    if source:
        supplied = Path(source)
        if not supplied.is_absolute():
            _fail("DEVELOPMENT_DATA_PATH_NOT_ABSOLUTE")
        root = supplied
    else:
        root_value = os.environ.get("XDG_DATA_HOME")
        root = Path(root_value) if root_value else Path.home() / ".local" / "share"
        if not root.is_absolute():
            _fail("DEVELOPMENT_DATA_PATH_NOT_ABSOLUTE")
    no_symlink_components(root)

    target = (
        (root / "operatoros" / "development" / repository_id).resolve(strict=False)
        if not source
        else root.resolve(strict=False)
    )
    no_symlink_components(target)

    runtime_sessions = (repo / ".runtime" / "operatoros-dev" / "sessions").resolve(strict=False)
    protected_backend = (repo / "backend").resolve(strict=False)
    protected_database = protected_backend / "attendance.db"
    if contained(target, runtime_sessions) or contained(target, protected_backend):
        _fail("DEVELOPMENT_DATA_PATH_REJECTED")
    if target == protected_database or target.name == "attendance.db":
        _fail("DEVELOPMENT_DATA_PATH_REJECTED")

    return target, repository_id, common


def resolve_database_path(
    repo: Path,
    override: str | None = None,
    *,
    common_directory_resolver: Callable[[Path], Path] = common_directory,
) -> Path:
    directory, _, _ = resolve_data_directory(
        repo,
        override,
        common_directory_resolver=common_directory_resolver,
    )
    return directory / DATABASE_NAME


def sqlite_url(path: Path) -> str:
    return f"sqlite:///{path}"
