from __future__ import annotations

import json
import socket
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from .sidecar_harness import (
    SidecarCrashed,
    SidecarProcess,
    SidecarStartupTimeout,
    authenticated_opener,
    port_is_available,
    request_json,
    reserve_free_port,
    wait_for_port_release,
)


pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="Windows sidecar contract")


REQUIRED_TABLES = {
    "users",
    "sessions",
    "first_admin_setup_state",
    "students",
    "attendance",
    "backup_scheduler_config",
    "backup_execution_history",
}


def database_tables(path: Path) -> set[str]:
    with sqlite3.connect(path) as connection:
        return {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }


def assert_integrity(path: Path) -> None:
    with sqlite3.connect(path) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)


def test_operational_lifecycle_contract(sidecar_executable: Path, tmp_path: Path):
    data_root = tmp_path / "OperatorOS"
    port = reserve_free_port()
    setup_token = "desktop-contract-setup-token"
    environment = {
        "ASTRYX_SETUP_TOKEN": setup_token,
        "ENABLE_DESTRUCTIVE_OPERATIONS": "true",
    }
    sidecar = SidecarProcess(sidecar_executable, data_root, port, environment).start()
    try:
        health = sidecar.wait_ready()
        assert health["status"] == "ok"
        assert health["service"] == "operatoros-sidecar"
        assert health["version"]
        assert not port_is_available(port)
        assert sidecar.stderr_path.exists()

        database = data_root / "Data" / "operatoros.db"
        secret = data_root / "Runtime" / "auth-cookie-secret"
        assert database.is_file()
        assert len(secret.read_text(encoding="utf-8").strip()) >= 32
        original_secret = secret.read_text(encoding="utf-8")
        assert REQUIRED_TABLES <= database_tables(database)
        assert_integrity(database)

        status, setup = request_json(f"{sidecar.base_url}/api/setup/status")
        assert status == 200 and setup == {"setup_required": True, "setup_token_required": True}
        status, admin = request_json(
            f"{sidecar.base_url}/api/setup/admin",
            method="POST",
            body={
                "username": "desktop-admin",
                "password": "desktop contract passphrase",
                "password_confirmation": "desktop contract passphrase",
                "setup_token": setup_token,
            },
        )
        assert status == 201 and admin["role"] == "admin"

        client = authenticated_opener()
        status, login = request_json(
            f"{sidecar.base_url}/api/auth/login",
            method="POST",
            body={"username": "desktop-admin", "password": "desktop contract passphrase"},
            opener=client,
        )
        assert status == 200 and login["username"] == "desktop-admin"
        assert request_json(f"{sidecar.base_url}/api/auth/me", opener=client)[0] == 200
        assert request_json(f"{sidecar.base_url}/api/admin/backups/status")[0] == 401

        status, backup = request_json(
            f"{sidecar.base_url}/api/admin/backups", method="POST", opener=client
        )
        assert status == 200
        backup_file = data_root / "Backups" / backup["filename"]
        metadata_file = Path(str(backup_file) + ".meta.json")
        assert backup_file.is_file() and metadata_file.is_file()
        metadata = json.loads(metadata_file.read_text(encoding="utf-8"))
        assert metadata["sha256"] == backup["sha256"]
        assert metadata["sqlite_file_size_bytes"] == backup_file.stat().st_size
        assert_integrity(backup_file)

        status, _ = request_json(
            f"{sidecar.base_url}/api/auth/logout", method="POST", opener=client
        )
        assert status == 204
        assert request_json(f"{sidecar.base_url}/api/auth/me", opener=client)[0] == 401
        assert_integrity(database)
    finally:
        shutdown_code = sidecar.graceful_stop()
        assert shutdown_code in {0, 3}
        assert "Application shutdown complete" in sidecar.read_stderr()

    assert wait_for_port_release(port)
    assert_integrity(database)

    restarted = SidecarProcess(sidecar_executable, data_root, port, environment).start()
    try:
        assert restarted.wait_ready()["status"] == "ok"
        assert secret.read_text(encoding="utf-8") == original_secret
        status, setup = request_json(f"{restarted.base_url}/api/setup/status")
        assert status == 200 and setup["setup_required"] is False
        with sqlite3.connect(database) as connection:
            assert connection.execute(
                "SELECT COUNT(*) FROM users WHERE username='desktop-admin'"
            ).fetchone() == (1,)
    finally:
        shutdown_code = restarted.graceful_stop()
        assert shutdown_code in {0, 3}
        assert "Application shutdown complete" in restarted.read_stderr()
    assert wait_for_port_release(port)


def test_live_restore_completes_on_windows(sidecar_executable: Path, tmp_path: Path):
    data_root = tmp_path / "OperatorOS"
    sidecar = SidecarProcess(
        sidecar_executable,
        data_root,
        reserve_free_port(),
        {
            "ASTRYX_SETUP_TOKEN": "restore-contract-token",
            "ENABLE_DESTRUCTIVE_OPERATIONS": "true",
        },
    ).start()
    try:
        sidecar.wait_ready()
        assert request_json(
            f"{sidecar.base_url}/api/setup/admin",
            method="POST",
            body={
                "username": "restore-admin",
                "password": "restore contract passphrase",
                "password_confirmation": "restore contract passphrase",
                "setup_token": "restore-contract-token",
            },
        )[0] == 201
        client = authenticated_opener()
        assert request_json(
            f"{sidecar.base_url}/api/auth/login",
            method="POST",
            body={"username": "restore-admin", "password": "restore contract passphrase"},
            opener=client,
        )[0] == 200
        status, backup = request_json(
            f"{sidecar.base_url}/api/admin/backups", method="POST", opener=client
        )
        assert status == 200
        status, restored = request_json(
            f"{sidecar.base_url}/api/admin/backups/{backup['filename']}/restore",
            method="POST",
            body={"confirmation": backup["filename"]},
            opener=client,
        )
        assert status == 200
        assert restored["status"] == "restored"
        assert_integrity(data_root / "Data" / "operatoros.db")
    finally:
        sidecar.force_stop()


def test_invalid_persisted_secret_fails_closed(sidecar_executable: Path, tmp_path: Path):
    data_root = tmp_path / "OperatorOS"
    secret = data_root / "Runtime" / "auth-cookie-secret"
    secret.parent.mkdir(parents=True)
    secret.write_text("short", encoding="utf-8")
    sidecar = SidecarProcess(sidecar_executable, data_root, reserve_free_port()).start()
    with pytest.raises(SidecarCrashed, match="Persisted authentication secret is invalid"):
        sidecar.wait_ready()
    assert sidecar.process is not None and sidecar.process.returncode != 0
    sidecar.close_logs()


def test_invalid_data_root_fails_closed(sidecar_executable: Path, tmp_path: Path):
    invalid_root = tmp_path / "OperatorOS"
    invalid_root.write_text("occupied", encoding="utf-8")
    sidecar = SidecarProcess(sidecar_executable, invalid_root, reserve_free_port()).start()
    with pytest.raises(SidecarCrashed):
        sidecar.wait_ready()
    error = sidecar.read_stderr().lower()
    assert "fatal sidecar startup error" in error
    sidecar.close_logs()


def test_occupied_port_fails_and_logs(sidecar_executable: Path, tmp_path: Path):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = int(listener.getsockname()[1])
        sidecar = SidecarProcess(sidecar_executable, tmp_path / "OperatorOS", port).start()
        with pytest.raises(SidecarCrashed):
            sidecar.wait_ready()
    error = sidecar.read_stderr().lower()
    assert "10048" in error and "only one usage" in error
    sidecar.close_logs()
    assert wait_for_port_release(port)


def test_startup_timeout_is_distinct_from_process_crash(tmp_path: Path):
    process = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(10)"],
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )
    harness = SidecarProcess(Path(sys.executable), tmp_path / "unused", reserve_free_port())
    harness.process = process
    try:
        with pytest.raises(SidecarStartupTimeout):
            harness.wait_ready(timeout=0.5)
    finally:
        process.terminate()
        process.wait(timeout=5)


def test_forced_crash_releases_port_and_database_restarts(
    sidecar_executable: Path, tmp_path: Path
):
    data_root = tmp_path / "OperatorOS"
    port = reserve_free_port()
    first = SidecarProcess(sidecar_executable, data_root, port).start()
    assert first.wait_ready()["status"] == "ok"
    database = data_root / "Data" / "operatoros.db"
    first.force_stop()
    assert wait_for_port_release(port)
    assert_integrity(database)

    second = SidecarProcess(sidecar_executable, data_root, port).start()
    try:
        assert second.wait_ready()["status"] == "ok"
        assert_integrity(database)
    finally:
        shutdown_code = second.graceful_stop()
        assert shutdown_code in {0, 3}
        assert "Application shutdown complete" in second.read_stderr()
    assert wait_for_port_release(port)


def test_second_instance_is_rejected(sidecar_executable: Path, tmp_path: Path):
    data_root = tmp_path / "OperatorOS"
    first = SidecarProcess(sidecar_executable, data_root, reserve_free_port()).start()
    first.wait_ready()
    second = SidecarProcess(sidecar_executable, data_root, reserve_free_port()).start()
    try:
        with pytest.raises(
            SidecarCrashed,
            match="already owns this application data root",
        ):
            second.wait_ready()
    finally:
        second.force_stop()
        first.force_stop()
