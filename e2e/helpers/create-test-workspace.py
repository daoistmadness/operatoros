#!/usr/bin/env python3
"""Phase 1 contract for creating a safely isolated E2E workspace."""

from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
E2E_RUNTIME_ROOT = (REPOSITORY_ROOT / ".runtime" / "operatoros-e2e").resolve()
PRODUCTION_DATABASE = (REPOSITORY_ROOT / "backend" / "attendance.db").resolve()


def validate_database_path(database_path: Path) -> Path:
    selected = database_path.resolve()
    if not selected.is_absolute() or not selected.is_relative_to(E2E_RUNTIME_ROOT):
        raise ValueError("E2E database must be absolute and inside the E2E runtime root")
    if selected == PRODUCTION_DATABASE:
        raise ValueError("E2E database must not equal the production database")
    return selected
