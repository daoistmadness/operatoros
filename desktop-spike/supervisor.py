"""Tauri-free lifecycle prototype for an AstryxBackend executable."""

from __future__ import annotations

import argparse
import signal
import socket
import subprocess
import time
import urllib.request
from pathlib import Path


def available_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def wait_ready(process: subprocess.Popen, port: int, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Backend exited during startup with code {process.returncode}")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=0.5) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(0.1)
    raise TimeoutError("Backend readiness timed out")


def stop(process: subprocess.Popen, timeout: float) -> None:
    if process.poll() is not None:
        return
    process.send_signal(signal.CTRL_BREAK_EVENT)
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        # A PyInstaller one-file executable has a bootloader parent and an
        # extracted child. Killing only the parent can orphan the API process.
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            check=False,
            capture_output=True,
        )
        process.wait(timeout=5)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("executable", type=Path)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--startup-timeout", type=float, default=30)
    parser.add_argument("--shutdown-timeout", type=float, default=15)
    args = parser.parse_args()
    port = available_port()
    environment = __import__("os").environ.copy()
    environment["ASTRYX_DATA_ROOT"] = str(args.data_root.resolve())
    process = subprocess.Popen(
        [str(args.executable.resolve()), "--port", str(port)],
        env=environment,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )
    try:
        wait_ready(process, port, args.startup_timeout)
        print(f"READY http://127.0.0.1:{port}", flush=True)
        input("Press Enter to request graceful shutdown...\n")
        return 0
    finally:
        stop(process, args.shutdown_timeout)


if __name__ == "__main__":
    raise SystemExit(main())
