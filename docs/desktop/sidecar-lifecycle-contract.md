# Sidecar Lifecycle Contract

## Purpose

Phase 9.6.1 establishes an executable-level Windows contract for the packaged FastAPI sidecar. The permanent suite is under `tests/desktop/` and tests the ignored local PyInstaller artifact rather than importing the backend in-process.

## Lifecycle

```text
configuration validation
        |
        v
packaged process start -> readiness polling -> authenticated operation
        |                       |                       |
        |                       |                       +-> backup / live restore
        |                       +-> crash or timeout classified separately
        v
graceful CTRL_BREAK -> process-tree fallback if needed -> port released -> restart
```

The harness gives every run a disposable absolute data root, database path, backup directory, secret path, and free loopback port. It retains stdout/stderr in the temporary run directory when assertions fail.

## Contract matrix

| Area | Permanent assertion |
| --- | --- |
| Startup and health | Packaged executable becomes ready on `/health`; startup crash and readiness timeout are distinct failures. |
| Configuration | Invalid secret and invalid/uncreatable data root fail closed with non-zero exit and diagnostic output. |
| Database | Fresh absolute SQLite path is initialized, required migrations/tables exist, and `PRAGMA integrity_check` is `ok`. |
| Authentication | First administrator setup, Argon2-backed login, protected endpoint access, logout invalidation, and restart persistence work. |
| Backup and restore | Manual backup metadata and SQLite integrity are valid; live restore completes on Windows and requires reauthentication. |
| Graceful shutdown | CTRL_BREAK reaches Uvicorn's `Application shutdown complete`; PyInstaller may report Windows exit code 3 for this handled console event. |
| Forced crash | Explicit process-tree termination releases the port, preserves database integrity, and permits a healthy restart. |
| Occupied port | Startup fails non-zero with a Windows bind diagnostic. |
| Multiple instances | A second process using the same canonical data root exits before database initialization, even when it requests a different port. |
| Parent process ownership | The optional Tauri supervisor contract force-kills only the desktop parent and verifies Job Object descendant cleanup, port release, integrity, and restart. |

## Running the suite

From Windows PowerShell at the repository root:

```powershell
$env:ASTRYX_SIDECAR_EXECUTABLE = "C:\path\to\AstryxBackend.exe"
python -m pytest -c tests/desktop/pytest.ini tests/desktop -q
```

If the environment variable is omitted, the harness uses `desktop-spike/output/pyinstaller/AstryxBackend.exe`. The module is skipped on non-Windows systems because CTRL_BREAK, Windows process-tree behavior, and packaged `.exe` behavior are the contract under test.

## Latest verified result

The previous 2026-07-14 baseline was **7 passed and 1 strict xfailed**. The implementation replaced that expected failure with a passing canonical data-root lock contract and added a Tauri-parent Job Object crash/restart contract. The final release-acceptance run passed **9 tests in 300.52 seconds**, with no xfail.

## Deferred ownership

The suite does not cover installer behavior or full desktop UI. It now exercises the minimal Tauri/Rust supervisor and its kill-on-close Job Object plus the sidecar data-root lock. Clean-machine execution without Python remains a separate Phase 9.6 closure gate.
