from __future__ import annotations

import os
import re
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[2]


def test_start_banner_consumes_the_schema_resolver(tmp_path: Path) -> None:
    source = (ROOT / "start-dev.sh").read_text(encoding="utf-8")
    assert "schema-version-cli.ts" in source
    assert "Schema    %s" in source
    assert "Schema    20260901_s46" not in source


def test_active_python_consumers_do_not_redeclare_schema_head() -> None:
    consumers = (
        ROOT / "scripts" / "development_database.py",
        ROOT / "backend" / "src" / "core" / "schema_guard.py",
        ROOT / "backend" / "src" / "core" / "schema_migrations.py",
        ROOT / "backend" / "src" / "core" / "operational_recovery.py",
        ROOT / "backend" / "src" / "core" / "staff_schema_migration.py",
    )
    declaration = re.compile(r"^\s*(?:CURRENT_SCHEMA_VERSION|SCHEMA_HEAD)\s*=", re.MULTILINE)
    for consumer in consumers:
        source = consumer.read_text(encoding="utf-8")
        assert declaration.search(source) is None, consumer
        assert "20260901_s46" not in source, consumer
    assert not (ROOT / "backend" / "src" / "core" / "schema_versions.py").exists()


def test_runtime_cleanup_tolerates_missing_session_state(tmp_path: Path) -> None:
    runtime = tmp_path / "runtime"
    session = "missing-session"
    command = [str(ROOT / "scripts" / "operatoros-dev-runtime.py"), "mark", "--runtime", str(runtime), "--session", session, "--status", "stopped"]
    marked = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=False)
    assert marked.returncode == 0, marked.stderr

    finalized = subprocess.run(
        [str(ROOT / "scripts" / "operatoros-dev-runtime.py"), "finalize-session", "--runtime", str(runtime), "--repo", str(ROOT), "--session", session],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert finalized.returncode == 0, finalized.stderr
    assert "Traceback" not in finalized.stderr

    session_dir = runtime / "sessions" / "partial-session"
    session_dir.mkdir(parents=True)
    (session_dir / "ownership.json").write_text(
        '{"application":"OperatorOS","session_id":"partial-session"}\n',
        encoding="utf-8",
    )
    partial = subprocess.run(
        [str(ROOT / "scripts" / "operatoros-dev-runtime.py"), "finalize-session", "--runtime", str(runtime), "--repo", str(ROOT), "--session", "partial-session"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert partial.returncode == 0, partial.stderr


def test_controlled_preflight_failure_does_not_finalize_missing_session(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "operatoros-development.db").write_text("not sqlite", encoding="utf-8")
    environment = os.environ.copy()
    environment.update(
        {
            "OPERATOROS_DATA_DIR": str(data_dir),
            "OPERATOROS_RUNTIME_DIR": str(tmp_path / "runtime"),
            "ASTRYX_DEV_PREPARE_ONLY": "1",
        }
    )

    result = subprocess.run(
        [str(ROOT / "start-dev.sh"), "--check"],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 2
    output = result.stdout + result.stderr
    assert "DEVELOPMENT_DATABASE_INTEGRITY_FAILURE" in output
    assert output.count("No OperatorOS services were started.") == 1
    assert "Traceback" not in output
    assert "FileNotFoundError" not in output
