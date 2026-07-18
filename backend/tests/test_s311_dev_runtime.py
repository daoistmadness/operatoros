import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "scripts" / "operatoros-dev-runtime.py"


def _wait_listener(port: int) -> None:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.05)
    raise AssertionError(f"fixture did not listen on {port}")


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _fixture(port: int) -> subprocess.Popen:
    return subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def _start_ticks(pid: int) -> str:
    value = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8")
    return value[value.rfind(")") + 2 :].split()[19]


def test_cleanup_preserves_unmanaged_listener(tmp_path):
    port = _free_port()
    process = _fixture(port)
    try:
        _wait_listener(port)
        result = subprocess.run(
            [sys.executable, str(HELPER), "cleanup-port", "--runtime", str(tmp_path), "--repo", str(ROOT), "--port", str(port)],
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 3
        assert "UNKNOWN_OWNER" in result.stdout
        assert "No process was terminated" in result.stdout
        assert process.poll() is None
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def test_cleanup_stops_only_validated_stale_session(tmp_path):
    port = _free_port()
    process = _fixture(port)
    session = tmp_path / "sessions" / "fixture-session"
    session.mkdir(parents=True)
    token = "operatoros-session-fixture"
    (session / "session.json").write_text(json.dumps({"session_id": "fixture-session"}), encoding="utf-8")
    (session / "frontend.pid").write_text(
        json.dumps({"pid": process.pid, "role": "frontend", "start_ticks": _start_ticks(process.pid), "token": token, "port": port}),
        encoding="utf-8",
    )
    try:
        _wait_listener(port)
        result = subprocess.run(
            [sys.executable, str(HELPER), "cleanup-port", "--runtime", str(tmp_path), "--repo", str(ROOT), "--port", str(port), "--timeout", "0.3"],
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        assert "Found stale OperatorOS" in result.stdout
        process.wait(timeout=3)
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def test_vite_configuration_is_strict_and_port_synchronized():
    config = (ROOT / "frontend" / "vite.config.js").read_text(encoding="utf-8")
    assert "process.env.FRONTEND_PORT ?? 5173" in config
    assert "process.env.BACKEND_PORT ?? 8000" in config
    assert "strictPort: true" in config
    assert "clearScreen: false" in config
    assert "port: frontendPort" in config


def test_windows_launcher_generates_untracked_matching_dev_url():
    launcher = (ROOT / "scripts" / "start-tauri-dev.ps1").read_text(encoding="utf-8")
    assert "ports.frontend_url" in launcher
    assert "tauri.dev.override.json" in launcher
    assert "beforeDevCommand = $null" in launcher
    assert "bundle = @{ resources = @() }" in launcher
    assert "$env:OPERATOROS_TAURI_DEV_URL = $ports.frontend_url" in launcher
    assert "candidate.session_id -ne $previousSessionId" in launcher
    assert "./stop-dev.sh --session" in launcher
    assert "& $bunExecutable run tauri -- dev --config $overridePath" in launcher
    assert ".runtime/operatoros-dev/" in (ROOT / ".gitignore").read_text(encoding="utf-8")
