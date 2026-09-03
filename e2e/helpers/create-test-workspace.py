#!/usr/bin/env python3
"""Validate E2E database paths without inspecting any database file."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
E2E_RUNTIME_ROOT = Path(os.path.abspath(REPOSITORY_ROOT / ".runtime" / "operatoros-e2e"))


def _absolute_path(path: Path) -> Path:
    """Normalize a path lexically without following symlinks or touching it."""

    return Path(os.path.abspath(os.fspath(path)))


def validate_database_path(
    database_path: Path,
    *,
    runtime_root: Path = E2E_RUNTIME_ROOT,
    repository_root: Path = REPOSITORY_ROOT,
) -> Path:
    """Reject non-disposable paths before any caller can open a database."""

    if not database_path.is_absolute():
        raise ValueError("E2E database must be an absolute path")

    selected = _absolute_path(database_path)
    runtime = _absolute_path(runtime_root)
    protected = _absolute_path(repository_root / "backend" / "attendance.db")
    if not selected.is_relative_to(runtime):
        raise ValueError("E2E database must be inside the disposable E2E runtime root")
    if selected == protected:
        raise ValueError("E2E database must not equal the protected operational database")
    return selected


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--runtime-root", type=Path, required=True)
    parser.add_argument("--repository-root", type=Path, default=REPOSITORY_ROOT)
    args = parser.parse_args()
    try:
        selected = validate_database_path(
            args.database,
            runtime_root=args.runtime_root,
            repository_root=args.repository_root,
        )
    except ValueError as error:
        parser.error(str(error))
    print(selected)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
