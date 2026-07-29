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

## Database path contract

Runtime paths are classified as `PROTECTED_REPOSITORY_OPERATIONAL`,
`DEVELOPMENT_TEMPORARY`, `TEST_TEMPORARY`, `DESKTOP_USER_DATA`, or
`ROLLBACK_BACKUP`. Only an explicit `DESKTOP_USER_DATA` path may be used by a
packaged writable runtime. Rollback backups are restore inputs, never live
runtime databases.

Tauri must resolve and pass an absolute database path beneath its application
data directory. Conceptually this is the Tauri application-data directory on
Windows, the XDG application-data directory on Linux, and Application Support
on macOS. The sidecar must not derive a packaged database from its working
directory or fall back to a repository path. Final cross-platform Tauri path
bridging remains part of the separate packaged-sidecar milestone.
