from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess

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


@pytest.mark.parametrize(
    "contents, expected",
    [
        ("", False),
        ("# DATABASE_URL=sqlite:///secret.db\n\n", False),
        ("DATABASE_URL=sqlite:///secret.db\n", True),
        ("export DATABASE_URL = sqlite:///secret.db\n", True),
    ],
)
def test_dotenv_database_url_detection_does_not_expose_value(tmp_path, contents, expected):
    env_file = tmp_path / ".env"
    env_file.write_text(contents, encoding="utf-8")
    assert tool.dotenv_defines_database_url(env_file) is expected


def test_missing_dotenv_is_not_a_database_url_assignment(tmp_path):
    assert tool.dotenv_defines_database_url(tmp_path / "missing.env") is False


def test_protected_database_data_root_is_rejected(tmp_path, monkeypatch):
    repository = _repository(tmp_path)
    monkeypatch.setattr(tool, "common_directory", lambda _: tmp_path)
    with pytest.raises(SystemExit, match="DEVELOPMENT_DATA_PATH_REJECTED"):
        tool.data_directory(repository, str(repository / "backend" / "attendance.db"))


def test_make_path_and_status_report_the_same_canonical_database(tmp_path):
    if not (ROOT / "backend/.venv/bin/python").exists():
        pytest.skip("project virtual environment is unavailable")
    environment = os.environ.copy()
    environment.pop("DATABASE_URL", None)
    environment["OPERATOROS_DEV_DATA_DIR"] = str(tmp_path / "make-data")
    root = ROOT
    path = subprocess.check_output(["make", "dev-db-path"], cwd=root, env=environment, text=True).strip()
    status = json.loads(subprocess.check_output(["make", "dev-db-status"], cwd=root, env=environment, text=True))

    assert Path(path) == Path(status["path"])
    assert Path(path).name == tool.DATABASE_NAME
