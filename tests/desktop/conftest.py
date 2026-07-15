from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EXECUTABLE = REPOSITORY_ROOT / "dist" / "operatoros-sidecar.exe"
DEFAULT_SUPERVISOR = REPOSITORY_ROOT / "frontend" / "src-tauri" / "output" / "astryx-desktop.exe"


def pytest_collection_modifyitems(config, items):
    for item in items:
        if item.path.parent == Path(__file__).parent:
            item.add_marker(pytest.mark.desktop)


@pytest.fixture(scope="session")
def sidecar_executable() -> Path:
    if sys.platform != "win32":
        pytest.skip("Packaged desktop sidecar contracts run on Windows only")
    configured = os.environ.get("OPERATOROS_SIDECAR_EXECUTABLE")
    executable = Path(configured).resolve() if configured else DEFAULT_EXECUTABLE.resolve()
    if not executable.is_file():
        pytest.skip(
            "Packaged sidecar is unavailable; build it or set OPERATOROS_SIDECAR_EXECUTABLE"
        )
    return executable


@pytest.fixture(scope="session")
def desktop_supervisor_executable() -> Path:
    if sys.platform != "win32":
        pytest.skip("Windows Job Object contracts run on Windows only")
    configured = os.environ.get("ASTRYX_DESKTOP_SUPERVISOR_EXECUTABLE")
    executable = Path(configured).resolve() if configured else DEFAULT_SUPERVISOR.resolve()
    if not executable.is_file():
        pytest.skip(
            "Desktop supervisor is unavailable; build frontend/src-tauri or set "
            "ASTRYX_DESKTOP_SUPERVISOR_EXECUTABLE"
        )
    return executable
