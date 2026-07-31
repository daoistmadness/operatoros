from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("development_database", ROOT / "scripts" / "development_database.py")
assert SPEC and SPEC.loader
tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tool)


def _repository(tmp_path: Path) -> Path:
    repository = tmp_path / "repository"
    (repository / ".runtime" / "operatoros-dev" / "sessions").mkdir(parents=True)
    (repository / "backend").mkdir()
    return repository


def test_default_path_is_stable_for_shared_common_directory(tmp_path, monkeypatch):
    repository = _repository(tmp_path)
    common = tmp_path / "common.git"
    common.mkdir()
    monkeypatch.setattr(tool, "common_directory", lambda _: common)
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "data"))
    first, identifier, _ = tool.data_directory(repository)
    second, again, _ = tool.data_directory(repository)
    assert first == second
    assert identifier == again


@pytest.mark.parametrize("override", ["relative", "../escape"])
def test_relative_override_is_rejected(tmp_path, override, monkeypatch):
    monkeypatch.setattr(tool, "common_directory", lambda _: tmp_path)
    with pytest.raises(SystemExit, match="DEVELOPMENT_DATA_PATH_NOT_ABSOLUTE"):
        tool.data_directory(_repository(tmp_path), override)


def test_session_directory_override_is_rejected(tmp_path, monkeypatch):
    repository = _repository(tmp_path)
    monkeypatch.setattr(tool, "common_directory", lambda _: tmp_path)
    with pytest.raises(SystemExit, match="DEVELOPMENT_DATA_PATH_REJECTED"):
        tool.data_directory(repository, str(repository / ".runtime" / "operatoros-dev" / "sessions" / "bad"))


def test_fresh_database_is_s43_without_administrator(tmp_path, monkeypatch):
    repository = _repository(tmp_path)
    common = tmp_path / "common.git"
    common.mkdir()
    monkeypatch.setattr(tool, "common_directory", lambda _: common)
    directory, database = tool.prepare(repository, str(tmp_path / "persistent"))
    tool.initialize(database)
    state = tool.inspect(database)
    assert directory.exists()
    assert state["schema_head"] == tool.SCHEMA_HEAD
    assert state["ledger"] == "valid"
    assert state["administrator_configured"] is False
