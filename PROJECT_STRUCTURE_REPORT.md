# OperatorOS Phase 11.1 Project Structure Audit

Audit date: 2026-07-15
Scope: repository evidence only; no implementation changes

## Current structure

| Area | Evidence | Current purpose | Phase 11.1 impact |
|---|---|---|---|
| `frontend/` | `package.json`, `vite.config.js`, `src/`, `src-tauri/` | React/Vite UI plus the current Tauri shell | Correct location, but desktop packaging and supervision remain incomplete. |
| `frontend/src/` | `App.js`, `api/`, `lib/api/client.js`, `context/`, `components/auth/` | Browser routes, API wrappers, query state, setup and authentication boundaries | API abstraction is sidecar-compatible once runtime endpoint injection is implemented. |
| `backend/` | `requirements.txt`, `src/main.py`, `src/core/`, `src/api/`, `src/services/`, `migrations/` | FastAPI service, SQLAlchemy persistence, authentication, reports, backup/restore | Application can be embedded, but migration and runtime-path bootstrapping need a production entry point. |
| `frontend/src-tauri/` | `Cargo.toml`, `tauri.conf.json`, `src/main.rs`, `src/lib.rs`, `capabilities/default.json` | Minimal Tauri v2 window shell | No sidecar resource, spawn/readiness/shutdown code, runtime config injection, or active bundle. |
| `desktop-spike/` | `backend_entry.py`, `supervisor.py`, PyInstaller spec/build script | Experimental Windows sidecar and lifecycle feasibility work | Useful reference only; its README explicitly excludes it from production deployment. |
| `tests/desktop/` | lifecycle, process-ownership, harness tests | Windows-only executable contract tests | Strong acceptance-test foundation, but not connected to a production Tauri implementation. |
| `scripts/` | development launch, backup, restore, browser verification | Developer and operational utilities | Shell scripts are not Windows packaged-runtime entry points. |
| `docs/desktop/`, `docs/tauri/` | architecture and validation records | Prior design/audit evidence | Valuable context, but documentation is not executable readiness. |

## Routing and communication structure

`frontend/src/App.js` uses `BrowserRouter`, a setup boundary, an authentication provider, protected nested routes, and an admin role guard. API calls converge on `frontend/src/lib/api/client.js`. Canonical frontend paths use `/api/<domain>/...`; `backend/src/main.py` registers those prefixes and retains only limited legacy aliases.

## Missing production components

1. A production-named `operatoros-sidecar.exe` build target.
2. A complete migration/resource manifest for a fresh and upgraded desktop database.
3. Tauri sidecar resource configuration and an active Windows bundle.
4. Rust ownership of sidecar start, readiness, process-tree termination, and crash handling (process ownership only, not business/auth logic).
5. A supported runtime API endpoint handoff to the already-built React application.
6. OperatorOS-named AppData paths, persistent logs, exports, and secrets.
7. Installer/build automation and clean Windows 11 x64 release evidence.

## Readiness conclusion

The repository has a production-capable web application and a substantial desktop feasibility prototype, but Phase 11.1 is not production-ready. The structure supports incremental integration without redesigning the architecture.
