# ADR: Tauri v2 Desktop Architecture

- Status: Proposed; approval gate for Phase 11
- Date: 2026-07-14
- Initial target: Windows x86_64

## Context

OperatorOS is a React/Vite application backed by FastAPI, SQLAlchemy, a single-process backup scheduler, reports, audit records, and cookie sessions. Browser and Docker deployments must remain supported. Rewriting stable backend behavior in Rust would duplicate business rules and increase migration risk.

## Decision

Use Tauri v2 with the existing React/Vite frontend and package FastAPI as a local external-binary sidecar. Desktop mode uses SQLite in the operating-system application-data directory. PostgreSQL remains a server/container option and will not be bundled.

The browser build remains same-origin and keeps canonical `/api/<domain>/...` paths. In desktop mode, the launcher injects this configuration before React starts:

```js
window.__APP_CONFIG__ = { apiBaseUrl: "http://127.0.0.1:<port>" };
```

The existing API client already reads this value before `VITE_API_BASE_URL`.

## Process topology

```text
Tauri main process
  -> acquires the single-instance lock
  -> resolves and validates application directories
  -> allocates a loopback port
  -> starts the bundled FastAPI sidecar
  -> polls GET /health until ready
  -> injects the runtime API URL and opens the main window
  -> monitors the child and stops it during application exit
```

The sidecar binds only to `127.0.0.1`, uses one backend worker, and receives configuration through validated arguments or environment variables owned by the Rust launcher. The WebView must not receive general shell access.

## Runtime contracts

### Port and readiness

Tauri reserves an ephemeral TCP port on `127.0.0.1` and passes it to the sidecar. The implementation must close the allocation race or retry safely if binding loses the race. Fixed public ports are not used. Readiness is a successful `/health` response within a bounded timeout; process exit always takes precedence over timeout.

Sidecar states are `STARTING`, `READY`, `DEGRADED`, `FAILED`, `STOPPING`, and `STOPPED`. A crash after readiness moves the desktop shell to a recovery screen offering Retry, Open Logs, and Exit. Retry must not create two schedulers or sidecars.

### Single instance and shutdown

Tauri owns the application-level single-instance lock. A second launch focuses the existing window. The sidecar is always a child of the owning Tauri process and also acquires a runtime/database lock as defense in depth. Normal shutdown asks the sidecar to stop accepting mutations, waits for bounded graceful completion, then terminates the process tree. Forced shutdown and crash tests must prove that no child remains.

### Data locations

Mutable data must never live beside the installed executable:

```text
<OS app data>/Astryx/
  database/astryx.sqlite3
  backups/
  audit/
  logs/
  exports/
  runtime/
```

Tauri resolves the root and passes absolute paths for `DATABASE_URL`, `BACKUP_DIR`, logs, exports, and runtime files. Updates preserve this root. Uninstall removes application files but preserves user data by default; deleting data requires a separate explicit action.

### Authentication

Retain HttpOnly cookie sessions for the first desktop release. The WebView calls the loopback FastAPI origin with `credentials: include`. Before implementation approval, an executable prototype must verify cookie domain/path, `SameSite`, `Secure`, dynamic-port persistence, logout invalidation, CORS, and origin behavior under Tauri's custom protocol. The persistent session signing secret belongs in protected application data or an OS credential facility and must not appear in logs.

If the WebView origin cannot support the existing cookie contract safely, return to architecture review; do not weaken cookies, enable broad CORS, or adopt the localhost plugin by default.

### Backup, restore, and migration

Startup order is: resolve paths, lock instance, validate database, apply approved migrations, start the one scheduler, then report ready. Restore requires a coordinated maintenance state: stop the scheduler, reject new mutations, close SQLAlchemy connections, validate and replace the database, then restart the sidecar/application and verify health. Existing append-only audit and destructive-operation guards remain unchanged.

## Packaging decision gate

PyInstaller and Nuitka remain candidates. Select only after a Windows x86_64 spike measures executable size, cold start, hidden imports, migration/resource inclusion, SQLite behavior, reports, and backup/restore. End users must not need Python. No cross-platform claim is made until each target is built and tested.

## Security constraints

- Bind only to loopback; verify the API is unreachable from LAN interfaces.
- Allow only the bundled sidecar executable and validated arguments.
- Scope filesystem access to app data, temporary data, and user-selected export locations.
- Use a dedicated least-privilege capability for the main window and an explicit CSP.
- Keep remote WebView content disabled and do not expose a general shell command.
- Persist logs with rotation/size limits and redact secrets.

## Consequences

This approach preserves FastAPI routes, SQLAlchemy models, authentication, reporting, backup scheduling, audit behavior, and backend tests. It adds a Python-binary build pipeline, sidecar lifecycle code, dynamic-origin security validation, and desktop-specific recovery UX. Browser and Docker deployment remain independent and unchanged.

## Phase 11 entry criteria

Before Tauri is installed, approve this ADR and close the high-risk findings in `docs/tauri-readiness-audit.md`. In particular, complete the packaging spike, cookie-origin prototype, restore lifecycle design, path-injection contract, and single-instance/sidecar locking design.
