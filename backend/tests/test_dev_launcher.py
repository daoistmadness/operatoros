import json
import os
import signal
import shutil
import socket
import sqlite3
import subprocess
import time
import urllib.request
from pathlib import Path

import pytest


def _launcher_environment(tmp_path: Path, vite_body: str) -> tuple[dict[str, str], Path]:
    tools = tmp_path / "tools"
    tools.mkdir()
    node = tools / "node"
    node.write_text("#!/bin/sh\necho v22.0.0\n", encoding="utf-8")
    npm = tools / "npm"
    npm.write_text(
        """#!/bin/sh
if [ "${1:-}" = "--version" ]; then echo 10.0.0; exit 0; fi
shift 2
if [ "${1:-}" = "--" ]; then shift; fi
exec "$ASTRYX_VITE_EXECUTABLE" "$@"
""",
        encoding="utf-8",
    )
    vite = tools / "vite"
    vite.write_text(vite_body, encoding="utf-8")
    for executable in (node, npm, vite):
        executable.chmod(0o755)

    environment = os.environ.copy()
    environment.update(
        PATH=f"{tools}:{environment['PATH']}",
        OPERATOROS_JS_RUNTIME="node",
        OPERATOROS_NVM_DIR=str(tmp_path / "no-nvm"),
        OPERATOROS_RUNTIME_DIR=str(tmp_path / "runtime"),
        ASTRYX_VITE_EXECUTABLE=str(vite),
        ASTRYX_DEV_LOG_DIR=str(tmp_path / "logs"),
        ASTRYX_READINESS_TIMEOUT_SECONDS="15",
        ASTRYX_SHUTDOWN_TIMEOUT_SECONDS="2",
    )
    for name in ("DATABASE_URL", "AUTH_COOKIE_SECRET", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "POSTGRES_HOST", "POSTGRES_PORT"):
        environment.pop(name, None)
    return environment, vite


FAKE_VITE_SERVER = """#!/usr/bin/env python3
import argparse
import http.server
parser = argparse.ArgumentParser(add_help=False)
parser.add_argument("--host", default="127.0.0.1")
parser.add_argument("--port", type=int, default=5173)
arguments, _ = parser.parse_known_args()
http.server.ThreadingHTTPServer((arguments.host, arguments.port), http.server.SimpleHTTPRequestHandler).serve_forever()
"""


def _wait_for_url(url: str, timeout: float = 15) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(url, timeout=0.5).close()
            return True
        except Exception:
            time.sleep(0.2)
    return False


def _assert_port_available(port: int) -> None:
    deadline = time.monotonic() + 3
    while True:
        try:
            with socket.socket() as probe:
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                probe.bind(("127.0.0.1", port))
            return
        except OSError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.1)


def test_dev_launcher_exposes_backend_src_import_root():
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    contents = launcher.read_text(encoding="utf-8")

    assert 'export PYTHONPATH="$BACKEND_DIR/src${PYTHONPATH:+:$PYTHONPATH}"' in contents
    assert '"$VENV/bin/uvicorn" src.main:app' in contents


def test_dev_launcher_scopes_secure_setup_token_to_backend_process():
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    contents = launcher.read_text(encoding="utf-8")

    assert "secrets.token_urlsafe(48)" in contents
    assert contents.count('export ASTRYX_SETUP_TOKEN="$SETUP_TOKEN"') == 1
    assert "export OPERATOROS_MANAGED_DEV_SETUP=true" in contents
    assert "VITE_ASTRYX_SETUP_TOKEN" not in contents


def test_dev_launcher_prepares_stable_local_configuration(tmp_path):
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    environment, _ = _launcher_environment(tmp_path, FAKE_VITE_SERVER)
    environment.update(ASTRYX_DEV_PREPARE_ONLY="1", FRONTEND_PORT="15171", BACKEND_PORT="18008")

    first = subprocess.run([str(launcher)], env=environment, capture_output=True, text=True, timeout=30, check=False)
    assert first.returncode == 0, first.stderr
    sessions = sorted((tmp_path / "runtime" / "sessions").iterdir())
    assert len(sessions) == 1
    state = sessions[0] / "state"
    secret = (state / "auth-cookie-secret").read_text(encoding="utf-8")
    assert len(secret) >= 32
    assert secret not in first.stdout and secret not in first.stderr
    database = state / "operatoros-development.db"
    with sqlite3.connect(database) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"users", "sessions"}.issubset(tables)
    session_record = json.loads((sessions[0] / "session.json").read_text(encoding="utf-8"))
    assert session_record["database_path"] == str(database)

    second = subprocess.run([str(launcher)], env=environment, capture_output=True, text=True, timeout=30, check=False)
    assert second.returncode == 0, second.stderr
    sessions = sorted((tmp_path / "runtime" / "sessions").iterdir())
    assert len(sessions) == 2
    databases = {session / "state" / "operatoros-development.db" for session in sessions}
    assert len(databases) == 2
    assert all(database.exists() for database in databases)


@pytest.mark.parametrize("database", ["relative.db", "backend/attendance.db", "backend/.local-dev/astryx-development.db", "attendance.db"])
def test_dev_launcher_rejects_explicit_sqlite_database(tmp_path, database):
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    environment, _ = _launcher_environment(tmp_path, FAKE_VITE_SERVER)
    environment.update(
        ASTRYX_DEV_PREPARE_ONLY="1",
        FRONTEND_PORT="15172",
        BACKEND_PORT="18009",
        DATABASE_URL=f"sqlite:///{database}",
        AUTH_COOKIE_SECRET="explicit-test-secret-that-is-at-least-32-characters",
    )
    result = subprocess.run([str(launcher)], env=environment, capture_output=True, text=True, timeout=30, check=False)
    assert result.returncode == 2
    assert "DEVELOPMENT_DATABASE_PATH_REJECTED" in result.stdout + result.stderr


def test_dev_launcher_reports_missing_vite_before_starting_services(tmp_path):
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    environment, vite = _launcher_environment(tmp_path, FAKE_VITE_SERVER)
    vite.unlink()
    result = subprocess.run([str(launcher), "--check"], cwd=tmp_path, env=environment, capture_output=True, text=True, timeout=20)
    output = result.stdout + result.stderr
    assert result.returncode == 2
    assert "Frontend dependency installation is incomplete" in output
    assert "npm ci" in output
    assert "No OperatorOS services were started" in output


def test_dev_launcher_reports_unusable_node_before_starting_services(tmp_path):
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    environment, _ = _launcher_environment(tmp_path, FAKE_VITE_SERVER)
    node = Path(environment["PATH"].split(os.pathsep, 1)[0]) / "node"
    node.write_text("#!/bin/sh\nexit 3\n", encoding="utf-8")
    node.chmod(0o755)

    result = subprocess.run([str(launcher), "--check"], cwd=tmp_path, env=environment, capture_output=True, text=True, timeout=20)
    output = result.stdout + result.stderr
    assert result.returncode == 2
    assert "NODE_22_REQUIRED" in output
    assert "No OperatorOS services were started" in output


@pytest.mark.parametrize(("service", "frontend_port", "backend_port", "held_port"), [
    ("frontend", 15174, 18001, 15174),
    ("backend", 15175, 18002, 18002),
])
def test_dev_launcher_detects_port_conflicts_before_startup(tmp_path, service, frontend_port, backend_port, held_port):
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    environment, _ = _launcher_environment(tmp_path, FAKE_VITE_SERVER)
    environment.update(FRONTEND_PORT=str(frontend_port), BACKEND_PORT=str(backend_port))
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", held_port))
        listener.listen()
        result = subprocess.run([str(launcher), "--check"], cwd=tmp_path, env=environment, capture_output=True, text=True, timeout=20)
    output = result.stdout + result.stderr
    assert result.returncode == 2
    assert f"Port {held_port} is already in use" in output
    assert service in output.lower()
    assert "No OperatorOS services were started" in output


def test_dev_launcher_waits_for_readiness_and_ctrl_c_cleans_process_groups(tmp_path):
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    environment, _ = _launcher_environment(tmp_path, FAKE_VITE_SERVER)
    environment.update(FRONTEND_PORT="15176", BACKEND_PORT="18003")
    # Ensure ports are free from any previous interrupted test run
    _assert_port_available(15176)
    _assert_port_available(18003)
    process = subprocess.Popen([str(launcher)], cwd=tmp_path, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
    try:
        assert _wait_for_url("http://127.0.0.1:18003/health")
        assert _wait_for_url("http://127.0.0.1:15176")
        time.sleep(2)
        os.killpg(process.pid, signal.SIGINT)
        output, _ = process.communicate(timeout=15)
        assert process.returncode == 0, output
        assert "Status    Ready" in output
        assert "Frontend stopped" in output
        assert "Backend stopped" in output
        _assert_port_available(15176)
        _assert_port_available(18003)
    finally:
        if process.poll() is None:
            process.kill()


@pytest.mark.parametrize(("vite_body", "secret", "expected"), [
    (FAKE_VITE_SERVER, "short", "Backend readiness timed out"),
    ("#!/bin/sh\nexit 7\n", None, "Frontend stopped during startup (exit 7)"),
])
def test_dev_launcher_attributes_startup_failure_and_stops_peer(tmp_path, vite_body, secret, expected):
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    environment, _ = _launcher_environment(tmp_path, vite_body)
    environment.update(FRONTEND_PORT="15178", BACKEND_PORT="18005")
    if secret is not None:
        environment["AUTH_COOKIE_SECRET"] = secret
    result = subprocess.run([str(launcher)], cwd=tmp_path, env=environment, capture_output=True, text=True, timeout=25)
    output = result.stdout + result.stderr
    assert result.returncode == 1, output
    assert expected in output
    assert ".log" in output
    _assert_port_available(15178)
    _assert_port_available(18005)


def test_dev_launcher_ctrl_c_during_startup_cleans_process_groups(tmp_path):
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    environment, _ = _launcher_environment(tmp_path, FAKE_VITE_SERVER)
    environment.update(FRONTEND_PORT="15179", BACKEND_PORT="18006", AUTH_COOKIE_SECRET="short")
    process = subprocess.Popen([str(launcher)], cwd=tmp_path, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
    try:
        time.sleep(1)
        os.killpg(process.pid, signal.SIGINT)
        output, _ = process.communicate(timeout=15)
        assert process.returncode == 0, output
        assert "No OperatorOS services were started" in output or "Stopping OperatorOS development stack" in output
        _assert_port_available(15179)
        _assert_port_available(18006)
    finally:
        if process.poll() is None:
            process.kill()


def test_dev_launcher_detects_unexpected_frontend_exit_and_stops_backend(tmp_path):
    if shutil.which("fuser") is None:
        pytest.skip("fuser is unavailable for the listener termination fixture")
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    environment, _ = _launcher_environment(tmp_path, FAKE_VITE_SERVER)
    environment.update(FRONTEND_PORT="15180", BACKEND_PORT="18007")
    process = subprocess.Popen([str(launcher)], cwd=tmp_path, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        assert _wait_for_url("http://127.0.0.1:18007/health")
        assert _wait_for_url("http://127.0.0.1:15180")
        time.sleep(1.5)
        subprocess.run(["fuser", "-k", "15180/tcp"], capture_output=True, check=True)
        output, _ = process.communicate(timeout=15)
        assert process.returncode == 1, output
        assert "Frontend stopped unexpectedly" in output
        _assert_port_available(15180)
        _assert_port_available(18007)
    finally:
        if process.poll() is None:
            process.kill()
