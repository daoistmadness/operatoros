import json
import http.cookiejar
import os
import signal
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest


def _launcher_environment(tmp_path: Path, vite_body: str) -> tuple[dict[str, str], Path]:
    tools = tmp_path / "tools"
    tools.mkdir()
    node = tools / "node"
    node.write_text(
        "#!/bin/sh\n"
        "if [ \"${1:-}\" = \"-p\" ]; then echo node; exit 0; fi\n"
        "echo v22.0.0\n",
        encoding="utf-8",
    )
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
        OPERATOROS_DEV_DATA_DIR=str(tmp_path / "persistent-data"),
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


def _wait_for_url(url: str, timeout: float = 30) -> bool:
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


def _available_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _launcher_ports() -> tuple[int, int]:
    frontend_port = _available_port()
    backend_port = _available_port()
    while backend_port == frontend_port:
        backend_port = _available_port()
    return frontend_port, backend_port


def _stop_launcher(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGINT)
        process.communicate(timeout=15)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        process.kill()
        process.communicate(timeout=15)


def _wait_for_active_session(runtime: Path, timeout: float = 15) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if (runtime / "active-session").exists():
            return True
        time.sleep(0.1)
    return False


def _runtime_helper() -> Path:
    return Path(__file__).resolve().parents[2] / "scripts" / "operatoros-dev-runtime.py"


def _init_synthetic_session(tmp_path: Path, session: str) -> None:
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    runtime = tmp_path / "runtime"
    database = tmp_path / "persistent-data" / "operatoros-development.db"
    database.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [
            sys.executable, str(_runtime_helper()), "init-session",
            "--runtime", str(runtime), "--repo", str(launcher.parent),
            "--session", session, "--mode", "browser", "--token", "synthetic-token",
            "--javascript-runtime", "node", "--javascript-runtime-version", "22.0.0",
            "--launcher-pid", str(os.getpid()), "--frontend-host", "127.0.0.1",
            "--frontend-port", "0", "--backend-host", "127.0.0.1", "--backend-port", "0",
            "--database-path", str(database),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_dev_launcher_exposes_backend_src_import_root():
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    contents = launcher.read_text(encoding="utf-8")

    assert 'export PYTHONPATH="$BACKEND_DIR/src${PYTHONPATH:+:$PYTHONPATH}"' in contents
    assert '"$VENV/bin/uvicorn" src.main:app' in contents
    assert '--reload-dir "$BACKEND_DIR/src"' in contents


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
    persistent = tmp_path / "persistent-development"
    environment.update(ASTRYX_DEV_PREPARE_ONLY="1", FRONTEND_PORT="15171", BACKEND_PORT="18008", OPERATOROS_DEV_DATA_DIR=str(persistent))

    first = subprocess.run([str(launcher)], env=environment, capture_output=True, text=True, timeout=30, check=False)
    assert first.returncode == 0, first.stderr
    assert list((tmp_path / "runtime" / "sessions").iterdir()) == []
    secret = (persistent / "auth-cookie-secret").read_text(encoding="utf-8")
    assert len(secret) >= 32
    assert secret not in first.stdout and secret not in first.stderr
    database = persistent / "operatoros-development.db"
    with sqlite3.connect(database) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"users", "sessions"}.issubset(tables)
    second = subprocess.run([str(launcher)], env=environment, capture_output=True, text=True, timeout=30, check=False)
    assert second.returncode == 0, second.stderr
    assert list((tmp_path / "runtime" / "sessions").iterdir()) == []
    assert database.exists()


def test_dev_launcher_clean_shell_persists_admin_across_restart(tmp_path):
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    environment, _ = _launcher_environment(tmp_path, FAKE_VITE_SERVER)
    assert "DATABASE_URL" not in environment
    frontend_port, backend_port = _launcher_ports()
    environment.update(FRONTEND_PORT=str(frontend_port), BACKEND_PORT=str(backend_port))

    path_result = subprocess.run(
        [sys.executable, str(Path(__file__).resolve().parents[2] / "scripts" / "development_database.py"), "path", "--repo", str(launcher.parent)],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert path_result.returncode == 0, path_result.stderr
    resolved_path = Path(path_result.stdout.strip())

    def status() -> dict:
        result = subprocess.run(
            [sys.executable, str(Path(__file__).resolve().parents[2] / "scripts" / "development_database.py"), "status", "--repo", str(launcher.parent)],
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        return json.loads(result.stdout)

    first = subprocess.Popen(
        [str(launcher)], cwd=tmp_path, env=environment, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, text=True, start_new_session=True,
    )
    second = None
    try:
        assert _wait_for_url(f"http://127.0.0.1:{backend_port}/health")
        assert _wait_for_url(f"http://127.0.0.1:{frontend_port}")

        cookies = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
        bootstrap = urllib.request.Request(
            f"http://127.0.0.1:{backend_port}/api/setup/bootstrap",
            method="POST",
            headers={"Origin": "http://127.0.0.1:5173"},
        )
        with opener.open(bootstrap, timeout=5) as response:
            assert response.status == 204
        body = json.dumps({
            "username": "admin",
            "password": "correct horse battery",
            "password_confirmation": "correct horse battery",
        }).encode()
        admin = urllib.request.Request(
            f"http://127.0.0.1:{backend_port}/api/setup/admin",
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with opener.open(admin, timeout=5) as response:
            assert response.status == 201

        _stop_launcher(first)
        first = None

        first_status = status()
        assert Path(first_status["path"]).resolve() == resolved_path.resolve()
        assert first_status["administrator_configured"] is True
        assert first_status["users_count"] == 1

        frontend_port, backend_port = _launcher_ports()
        environment.update(FRONTEND_PORT=str(frontend_port), BACKEND_PORT=str(backend_port))
        second = subprocess.Popen(
            [str(launcher)], cwd=tmp_path, env=environment, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True, start_new_session=True,
        )
        assert _wait_for_url(f"http://127.0.0.1:{backend_port}/health")
        assert _wait_for_url(f"http://127.0.0.1:{frontend_port}")
        second_status = status()
        assert Path(second_status["path"]).resolve() == resolved_path.resolve()
        assert second_status["administrator_configured"] is True
        assert second_status["users_count"] == 1
    finally:
        if first is not None:
            _stop_launcher(first)
        if second is not None:
            _stop_launcher(second)


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


def test_dev_launcher_accepts_explicit_persistent_database_url(tmp_path):
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    environment, _ = _launcher_environment(tmp_path, FAKE_VITE_SERVER)
    persistent = tmp_path / "persistent-data"
    persistent_db = persistent / "operatoros-development.db"
    persistent_db.parent.mkdir(parents=True, exist_ok=True)
    environment.update(
        ASTRYX_DEV_PREPARE_ONLY="1",
        FRONTEND_PORT="15173",
        BACKEND_PORT="18010",
        OPERATOROS_DEV_DATA_DIR=str(persistent),
        DATABASE_URL=f"sqlite:///{persistent_db.resolve()}",
        AUTH_COOKIE_SECRET="explicit-test-secret-that-is-at-least-32-characters",
    )
    result = subprocess.run([str(launcher)], env=environment, capture_output=True, text=True, timeout=30, check=False)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "WARNING: DATABASE_URL IS OVERRIDING PERSISTENT DEV DB" not in result.stdout + result.stderr


def test_dev_launcher_warns_on_disposable_database_url_override(tmp_path):
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    environment, _ = _launcher_environment(tmp_path, FAKE_VITE_SERVER)
    disposable_db = tmp_path / "runtime" / "operatoros-dev" / "disposable.db"
    disposable_db.parent.mkdir(parents=True, exist_ok=True)
    environment.update(
        ASTRYX_DEV_PREPARE_ONLY="1",
        FRONTEND_PORT="15174",
        BACKEND_PORT="18011",
        DATABASE_URL=f"sqlite:///{disposable_db.resolve()}",
        AUTH_COOKIE_SECRET="explicit-test-secret-that-is-at-least-32-characters",
    )
    result = subprocess.run([str(launcher)], env=environment, capture_output=True, text=True, timeout=30, check=False)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "WARNING: DATABASE_URL IS OVERRIDING PERSISTENT DEV DB" in result.stdout + result.stderr



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
    assert "NODE_RUNTIME_INVALID_FOR_WSL" in output
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
    frontend_port, backend_port = _launcher_ports()
    environment.update(FRONTEND_PORT=str(frontend_port), BACKEND_PORT=str(backend_port))
    process = subprocess.Popen([str(launcher)], cwd=tmp_path, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
    try:
        assert _wait_for_url(f"http://127.0.0.1:{backend_port}/health")
        assert _wait_for_url(f"http://127.0.0.1:{frontend_port}")
        time.sleep(2)
        os.killpg(process.pid, signal.SIGINT)
        output, _ = process.communicate(timeout=30)
        assert process.returncode == 130, output
        assert "Status    Ready" in output
        assert "Frontend stopped" in output
        assert "Backend stopped" in output
        _assert_port_available(frontend_port)
        _assert_port_available(backend_port)
        database = tmp_path / "persistent-data" / "operatoros-development.db"
        assert database.exists()
        with sqlite3.connect(database) as connection:
            assert connection.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0] == 0
        assert not (tmp_path / "runtime" / "active-session").exists()
        assert list((tmp_path / "runtime" / "sessions").iterdir()) == []
    finally:
        _stop_launcher(process)


@pytest.mark.parametrize(("vite_body", "secret", "expected"), [
    (FAKE_VITE_SERVER, "short", "Backend readiness timed out"),
    ("#!/bin/sh\nexit 7\n", None, "Frontend stopped during startup (exit 7)"),
])
def test_dev_launcher_attributes_startup_failure_and_stops_peer(tmp_path, vite_body, secret, expected):
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    environment, _ = _launcher_environment(tmp_path, vite_body)
    frontend_port, backend_port = _launcher_ports()
    environment.update(FRONTEND_PORT=str(frontend_port), BACKEND_PORT=str(backend_port))
    if secret is not None:
        environment["AUTH_COOKIE_SECRET"] = secret
        environment["ASTRYX_READINESS_TIMEOUT_SECONDS"] = "5"
    result = subprocess.run([str(launcher)], cwd=tmp_path, env=environment, capture_output=True, text=True, timeout=30)
    output = result.stdout + result.stderr
    assert result.returncode == 1, output
    assert expected in output
    assert ".log" in output
    _assert_port_available(frontend_port)
    _assert_port_available(backend_port)


def test_dev_launcher_ctrl_c_during_startup_cleans_process_groups(tmp_path):
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    environment, _ = _launcher_environment(tmp_path, FAKE_VITE_SERVER)
    frontend_port, backend_port = _launcher_ports()
    environment.update(
        FRONTEND_PORT=str(frontend_port),
        BACKEND_PORT=str(backend_port),
        AUTH_COOKIE_SECRET="explicit-test-secret-that-is-at-least-32-characters",
        ASTRYX_READINESS_TIMEOUT_SECONDS="5",
    )
    process = subprocess.Popen([str(launcher)], cwd=tmp_path, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
    try:
        assert _wait_for_active_session(tmp_path / "runtime")
        os.killpg(process.pid, signal.SIGINT)
        output, _ = process.communicate(timeout=30)
        assert process.returncode == 130, output
        assert "No OperatorOS services were started" in output or "Stopping OperatorOS development stack" in output
        _assert_port_available(frontend_port)
        _assert_port_available(backend_port)
    finally:
        _stop_launcher(process)


def test_dev_launcher_detects_unexpected_frontend_exit_and_stops_backend(tmp_path):
    if shutil.which("fuser") is None:
        pytest.skip("fuser is unavailable for the listener termination fixture")
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    environment, _ = _launcher_environment(tmp_path, FAKE_VITE_SERVER)
    frontend_port, backend_port = _launcher_ports()
    environment.update(FRONTEND_PORT=str(frontend_port), BACKEND_PORT=str(backend_port))
    process = subprocess.Popen([str(launcher)], cwd=tmp_path, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        assert _wait_for_url(f"http://127.0.0.1:{backend_port}/health")
        assert _wait_for_url(f"http://127.0.0.1:{frontend_port}")
        time.sleep(1.5)
        subprocess.run(["fuser", "-k", f"{frontend_port}/tcp"], capture_output=True, check=True)
        output, _ = process.communicate(timeout=15)
        assert process.returncode == 1, output
        assert "Frontend stopped unexpectedly" in output
        _assert_port_available(frontend_port)
        _assert_port_available(backend_port)
        assert (tmp_path / "persistent-data" / "operatoros-development.db").exists()
        assert not (tmp_path / "runtime" / "active-session").exists()
        assert list((tmp_path / "runtime" / "sessions").iterdir()) == []
    finally:
        _stop_launcher(process)


def test_dev_launcher_recovers_a_stale_owned_active_session(tmp_path):
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    _init_synthetic_session(tmp_path, "stale-session")
    environment, _ = _launcher_environment(tmp_path, FAKE_VITE_SERVER)
    frontend_port, backend_port = _launcher_ports()
    environment.update(ASTRYX_DEV_PREPARE_ONLY="1", FRONTEND_PORT=str(frontend_port), BACKEND_PORT=str(backend_port))

    result = subprocess.run([str(launcher)], cwd=tmp_path, env=environment, capture_output=True, text=True, timeout=30, check=False)

    assert result.returncode == 0, result.stdout + result.stderr
    assert not (tmp_path / "runtime" / "active-session").exists()
    assert list((tmp_path / "runtime" / "sessions").iterdir()) == []


def test_dev_launcher_blocks_a_genuine_active_session(tmp_path):
    launcher = Path(__file__).resolve().parents[2] / "start-dev.sh"
    session = "active-session"
    _init_synthetic_session(tmp_path, session)
    runtime = tmp_path / "runtime"
    register = subprocess.run(
        [
            sys.executable, str(_runtime_helper()), "register",
            "--runtime", str(runtime), "--repo", str(launcher.parent), "--session", session,
            "--role", "backend", "--token", "synthetic-token", "--pid", str(os.getpid()), "--port", "0",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert register.returncode == 0, register.stderr
    environment, _ = _launcher_environment(tmp_path, FAKE_VITE_SERVER)
    frontend_port, backend_port = _launcher_ports()
    environment.update(ASTRYX_DEV_PREPARE_ONLY="1", FRONTEND_PORT=str(frontend_port), BACKEND_PORT=str(backend_port))

    result = subprocess.run([str(launcher)], cwd=tmp_path, env=environment, capture_output=True, text=True, timeout=30, check=False)

    assert result.returncode == 2
    assert "SINGLE_ACTIVE_DEVELOPMENT_SESSION" in result.stdout + result.stderr
    (runtime / "sessions" / session / "backend.pid").unlink()
    cleanup = subprocess.run(
        [sys.executable, str(_runtime_helper()), "finalize-session", "--runtime", str(runtime), "--repo", str(launcher.parent), "--session", session],
        capture_output=True,
        text=True,
        check=False,
    )
    assert cleanup.returncode == 0, cleanup.stderr
