"""Windows process harness for the packaged OperatorOS FastAPI sidecar."""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any


class SidecarError(RuntimeError):
    """Base lifecycle contract failure."""


class SidecarCrashed(SidecarError):
    """The process exited before becoming ready."""


class SidecarStartupTimeout(SidecarError):
    """The process remained alive but never became ready."""


def reserve_free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def port_is_available(port: int) -> bool:
    try:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False


def wait_for_port_release(port: int, timeout: float = 15) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if port_is_available(port):
            return True
        time.sleep(0.1)
    return False


def request_json(
    url: str,
    *,
    method: str = "GET",
    body: dict[str, Any] | None = None,
    opener: urllib.request.OpenerDirector | None = None,
    timeout: float = 5,
) -> tuple[int, Any]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data is not None else {},
    )
    client = opener or urllib.request.build_opener()
    try:
        with client.open(request, timeout=timeout) as response:
            payload = response.read()
            return response.status, json.loads(payload) if payload else None
    except urllib.error.HTTPError as error:
        payload = error.read()
        return error.code, json.loads(payload) if payload else None


@dataclass
class SidecarProcess:
    executable: Path
    data_root: Path
    port: int
    extra_environment: dict[str, str] | None = None

    def __post_init__(self) -> None:
        self.process: subprocess.Popen[bytes] | None = None
        self.stdout_path = self.data_root.parent / f"sidecar-{self.port}.stdout.log"
        self.stderr_path = self.data_root.parent / f"sidecar-{self.port}.stderr.log"
        self._stdout = None
        self._stderr = None

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def start(self) -> "SidecarProcess":
        self.data_root.parent.mkdir(parents=True, exist_ok=True)
        environment = os.environ.copy()
        environment["OPERATOROS_DATA_DIR"] = str(self.data_root / "Data")
        environment["OPERATOROS_LOG_DIR"] = str(self.data_root / "Logs")
        environment["OPERATOROS_RUNTIME_DIR"] = str(self.data_root / "Runtime")
        environment.setdefault("OPERATOROS_VERSION", "desktop-contract-test")
        environment.update(self.extra_environment or {})
        self._stdout = self.stdout_path.open("wb")
        self._stderr = self.stderr_path.open("wb")
        self.process = subprocess.Popen(
            [str(self.executable), "--port", str(self.port)],
            env=environment,
            stdout=self._stdout,
            stderr=self._stderr,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
        )
        return self

    def wait_ready(self, timeout: float = 75) -> dict[str, Any]:
        if self.process is None:
            raise SidecarError("Sidecar has not been started")
        deadline = time.monotonic() + timeout
        last_error: Exception | None = None
        while time.monotonic() < deadline:
            code = self.process.poll()
            if code is not None:
                raise SidecarCrashed(
                    f"Sidecar exited during startup with code {code}: {self.read_stderr()}"
                )
            try:
                status, payload = request_json(f"{self.base_url}/health", timeout=0.5)
                if status == 200:
                    return payload
            except Exception as error:  # connection refusal/timeout is expected while starting
                last_error = error
            time.sleep(0.1)
        raise SidecarStartupTimeout(f"Sidecar readiness timed out: {last_error}")

    def wait_exit(self, timeout: float = 75) -> int:
        if self.process is None:
            raise SidecarError("Sidecar has not been started")
        return self.process.wait(timeout=timeout)

    def graceful_stop(self, timeout: float = 20) -> int:
        if self.process is None:
            return 0
        if self.process.poll() is None:
            self.process.send_signal(signal.CTRL_BREAK_EVENT)
            try:
                self.process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                self.force_stop()
        code = int(self.process.returncode or 0)
        self.close_logs()
        return code

    def force_stop(self) -> None:
        if self.process is None or self.process.poll() is not None:
            self.close_logs()
            return
        subprocess.run(
            ["taskkill", "/PID", str(self.process.pid), "/T", "/F"],
            capture_output=True,
            check=False,
            timeout=20,
        )
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        self.close_logs()

    def read_stdout(self) -> str:
        if self._stdout is not None and not self._stdout.closed:
            self._stdout.flush()
        return self.stdout_path.read_text(encoding="utf-8", errors="replace") if self.stdout_path.exists() else ""

    def read_stderr(self) -> str:
        if self._stderr is not None and not self._stderr.closed:
            self._stderr.flush()
        return self.stderr_path.read_text(encoding="utf-8", errors="replace") if self.stderr_path.exists() else ""

    def close_logs(self) -> None:
        for handle_name in ("_stdout", "_stderr"):
            handle = getattr(self, handle_name)
            if handle is not None and not handle.closed:
                handle.close()

    def __enter__(self) -> "SidecarProcess":
        return self.start()

    def __exit__(self, _type, _value, _traceback) -> None:
        self.force_stop()


def authenticated_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
