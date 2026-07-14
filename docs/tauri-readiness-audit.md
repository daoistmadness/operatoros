# Tauri Desktop Readiness Audit

- Audit date: 2026-07-14
- Scope: current React/Vite frontend, FastAPI backend, local launcher, database, backup/restore, and process assumptions
- Result: conditionally ready for architecture validation; not ready to install Tauri

## Executive summary

The application has a useful desktop seam already: API calls use canonical `/api/...` routes and `frontend/src/lib/api/client.js` accepts a runtime `window.__APP_CONFIG__.apiBaseUrl`. The browser launcher is also independently hardened and tested. Desktop work remains blocked on five high-risk contracts: cookie/origin behavior, stable data paths, coordinated restore/restart, sidecar packaging, and single-instance ownership.

## Findings

| Area | Evidence | Classification | Required action |
| --- | --- | --- | --- |
| API discovery | `frontend/src/lib/api/client.js` prioritizes runtime `window.__APP_CONFIG__.apiBaseUrl`; Vite otherwise uses same-origin proxying. | Ready with validation | Preserve canonical paths; inject an absolute loopback URL before React initializes. Add tests for runtime configuration and dynamic ports. |
| Hardcoded hosts/ports | Local defaults occur in `start-dev.sh`, `frontend/vite.config.js`, CORS defaults, and operator docs. Feature API wrappers do not need a fixed backend domain. | Desktop-sensitive | Keep local-dev defaults separate. Tauri must allocate a loopback port and provide explicit allowed origins. |
| Authentication | Fetch uses `credentials: include`; backend uses HttpOnly cookie sessions. CORS currently enumerates browser dev origins. | High risk | Prototype Tauri custom-protocol-to-loopback cookies. Verify origin, path, SameSite, Secure, dynamic-port persistence, logout, and CORS before implementation. |
| Browser globals | React mounting and the API client use `window`, `document`, `fetch`, `FormData`, `Blob`, timers, and events. | Reusable in WebView | No rewrite is needed, but initialization order must guarantee runtime config exists before module evaluation. |
| Routing/refresh | `App.js` uses `BrowserRouter`; production Nginx owns browser fallback behavior. | Desktop-sensitive | Test deep links, refresh, startup route restoration, and Tauri custom-protocol history fallback. Change router strategy only if the prototype proves it necessary. |
| Downloads | Exports use blobs, `URL.createObjectURL`, and temporary anchor downloads. | Desktop-sensitive | Keep browser behavior. Define desktop destinations and later add narrowly scoped native save/folder dialogs; revoke object URLs consistently. |
| External links | Browser navigation assumptions need an explicit desktop policy. | Incomplete | Inventory link targets during Phase 11.4 and open approved external URLs outside the WebView with allowlisted schemes. |
| SQLite path | Local launcher uses `backend/.local-dev/astryx-development.db`; general settings can resolve relative SQLite URLs. | High risk | Tauri passes an absolute database URL under OS app data. Never write beside the executable or depend on process working directory. |
| Backup path | `BACKUP_DIR` defaults to `./backups/`; legacy `scripts/backup.sh` searches repository-relative SQLite locations. | High risk | Desktop passes an absolute app-data backup directory and uses the in-application backup service. Treat legacy shell scripts as server/operator tooling, not bundled desktop behavior. |
| Restore lifecycle | Restore can replace the active SQLite database and requires single-worker behavior. | High risk | Specify maintenance mode, scheduler stop, mutation blocking, engine disposal, atomic restore, sidecar restart, and post-restore health verification. |
| Scheduler/workers | Configuration exposes `BACKEND_WORKERS`; backup/restore assumes a single process and the local launcher uses one Uvicorn reloader process group. | Desktop-sensitive | Enforce one desktop worker and one scheduler owner. Production desktop must not use `--reload`. |
| Process lifecycle | `start-dev.sh` now performs preflight, readiness checks, process-group cleanup, unexpected-exit detection, and logs. | Reusable concept | Implement equivalent native child supervision in Rust; do not invoke the development launcher from Tauri. |
| Health | FastAPI exposes `/health`; the launcher already polls it. | Reusable | Define whether database/migrations/scheduler are included in desktop readiness and add degraded-state semantics. |
| Duplicate instances | No desktop application lock exists. | High risk | Use Tauri single-instance behavior plus a sidecar/database lock; second launch focuses the first window. |
| Sidecar binary | Backend currently requires the repository Python environment and filesystem resources. | High risk | Spike PyInstaller and Nuitka on Windows x86_64; verify imports, migrations, reports, SQLite, backups, logs, and cold start. |
| Mutable resources | Migration SQL and generated reports depend on resource/path discovery. | Desktop-sensitive | Inventory bundled read-only resources separately from mutable app data and resolve both from explicit launcher-provided paths. |
| PostgreSQL | PostgreSQL URL construction and Docker mode are supported. | Explicit boundary | Desktop v1 supports SQLite only. Keep PostgreSQL for browser/server and Docker deployments; do not bundle it. |
| Security surface | Tauri capabilities, CSP, filesystem scopes, and sidecar command scopes do not yet exist. | Not started by design | Create them only after the architecture gates pass; start with no general shell or unrestricted filesystem permission. |

## Local launcher closure

`start-dev.sh` covers the Phase 9.2 contract: Node/npm and dependency validation, Vite detection, Python/import validation, port checks, service readiness, ready-after-health output, signal cleanup, process-group termination, unexpected-exit detection, `--check`, and `--help`.

`backend/tests/test_dev_launcher.py` exercises missing Vite, both port conflicts, healthy readiness plus Ctrl+C, backend and frontend startup failure, Ctrl+C during startup, unexpected frontend exit, port release, and persistent local configuration. The normal launcher also displays recent service logs on failure.

## Required work before Phase 11

1. Approve `docs/adr/tauri-desktop-architecture.md`.
2. Run a Windows x86_64 packaging spike for PyInstaller and Nuitka and record the decision.
3. Build a minimal cookie/origin prototype using the intended Tauri custom protocol and a dynamic loopback port.
4. Define the Rust-to-sidecar configuration schema, including absolute data, backup, log, and runtime paths.
5. Specify restore maintenance/restart behavior and prove SQLAlchemy connections close safely.
6. Specify Tauri single-instance behavior and a defense-in-depth sidecar/database lock.
7. Define production health/degraded semantics and bounded startup/shutdown timeouts.

## Deferred intentionally

No Tauri dependency, Rust project, plugin, capability, installer, or desktop-only UI is added by this audit. The Grade Matrix and browser/Docker deployment behavior are outside this phase.
