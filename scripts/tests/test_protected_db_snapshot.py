import importlib.util
import os
import sqlite3
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts/protected_db_snapshot.py"
SPEC = importlib.util.spec_from_file_location("protected_db_snapshot", MODULE_PATH)
assert SPEC and SPEC.loader
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)


def make_snapshot_database(root: Path) -> Path:
    path = root / "backend" / "attendance.db"
    path.parent.mkdir(parents=True)
    connection = sqlite3.connect(path)
    try:
        connection.execute("CREATE TABLE operatoros_schema_migrations (version TEXT, applied_at TEXT)")
        connection.execute(
            "INSERT INTO operatoros_schema_migrations VALUES (?, ?)",
            (guard.S43_HEAD, "2026-07-25T00:00:00Z"),
        )
        for table in guard.EXPECTED_TABLES:
            connection.execute(f"CREATE TABLE {table} (id INTEGER)")
        connection.commit()
    finally:
        connection.close()
    return path


def test_absent_worktree_mode_never_creates_protected_database(tmp_path):
    repository = tmp_path / "linked-worktree"
    (repository / "backend").mkdir(parents=True)

    mode, path = guard.select_protected_database(repository)

    assert mode == "absent"
    assert path == repository / "backend" / "attendance.db"
    guard.assert_absent(path)
    assert not path.exists()
    assert not any(sidecar.exists() for sidecar in guard.sidecars_for(path))


def test_explicit_separate_worktree_snapshot_is_accepted_immutably(tmp_path, monkeypatch):
    repository = tmp_path / "linked-worktree"
    repository.mkdir()
    primary = tmp_path / "primary-checkout"
    protected = make_snapshot_database(primary)
    monkeypatch.setattr(guard, "git_worktree_roots", lambda _: {primary.resolve()})

    mode, selected = guard.select_protected_database(repository, str(protected))
    before = guard.snapshot(selected)
    after = guard.snapshot(selected)

    assert mode == "snapshot"
    assert selected == protected.resolve()
    assert before == after
    assert before["sidecars"] == []


@pytest.mark.parametrize("value", ["backend/attendance.db", "../attendance.db"])
def test_relative_explicit_paths_are_rejected(tmp_path, value):
    repository = tmp_path / "linked-worktree"
    repository.mkdir()
    with pytest.raises(SystemExit, match="PROTECTED_DATABASE_PATH_NOT_ABSOLUTE"):
        guard.select_protected_database(repository, value)


def test_symlink_alias_is_rejected(tmp_path, monkeypatch):
    repository = tmp_path / "linked-worktree"
    repository.mkdir()
    primary = tmp_path / "primary-checkout"
    protected = make_snapshot_database(primary)
    alias = tmp_path / "alias.db"
    alias.symlink_to(protected)
    monkeypatch.setattr(guard, "git_worktree_roots", lambda _: {primary.resolve()})

    with pytest.raises(SystemExit, match="PROTECTED_DATABASE_SYMLINK_REJECTED"):
        guard.select_protected_database(repository, str(alias))


def test_explicit_path_inside_executing_worktree_is_rejected(tmp_path):
    repository = tmp_path / "linked-worktree"
    protected = make_snapshot_database(repository)

    with pytest.raises(SystemExit, match="PROTECTED_DATABASE_PATH_INSIDE_WORKTREE"):
        guard.select_protected_database(repository, str(protected))


def test_sidecars_are_rejected_and_runtime_database_is_not_exported(tmp_path, monkeypatch):
    repository = tmp_path / "linked-worktree"
    repository.mkdir()
    primary = tmp_path / "primary-checkout"
    protected = make_snapshot_database(primary)
    monkeypatch.setattr(guard, "git_worktree_roots", lambda _: {primary.resolve()})
    monkeypatch.setenv("DATABASE_URL", "sqlite:////tmp/synthetic.db")
    (Path(f"{protected}-wal")).touch()

    mode, selected = guard.select_protected_database(repository, str(protected))
    assert mode == "snapshot"
    assert os.environ["DATABASE_URL"] == "sqlite:////tmp/synthetic.db"
    with pytest.raises(SystemExit, match="PROTECTED_DATABASE_SIDECAR_PRESENT"):
        guard.snapshot(selected)
