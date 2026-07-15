# Clean Windows Validation Runbook

## Acceptance environment

Use a disposable Windows 10/11 x64 VM with no Python, Rust, compiler, repository checkout, or developer virtual environment. Record the Windows edition/build and confirm these commands return no executable:

```powershell
Get-Command python, py, rustc, cargo, cl -ErrorAction SilentlyContinue
```

Copy only the release-candidate `AstryxBackend.exe`, the desktop supervisor executable, and the validation script/checksum manifest. Do not copy source or a virtual environment.

## Disposable configuration

```powershell
$root = Join-Path $env:TEMP "Astryx-Clean-Validation"
$env:ASTRYX_DATA_ROOT = $root
$env:ASTRYX_SIDECAR_EXECUTABLE = (Resolve-Path .\AstryxBackend.exe)
$env:ASTRYX_SIDECAR_PORT = "18080"
$env:ASTRYX_SETUP_TOKEN = [guid]::NewGuid().ToString("N")
```

Start the desktop supervisor and retain its PID. Confirm `/health`, the AppData-compatible directory structure, the SQLite database, identity/setup/operational tables, and `PRAGMA integrity_check = ok`. Through the application, provision one disposable administrator, log in, call an authenticated endpoint, create a backup, restore it, and confirm reauthentication.

## Lifecycle acceptance

1. Close the application normally; confirm Uvicorn reports application shutdown and port 18080 can be rebound.
2. Restart and confirm the same generated authentication secret and administrator persist.
3. Force only the supervisor parent PID with `taskkill /PID <pid> /F` (do not use `/T`).
4. Confirm no `AstryxBackend.exe` remains and port 18080 is released.
5. Run SQLite `PRAGMA integrity_check`, restart the supervisor, and confirm `/health` and authenticated operation.
6. While instance A is ready, start instance B. Confirm B exits, no second sidecar/scheduler starts, and A remains healthy.

## Evidence to retain

Retain machine metadata, artifact SHA-256 values, timestamped stdout/stderr, health/API results, process listings before and after forced parent termination, port checks, database integrity output, and screenshots of setup/login/backup/restore. Remove the disposable root and credentials after review.

## Current result

Not executed as of 2026-07-14 because no clean Windows VM is available on the development host. Phase 9.6 must remain externally pending until this runbook passes.
