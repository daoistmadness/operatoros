from __future__ import annotations

import importlib.util
import socket
import sqlite3
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "s43_startup_smoke.py"
SPEC = importlib.util.spec_from_file_location("s43_startup_smoke", SCRIPT)
assert SPEC and SPEC.loader
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)


def ledger_database(path: Path, version: str = "20260725_s43") -> Path:
    with sqlite3.connect(path) as connection:
        connection.execute(
            "CREATE TABLE operatoros_schema_migrations "
            "(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
        connection.execute(
            "INSERT INTO operatoros_schema_migrations VALUES (?,?)",
            (version, "2026-07-29T00:00:00+00:00"),
        )
    return path


def test_explicit_s43_rehearsal_path_is_accepted(tmp_path):
    selected = ledger_database(tmp_path / "s43.db")
    assert smoke.validate_rehearsal_database(selected, ROOT, "20260725_s43") == selected


def test_protected_database_path_is_rejected():
    with pytest.raises(ValueError, match="REHEARSAL_DATABASE_PATH_REJECTED"):
        smoke.validate_rehearsal_database(
            ROOT / "backend/attendance.db", ROOT, "20260724_s42"
        )


def test_repository_local_fallback_is_rejected(tmp_path):
    selected = ledger_database(ROOT / "scratch-startup-smoke.db")
    try:
        with pytest.raises(ValueError, match="REHEARSAL_DATABASE_PATH_REJECTED"):
            smoke.validate_rehearsal_database(selected, ROOT, "20260725_s43")
    finally:
        selected.unlink()


def test_s42_is_rejected_by_s43_smoke_without_mutation(tmp_path):
    selected = ledger_database(tmp_path / "s42.db", "20260724_s42")
    before = selected.read_bytes()
    with pytest.raises(ValueError, match="REHEARSAL_SCHEMA_HEAD_MISMATCH"):
        smoke.validate_rehearsal_database(selected, ROOT, "20260725_s43")
    assert selected.read_bytes() == before


def test_port_conflict_is_reported():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        with pytest.raises(RuntimeError, match="PORT_CONFLICT"):
            smoke.assert_port_free(listener.getsockname()[1])


def test_allocated_port_is_free():
    smoke.assert_port_free(smoke.allocate_port())


def test_sensitive_log_tail_is_sanitized(tmp_path):
    log = tmp_path / "backend.log"
    log.write_text("ERROR password=visible\nAuthorization: bearer-value\nsafe line\n")
    tail = smoke.sanitize_log_tail(log)
    assert "visible" not in tail
    assert "bearer-value" not in tail
    assert "safe line" in tail


def test_early_exit_includes_sanitized_log_tail(tmp_path):
    log = tmp_path / "backend.log"
    log.write_text("fatal token=do-not-show\n")
    process = subprocess.Popen(["/usr/bin/false"], text=True)
    process.wait()
    with pytest.raises(RuntimeError, match="BACKEND_EXITED_EARLY") as error:
        smoke.wait_for_readiness(process, "http://127.0.0.1:1/health", log, 0.2)
    assert "do-not-show" not in str(error.value)
    assert "[REDACTED]" in str(error.value)


def test_source_evidence_uses_current_repository(monkeypatch):
    backend = ROOT / "backend"
    python = backend / ".venv/bin/python"
    stdout = "\n".join(
        (
            str(backend / "src/main.py"),
            str(backend / "src/core/schema_guard.py"),
            str(backend / "src/models/__init__.py"),
            str(python),
        )
    )
    monkeypatch.setattr(
        smoke.subprocess,
        "run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess([], 0, stdout=stdout),
    )
    evidence = smoke.source_evidence(python, backend, {})
    assert all(backend.resolve() in Path(item).resolve().parents for item in evidence[:3])
    assert Path(evidence[3]).absolute() == python.absolute()


def test_partial_linking_remains_blocked(tmp_path):
    from core.database import validate_student_linking_gate
    from sqlalchemy import create_engine, text

    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE students (id INTEGER PRIMARY KEY)"))
        connection.execute(text("CREATE TABLE student_masters (id TEXT PRIMARY KEY)"))
        connection.execute(text("""
            CREATE TABLE student_device_identities (
                id INTEGER PRIMARY KEY,
                student_master_id TEXT NOT NULL,
                legacy_student_id INTEGER,
                is_active BOOLEAN NOT NULL
            )
        """))
        for item in range(2):
            connection.execute(text("INSERT INTO students VALUES (:id)"), {"id": item + 1})
        connection.execute(text("INSERT INTO student_masters VALUES ('master-1')"))
        connection.execute(text("""
            INSERT INTO student_device_identities
                (id, student_master_id, legacy_student_id, is_active)
            VALUES (1, 'master-1', 1, TRUE)
        """))
    with pytest.raises(RuntimeError, match="legacy student linking is incomplete"):
        validate_student_linking_gate(engine)
