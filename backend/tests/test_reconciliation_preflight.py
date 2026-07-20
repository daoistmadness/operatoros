from __future__ import annotations

import os
import tempfile
from pathlib import Path
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.database import Base
from services.preflight_service import run_production_preflight
from services.reconciliation_service import compute_file_sha256, run_read_only_reconciliation, validate_canonical_database_path


def create_disposable_db_file(tmp_path: Path) -> Path:
    db_file = tmp_path / "test_disposable.db"
    engine = create_engine(f"sqlite:///{db_file}")
    Base.metadata.create_all(bind=engine)
    engine.dispose()
    return db_file


def test_read_only_reconciliation(tmp_path):
    db_file = create_disposable_db_file(tmp_path)
    initial_stat = db_file.stat()
    initial_hash = compute_file_sha256(db_file)

    res = run_read_only_reconciliation(db_file)

    final_stat = db_file.stat()
    final_hash = compute_file_sha256(db_file)

    assert res["mutation_performed"] is False
    assert res["terminal_message"] == "No mutation performed."
    assert initial_stat.st_size == final_stat.st_size
    assert initial_hash == final_hash


def test_preflight_verification(tmp_path):
    db_file = create_disposable_db_file(tmp_path)
    res = run_production_preflight(db_file)

    assert res["status"] == "PASSED"
    assert res["total_steps"] == 21
    assert res["passed_steps"] == 21
    assert res["failed_steps"] == 0


def test_symlink_rejection(tmp_path):
    db_file = create_disposable_db_file(tmp_path)
    symlink_file = tmp_path / "symlink.db"
    try:
        symlink_file.symlink_to(db_file)
    except OSError:
        pytest.skip("Symlinks not supported on host OS filesystem")

    with pytest.raises(ValueError) as exc:
        validate_canonical_database_path(symlink_file)
    assert "symlink" in str(exc.value).lower()
