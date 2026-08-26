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


def test_status_reports_sanitized_session_classifications(tmp_path):
    missing = subprocess.run(
        [sys.executable, str(HELPER), "status", "--runtime", str(tmp_path / "runtime"), "--repo", str(ROOT)],
        capture_output=True, text=True, check=False,
    )
    assert missing.returncode == 0
    assert json.loads(missing.stdout) == {"state": "NO_ACTIVE_SESSION"}

    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "active-session").write_text("corrupt\n", encoding="utf-8")
    corrupt = subprocess.run(
        [sys.executable, str(HELPER), "status", "--runtime", str(runtime), "--repo", str(ROOT)],
        capture_output=True, text=True, check=False,
    )
    assert json.loads(corrupt.stdout) == {"state": "STALE_SESSION_UNVERIFIED"}


def test_stale_session_unverified_never_triggers_broad_cleanup(tmp_path):
    runtime = tmp_path / "runtime"
    session = runtime / "sessions" / "unverified"
    session.mkdir(parents=True)
    (runtime / "active-session").write_text("unverified\n", encoding="utf-8")
    (session / "session.json").write_text(json.dumps({"session_id": "unverified"}), encoding="utf-8")

    status = subprocess.run(
        [sys.executable, str(HELPER), "status", "--runtime", str(runtime), "--repo", str(ROOT)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert json.loads(status.stdout) == {"state": "STALE_SESSION_UNVERIFIED"}

    result = subprocess.run(
        [sys.executable, str(HELPER), "require-no-active-session", "--runtime", str(runtime), "--repo", str(ROOT)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 2
    assert "STALE_SESSION_UNVERIFIED" in result.stderr
    assert (runtime / "active-session").exists()
    assert session.exists()


def test_verified_stale_session_cleanup_preserves_persistent_database(tmp_path):
    runtime = tmp_path / "runtime"
    session = runtime / "sessions" / "verified-stale"
    session.mkdir(parents=True)
    persistent_db = tmp_path / "persistent" / "operatoros-development.db"
    persistent_db.parent.mkdir()
    persistent_db.write_bytes(b"synthetic persistent database")
    (runtime / "active-session").write_text("verified-stale\n", encoding="utf-8")
    (session / "ownership.json").write_text(
        json.dumps({"application": "OperatorOS", "session_id": "verified-stale"}), encoding="utf-8"
    )
    (session / "session.json").write_text(
        json.dumps({"session_id": "verified-stale", "database_path": str(persistent_db)}), encoding="utf-8"
    )

    result = subprocess.run(
        [sys.executable, str(HELPER), "require-no-active-session", "--runtime", str(runtime), "--repo", str(ROOT)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert not session.exists()
    assert not (runtime / "active-session").exists()
    assert persistent_db.read_bytes() == b"synthetic persistent database"


def test_vite_configuration_is_strict_and_port_synchronized():
    config = (ROOT / "frontend" / "vite.config.js").read_text(encoding="utf-8")
    assert "process.env.FRONTEND_PORT ?? 5173" in config
    assert "process.env.BACKEND_PORT ?? 8000" in config
    assert "strictPort: true" in config
    assert "clearScreen: false" in config
    assert "port: frontendPort" in config
