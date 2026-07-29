# Desktop sidecar runtime

## Decision

`DESKTOP_RUNTIME_EXPERIMENTAL`. Tauri v2 supervisor, PyInstaller sidecar
artifacts, loopback binding, Job Object ownership, data-root locking, and
Windows lifecycle contracts exist. Clean-machine packaged execution outside the
source tree remains unverified, so desktop readiness is not claimed.

## Required lifecycle

`START_SIDECAR → VERIFY_PROCESS_ALIVE → POLL_READINESS → ESTABLISH_PER_LAUNCH_AUTHENTICATION → ENABLE_WEBVIEW → MONITOR_PROCESS → TERMINATE_ON_TAURI_EXIT`.

The sidecar binds only to `127.0.0.1`, uses a dynamic/reserved port, receives a
per-launch secret that is never logged or passed through React, and stops
readiness polling on process exit. Tauri owns the child process tree and must
perform bounded graceful shutdown then forced cleanup; orphan processes are a
release failure.

Desktop data is an explicit user-data database, never `backend/attendance.db`.
It may bootstrap a fresh database, validate S4.3, and reject outdated existing
schemas without silent migration. A ready classification requires an onedir
packaged build, packaged startup/login/import/report smoke, resource checks,
clean shutdown, and clean-machine execution without developer environment
fallbacks. Onefile is not recommended until onedir evidence exists.
