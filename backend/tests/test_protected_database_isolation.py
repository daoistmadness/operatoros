"""Regression test suite for protected database path isolation and database routing safety."""

import os
import sys
import tempfile
from pathlib import Path
import pytest
from sqlalchemy.engine import make_url

from core.config import Settings


def test_missing_database_url_raises_error():
    """Ensure config rejects missing DATABASE_URL unless PostgreSQL fields are present."""
    s = Settings(DATABASE_URL=None, AUTH_COOKIE_SECRET="a"*32)
    with pytest.raises(ValueError, match="DATABASE_URL is required"):
        _ = s.database_url


def test_explicit_protected_path_rejected():
    """Ensure explicit path to backend/attendance.db is rejected by config."""
    root = Path(__file__).resolve().parents[2]
    protected_db = root / "backend" / "attendance.db"
    s = Settings(DATABASE_URL=f"sqlite:///{protected_db}", AUTH_COOKIE_SECRET="a"*32)
    with pytest.raises(ValueError, match="PROTECTED_DATABASE_PATH_REJECTED"):
        _ = s.database_url


def test_relative_protected_path_rejected():
    """Ensure relative path to backend/attendance.db is rejected after resolution."""
    s = Settings(DATABASE_URL="sqlite:///backend/attendance.db", AUTH_COOKIE_SECRET="a"*32)
    with pytest.raises(ValueError, match="PROTECTED_DATABASE_PATH_REJECTED"):
        _ = s.database_url


def test_repository_root_attendance_db_rejected():
    """Ensure path to repository-root attendance.db is rejected."""
    s = Settings(DATABASE_URL="sqlite:///attendance.db", AUTH_COOKIE_SECRET="a"*32)
    with pytest.raises(ValueError, match="PROTECTED_DATABASE_PATH_REJECTED"):
        _ = s.database_url


def test_symlink_to_protected_path_rejected(tmp_path):
    """Ensure symlink resolving to backend/attendance.db is rejected."""
    root = Path(__file__).resolve().parents[2]
    protected_db = root / "backend" / "attendance.db"
    if not protected_db.exists():
        pytest.skip("Protected db file does not exist")

    symlink_path = tmp_path / "symlink_test.db"
    try:
        os.symlink(protected_db, symlink_path)
    except OSError:
        pytest.skip("Symlink creation not supported in this environment")

    s = Settings(DATABASE_URL=f"sqlite:///{symlink_path}", AUTH_COOKIE_SECRET="a"*32)
    with pytest.raises(ValueError, match="PROTECTED_DATABASE_PATH_REJECTED"):
        _ = s.database_url


def test_test_suite_uses_isolated_db():
    """Verify that current pytest process uses an isolated temp database path."""
    from core.config import settings
    db_url = settings.database_url
    url_obj = make_url(db_url)
    assert url_obj.drivername.startswith("sqlite")
    assert "attendance.db" not in url_obj.database
