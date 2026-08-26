import os
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "scripts" / "validate-wsl-bun.sh"


def _write_executable(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
    path.chmod(0o755)


def _toolchain_fixture(
    tmp_path: Path,
    *,
    bun_version: str = "1.4.0",
    bun_usable: bool = True,
):
    tools = tmp_path / "tools"
    tools.mkdir()
    bun_exit = "0" if bun_usable else "3"
    _write_executable(
        tools / "bun",
        f"#!/bin/sh\n"
        f"if [ \"${{1:-}}\" = \"--version\" ]; then echo {bun_version}; exit {bun_exit}; fi\n"
        "exit 1\n",
    )
    environment = os.environ.copy()
    environment["PATH"] = f"{tools}:{environment['PATH']}"
    return environment, tools


def _run_helper(environment: dict[str, str], script: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", "-c", f"source {HELPER}; {script}"],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


def test_linux_bun_passes(tmp_path: Path):
    environment, _ = _toolchain_fixture(tmp_path, bun_version="1.4.0")
    result = _run_helper(environment, 'operatoros_wsl_validate_bun "$PWD"')
    assert result.returncode == 0, result.stderr


def test_direct_probe_entrypoint_reports_valid_linux_bun(tmp_path: Path):
    environment, _ = _toolchain_fixture(tmp_path, bun_version="1.4.0")
    result = subprocess.run(
        ["bash", str(HELPER), "--probe", str(ROOT)],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "WSL Bun probe: PASS" in result.stdout
    assert "bun version: 1.4.0" in result.stdout


def test_missing_bun_reports_missing(tmp_path: Path):
    environment = os.environ.copy()
    environment["PATH"] = "/usr/bin:/bin"
    result = _run_helper(environment, 'operatoros_wsl_validate_bun "$PWD" || echo "STATE=$OPERATOROS_WSL_TOOLCHAIN_STATE REASON=$OPERATOROS_WSL_TOOLCHAIN_REASON"')
    assert result.returncode == 0
    assert "MISSING" in result.stdout


def test_older_bun_version_is_rejected(tmp_path: Path):
    environment, _ = _toolchain_fixture(tmp_path, bun_version="1.3.14")
    result = _run_helper(environment, 'operatoros_wsl_validate_bun "$PWD" || echo "STATE=$OPERATOROS_WSL_TOOLCHAIN_STATE REASON=$OPERATOROS_WSL_TOOLCHAIN_REASON"')
    assert result.returncode == 0
    assert "SAFE_WRONG_VERSION" in result.stdout
    assert "1.4.x" in result.stdout


@pytest.mark.parametrize(
    "rejected_path",
    [
        "/mnt/c/Users/OperatorOS/bin/bun",
        "/mnt/c/Program Files/bun/bun.exe",
        "/home/operator/tools/bun.exe",
        "/home/operator/tools/bun.cmd",
        "/run/desktop/mnt/host/c/bun",
    ],
)
def test_windows_bun_paths_are_rejected(tmp_path: Path, rejected_path: str):
    environment, tools = _toolchain_fixture(tmp_path)
    result = _run_helper(environment, f'operatoros_wsl_path_is_rejected "{rejected_path}"')
    assert result.returncode == 0


def test_obsolete_package_lock_fails_validation(tmp_path: Path):
    environment, _ = _toolchain_fixture(tmp_path)
    pkg_lock = ROOT / "frontend" / "package-lock.json"
    pkg_lock.write_text("{}", encoding="utf-8")
    try:
        result = _run_helper(environment, 'operatoros_wsl_validate_bun "$PWD"')
        assert result.returncode != 0
    finally:
        pkg_lock.unlink(missing_ok=True)


def test_missing_bun_lock_fails_validation(tmp_path: Path):
    environment, _ = _toolchain_fixture(tmp_path)
    bun_lock = ROOT / "frontend" / "bun.lock"
    content = bun_lock.read_text(encoding="utf-8")
    bun_lock.unlink()
    try:
        result = _run_helper(environment, 'operatoros_wsl_validate_bun "$PWD"')
        assert result.returncode != 0
    finally:
        bun_lock.write_text(content, encoding="utf-8")


def test_prepare_bun_exports_path(tmp_path: Path):
    environment, tools = _toolchain_fixture(tmp_path)
    result = _run_helper(environment, 'operatoros_wsl_prepare_bun "$PWD" && echo "PATH_OK=$OPERATOROS_BUN_BIN"')
    assert result.returncode == 0, result.stdout + result.stderr
    assert "PATH_OK=" in result.stdout
