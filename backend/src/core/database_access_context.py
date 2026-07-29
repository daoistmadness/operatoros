"""Process-local authority for the guarded operational migration only.

This module deliberately has no configuration, ORM, migration, or engine imports.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Iterator


class DatabaseAccessMode(StrEnum):
    NORMAL_RUNTIME = "NORMAL_RUNTIME"
    TEMPORARY_TEST_DATABASE = "TEMPORARY_TEST_DATABASE"
    OPERATIONAL_MIGRATION = "OPERATIONAL_MIGRATION"


@dataclass(frozen=True)
class DatabaseAccessContext:
    mode: DatabaseAccessMode = DatabaseAccessMode.NORMAL_RUNTIME
    database_path: Path | None = None
    expected_source_sha256: str | None = None
    expected_source_head: str | None = None
    backup_path: Path | None = None
    lock_path: Path | None = None
    lock_held: bool = False
    preflight_verified: bool = False


_ACTIVE_CONTEXT: ContextVar[DatabaseAccessContext] = ContextVar(
    "operatoros_database_access_context", default=DatabaseAccessContext()
)


def active_database_access_context() -> DatabaseAccessContext:
    return _ACTIVE_CONTEXT.get()


def protected_path_is_permitted(path: Path) -> bool:
    context = active_database_access_context()
    return (
        context.mode is DatabaseAccessMode.OPERATIONAL_MIGRATION
        and context.database_path == path.resolve()
        and context.expected_source_sha256 is not None
        and context.expected_source_head == "20260724_s42"
        and context.backup_path is not None
        and context.lock_path is not None
        and context.lock_held
        and context.preflight_verified
    )


@contextmanager
def operational_migration_access_context(
    *,
    database_path: Path,
    expected_source_sha256: str,
    expected_source_head: str,
    backup_path: Path,
    lock_path: Path,
    lock_held: bool,
    preflight_verified: bool,
) -> Iterator[DatabaseAccessContext]:
    if active_database_access_context().mode is not DatabaseAccessMode.NORMAL_RUNTIME:
        raise RuntimeError("OPERATIONAL_MIGRATION_CONTEXT_NESTED_OR_CONFLICTING")
    if not lock_held or not preflight_verified:
        raise RuntimeError("OPERATIONAL_MIGRATION_CONTEXT_INCOMPLETE")
    context = DatabaseAccessContext(
        mode=DatabaseAccessMode.OPERATIONAL_MIGRATION,
        database_path=database_path.resolve(strict=True),
        expected_source_sha256=expected_source_sha256,
        expected_source_head=expected_source_head,
        backup_path=backup_path.resolve(strict=True),
        lock_path=lock_path.resolve(),
        lock_held=True,
        preflight_verified=True,
    )
    token = _ACTIVE_CONTEXT.set(context)
    try:
        yield context
    finally:
        _ACTIVE_CONTEXT.reset(token)
