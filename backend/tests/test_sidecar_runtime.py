from __future__ import annotations

import logging
from pathlib import Path

import pytest

from core.runtime import (
    RuntimeLock,
    RuntimeConfigurationError,
    apply_runtime_environment,
    load_or_create_cookie_secret,
    prepare_desktop_runtime,
    resolve_desktop_runtime,
)


def runtime_environment(tmp_path: Path, version: str = "11.1b") -> dict[str, str]:
    root = tmp_path / "OperatorOS"
    return {
        "OPERATOROS_DATA_DIR": str(root / "Data"),
        "OPERATOROS_LOG_DIR": str(root / "Logs"),
        "OPERATOROS_RUNTIME_DIR": str(root / "Runtime"),
        "OPERATOROS_VERSION": version,
    }


def test_runtime_resolves_frozen_directory_contract(tmp_path: Path):
    runtime = resolve_desktop_runtime(runtime_environment(tmp_path))
    assert runtime.database_path == tmp_path / "OperatorOS" / "Data" / "operatoros.db"
    assert runtime.backup_dir.name == "Backups"
    assert runtime.log_dir.name == "Logs"
    assert runtime.runtime_dir.name == "Runtime"
    assert runtime.export_dir.name == "Exports"
    assert runtime.version == "11.1b"


def test_runtime_falls_back_to_local_app_data(tmp_path: Path):
    runtime = resolve_desktop_runtime({"LOCALAPPDATA": str(tmp_path)})
    assert runtime.root_dir == tmp_path / "OperatorOS"
    assert runtime.data_dir == tmp_path / "OperatorOS" / "Data"


def test_runtime_rejects_relative_or_wrong_contract_paths(tmp_path: Path):
    with pytest.raises(RuntimeConfigurationError, match="absolute"):
        resolve_desktop_runtime({"OPERATOROS_DATA_DIR": "relative/Data"})
    with pytest.raises(RuntimeConfigurationError, match="named OperatorOS"):
        resolve_desktop_runtime({"OPERATOROS_DATA_DIR": str(tmp_path / "Wrong" / "Data")})
    with pytest.raises(RuntimeConfigurationError, match="Logs"):
        resolve_desktop_runtime(
            {
                "OPERATOROS_DATA_DIR": str(tmp_path / "OperatorOS" / "Data"),
                "OPERATOROS_LOG_DIR": str(tmp_path / "OperatorOS" / "Elsewhere"),
            }
        )


def test_prepare_and_environment_use_persistent_secret(tmp_path: Path):
    runtime = resolve_desktop_runtime(runtime_environment(tmp_path))
    prepare_desktop_runtime(runtime)
    first = load_or_create_cookie_secret(runtime)
    second = load_or_create_cookie_secret(runtime)
    assert first == second
    assert len(first) >= 32
    target: dict[str, str] = {}
    apply_runtime_environment(runtime, target)
    assert target["DATABASE_URL"].endswith("/OperatorOS/Data/operatoros.db")
    assert target["AUTH_COOKIE_SECRET"] == first
    assert target["HOST"] == "127.0.0.1"
    assert target["BACKEND_WORKERS"] == "1"


def test_runtime_lock_rejects_a_second_data_root_owner(tmp_path: Path):
    runtime = resolve_desktop_runtime(runtime_environment(tmp_path))
    prepare_desktop_runtime(runtime)
    first = RuntimeLock(runtime)
    second = RuntimeLock(runtime)
    first.acquire()
    try:
        with pytest.raises(RuntimeConfigurationError, match="already owns"):
            second.acquire()
    finally:
        first.release()


def test_sidecar_run_disposes_engine_and_flushes_logging(monkeypatch, tmp_path: Path):
    import sidecar_main

    runtime = resolve_desktop_runtime(runtime_environment(tmp_path))
    events: list[str] = []

    class Engine:
        def dispose(self):
            events.append("dispose")

    class Lock:
        def __init__(self, _runtime):
            pass

        def acquire(self):
            events.append("lock")

        def release(self):
            events.append("unlock")

    monkeypatch.setattr(sidecar_main, "resolve_desktop_runtime", lambda: runtime)
    monkeypatch.setattr(sidecar_main, "prepare_desktop_runtime", lambda _runtime: None)
    monkeypatch.setattr(sidecar_main, "RuntimeLock", Lock)
    monkeypatch.setattr(sidecar_main, "configure_logging", lambda *_args: logging.basicConfig())
    monkeypatch.setattr(sidecar_main, "apply_runtime_environment", lambda _runtime: None)
    monkeypatch.setattr(sidecar_main, "apply_bootstrap_migrations", lambda _runtime: None)
    monkeypatch.setattr(sidecar_main, "mount_frontend", lambda _app: None)

    import core.database
    import main
    import uvicorn

    monkeypatch.setattr(core.database, "engine", Engine())
    monkeypatch.setattr(uvicorn, "run", lambda *_args, **_kwargs: events.append("run"))
    assert sidecar_main.run(["--port", "19191"]) == 0
    assert events == ["lock", "run", "dispose", "unlock"]
