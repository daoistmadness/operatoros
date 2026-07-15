from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import pytest

from .sidecar_harness import request_json, reserve_free_port, wait_for_port_release


pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="Windows Job Object contract")


def wait_ready(port: int, process: subprocess.Popen[bytes], timeout: float = 90) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(f"Desktop supervisor exited before readiness: {process.returncode}")
        try:
            status, payload = request_json(f"http://127.0.0.1:{port}/health", timeout=0.5)
            if status == 200 and payload.get("status") == "ok":
                return
        except Exception:
            pass
        time.sleep(0.1)
    raise AssertionError("Desktop supervisor readiness timed out")


def start_supervisor(supervisor: Path, sidecar: Path, data_root: Path, port: int):
    environment = os.environ.copy()
    environment.update({
        "ASTRYX_SIDECAR_EXECUTABLE": str(sidecar),
        "ASTRYX_DATA_ROOT": str(data_root),
        "ASTRYX_SIDECAR_PORT": str(port),
    })
    return subprocess.Popen(
        [str(supervisor)],
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def force_parent_only(process: subprocess.Popen[bytes]) -> None:
    subprocess.run(
        ["taskkill", "/PID", str(process.pid), "/F"],
        capture_output=True,
        check=False,
        timeout=20,
    )
    process.wait(timeout=20)


def assert_database_integrity(path: Path) -> None:
    with sqlite3.connect(path) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)


def test_parent_crash_kills_job_tree_and_allows_safe_restart(
    desktop_supervisor_executable: Path,
    sidecar_executable: Path,
    tmp_path: Path,
):
    data_root = tmp_path / "Astryx"
    port = reserve_free_port()
    first = start_supervisor(desktop_supervisor_executable, sidecar_executable, data_root, port)
    wait_ready(port, first)
    database = data_root / "data" / "astryx.sqlite3"

    force_parent_only(first)
    assert wait_for_port_release(port)
    assert_database_integrity(database)

    second = start_supervisor(desktop_supervisor_executable, sidecar_executable, data_root, port)
    try:
        wait_ready(port, second)
        assert_database_integrity(database)
    finally:
        force_parent_only(second)
    assert wait_for_port_release(port)
