from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("development_database", ROOT / "scripts" / "development_database.py")
assert SPEC and SPEC.loader
tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tool)
CURRENT_SCHEMA = tool.schema_head_order()[-1]


def _prepare(repository: Path, override: str) -> tuple[Path, Path]:
    return tool.prepare(repository, override, expected_schema=CURRENT_SCHEMA)


def _initialize(database: Path) -> None:
    tool.initialize(database, CURRENT_SCHEMA)


def _migrate(directory: Path) -> bool:
    return tool.migrate_legacy_database(directory, CURRENT_SCHEMA)


def _repository(tmp_path: Path) -> Path:
    repository = tmp_path / "repository"
    (repository / ".runtime" / "operatoros-dev" / "sessions").mkdir(parents=True)
    (repository / "backend").mkdir()
    return repository


def _s43_database(path: Path) -> None:
    with sqlite3.connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE operatoros_schema_migrations (
              version TEXT PRIMARY KEY, predecessor TEXT, schema_fingerprint TEXT NOT NULL,
              protected_fingerprints TEXT NOT NULL, approved_by TEXT NOT NULL, applied_at TEXT NOT NULL
            );
            CREATE TABLE academic_years (id INTEGER PRIMARY KEY, start_date TEXT, end_date TEXT);
            CREATE TABLE jenjangs (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE student_masters (id TEXT PRIMARY KEY, full_name TEXT);
            CREATE TABLE student_device_identities (id INTEGER PRIMARY KEY, student_master_id TEXT, legacy_student_id INTEGER);
            CREATE TABLE attendance (id INTEGER PRIMARY KEY, student_id INTEGER, date TEXT);
            CREATE TABLE student_enrollments (id INTEGER PRIMARY KEY, student_id INTEGER, student_master_id TEXT, academic_year_id INTEGER);
            CREATE TABLE subjects (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE assessment_components (id INTEGER PRIMARY KEY, name TEXT, assessment_type TEXT);
            CREATE TABLE student_subject_grades (
              id INTEGER PRIMARY KEY, enrollment_id INTEGER NOT NULL, subject_id INTEGER NOT NULL,
              component_id INTEGER NOT NULL, score REAL, created_at TEXT, updated_at TEXT,
              UNIQUE (enrollment_id, subject_id, component_id)
            );
            INSERT INTO academic_years VALUES (1, '2026-07-01', '2027-06-30');
            INSERT INTO jenjangs VALUES (1, 'SD');
            INSERT INTO students VALUES (1, 'synthetic student');
            INSERT INTO student_masters VALUES ('master-1', 'synthetic student');
            INSERT INTO student_device_identities VALUES (1, 'master-1', 1);
            INSERT INTO attendance VALUES (1, 1, '2026-08-15');
            INSERT INTO student_enrollments VALUES (1, 1, 'master-1', 1);
            INSERT INTO subjects VALUES (1, 'Mathematics');
            INSERT INTO assessment_components VALUES (1, 'Exam', 'sumatif');
            INSERT INTO student_subject_grades VALUES (1, 1, 1, 1, 76.5, '2026-08-20T10:00:00', '2026-08-20T10:00:00');
            INSERT INTO operatoros_schema_migrations VALUES ('20260725_s43', '20260724_s42', 'synthetic', '{}', 'TEST', '2026-08-21T10:00:00+00:00');
            """
        )


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


def test_canonical_data_dir_precedes_legacy_environment(tmp_path, monkeypatch):
    repository = _repository(tmp_path)
    monkeypatch.setattr(tool, "common_directory", lambda _: tmp_path)
    monkeypatch.setenv("OPERATOROS_DATA_DIR", str(tmp_path / "canonical"))
    monkeypatch.setenv("OPERATOROS_DEV_DATA_DIR", str(tmp_path / "legacy"))
    directory, _, _ = tool.data_directory(repository)
    assert directory == tmp_path / "canonical"


def test_legacy_current_database_is_migrated_once_and_recovered(tmp_path, monkeypatch):
    repository = _repository(tmp_path)
    monkeypatch.setattr(tool, "common_directory", lambda _: tmp_path)
    directory = tmp_path / "persistent"
    directory.mkdir()
    legacy = directory / tool.LEGACY_DATABASE_NAME
    _initialize(legacy)
    with sqlite3.connect(legacy) as connection:
        before = tool.table_counts(connection)
    legacy_sidecars = [(suffix, Path(f"{legacy}{suffix}").exists()) for suffix in tool.MIGRATION_SIDE_CAR_SUFFIXES]
    assert _migrate(directory) is True
    destination = directory / tool.DATABASE_NAME
    assert tool.database_layout(directory) == "CANONICAL"
    assert tool.inspect(destination, expected_schema=CURRENT_SCHEMA)["schema_head"] == CURRENT_SCHEMA
    assert not legacy.exists()
    assert (directory / f"{tool.LEGACY_DATABASE_NAME}.migrated").is_file()
    assert all(Path(f"{directory / (tool.LEGACY_DATABASE_NAME + '.migrated')}{suffix}").exists() == existed for suffix, existed in legacy_sidecars)
    temporary = destination.with_name(f".{destination.name}.migrating")
    assert all(not Path(f"{temporary}{suffix}").exists() for suffix in tool.MIGRATION_SIDE_CAR_SUFFIXES)
    with sqlite3.connect(destination) as connection:
        after = tool.table_counts(connection)
    assert {name: count for name, count in after.items() if name != "operatoros_schema_migrations"} == {name: count for name, count in before.items() if name != "operatoros_schema_migrations"}
    assert _migrate(directory) is False


def test_legacy_s43_database_is_migrated_without_data_loss(tmp_path):
    directory = tmp_path / "persistent"
    directory.mkdir()
    legacy = directory / tool.LEGACY_DATABASE_NAME
    _s43_database(legacy)
    assert _migrate(directory) is True
    destination = directory / tool.DATABASE_NAME
    with sqlite3.connect(destination) as connection:
        assert connection.execute("SELECT name FROM students").fetchone() == ("synthetic student",)
        assert connection.execute("SELECT score FROM student_subject_grades").fetchone() == (76.5,)
    assert tool.inspect(destination, expected_schema=CURRENT_SCHEMA)["schema_head"] == CURRENT_SCHEMA
    temporary = destination.with_name(f".{destination.name}.migrating")
    assert all(not Path(f"{temporary}{suffix}").exists() for suffix in tool.MIGRATION_SIDE_CAR_SUFFIXES)


def test_legacy_invalid_database_is_preserved_and_fails_closed(tmp_path):
    directory = tmp_path / "persistent"
    directory.mkdir()
    legacy = directory / tool.LEGACY_DATABASE_NAME
    legacy.write_text("not sqlite", encoding="utf-8")
    with pytest.raises(SystemExit, match="DEVELOPMENT_DATABASE_INTEGRITY_FAILURE"):
        _migrate(directory)
    assert legacy.read_text(encoding="utf-8") == "not sqlite"
    assert not (directory / tool.DATABASE_NAME).exists()


def test_legacy_and_canonical_database_fail_closed_without_writes(tmp_path):
    directory = tmp_path / "persistent"
    directory.mkdir()
    legacy = directory / tool.LEGACY_DATABASE_NAME
    canonical = directory / tool.DATABASE_NAME
    _initialize(canonical)
    legacy.write_text("synthetic", encoding="utf-8")
    with pytest.raises(SystemExit, match="DEVELOPMENT_DATABASE_MIGRATION_CONFLICT"):
        _migrate(directory)
    assert legacy.read_text(encoding="utf-8") == "synthetic"
    assert tool.inspect(canonical, expected_schema=CURRENT_SCHEMA)["schema_head"] == CURRENT_SCHEMA


def test_active_legacy_writer_blocks_migration(tmp_path):
    directory = tmp_path / "persistent"
    directory.mkdir()
    legacy = directory / tool.LEGACY_DATABASE_NAME
    _initialize(legacy)
    connection = sqlite3.connect(legacy, timeout=0)
    connection.execute("BEGIN IMMEDIATE")
    try:
        with pytest.raises(SystemExit, match="DEVELOPMENT_DATABASE_BUSY"):
            _migrate(directory)
    finally:
        connection.rollback()
        connection.close()
    assert legacy.exists()
    assert not (directory / tool.DATABASE_NAME).exists()


def test_interrupted_migration_marker_is_preserved_and_blocks_retry(tmp_path):
    directory = tmp_path / "persistent"
    directory.mkdir()
    legacy = directory / tool.LEGACY_DATABASE_NAME
    _initialize(legacy)
    marker = directory / f".{tool.DATABASE_NAME}.migrating"
    marker.write_text("synthetic interruption marker", encoding="utf-8")
    with pytest.raises(SystemExit, match="DEVELOPMENT_DATABASE_MIGRATION_TEMPORARY_EXISTS"):
        _migrate(directory)
    assert legacy.exists()
    assert marker.read_text(encoding="utf-8") == "synthetic interruption marker"
    assert not (directory / tool.DATABASE_NAME).exists()


def test_fresh_database_uses_canonical_schema_head_without_administrator(tmp_path, monkeypatch):
    repository = _repository(tmp_path)
    common = tmp_path / "common.git"
    common.mkdir()
    monkeypatch.setattr(tool, "common_directory", lambda _: common)
    directory, database = _prepare(repository, str(tmp_path / "persistent"))
    _initialize(database)
    state = tool.inspect(database, expected_schema=CURRENT_SCHEMA)
    assert directory.exists()
    assert state["schema_head"] == CURRENT_SCHEMA
    assert state["ledger"] == "valid"
    assert state["administrator_configured"] is False


def test_status_reports_schema_compatibility_and_manifest_consistency(tmp_path, monkeypatch):
    repository = _repository(tmp_path)
    common = tmp_path / "common.git"
    common.mkdir()
    monkeypatch.setattr(tool, "common_directory", lambda _: common)
    directory, database = _prepare(repository, str(tmp_path / "persistent"))
    _initialize(database)
    status = {
        **tool.inspect(database, expected_schema=CURRENT_SCHEMA),
        "layout": tool.database_layout(directory),
    }
    assert tool.compatibility(status["layout"], status, CURRENT_SCHEMA) == "COMPATIBLE"
    assert tool.manifest_consistency(directory, CURRENT_SCHEMA) == "CURRENT"


@pytest.mark.parametrize(
    "schema_head, expected",
    [
        (CURRENT_SCHEMA, "COMPATIBLE"),
        ("20260725_s43", "NEEDS_FORWARD_MIGRATION"),
        ("20260902_s47", "DATABASE_AHEAD_OF_SOURCE"),
    ],
)
def test_schema_compatibility_classification(schema_head, expected):
    state = {
        "integrity": "ok",
        "ledger": "valid",
        "schema_head": schema_head,
        "schema_checksum_valid": schema_head == CURRENT_SCHEMA,
    }
    known_heads = (*tool.schema_head_order(), "20260902_s47")
    assert tool.compatibility("CANONICAL", state, CURRENT_SCHEMA, known_heads) == expected


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
    assert status["expected_schema_head"] == CURRENT_SCHEMA
    assert status["compatibility"] == "MISSING"
    assert status["manifest_consistency"] == "MISSING"
