# Tauri v2 Architecture Proposal

Status: proposed Phase 11 blueprint. Initial target: Windows x86_64.

## Decision

Use Tauri v2 as shell, the existing React/Vite UI, a packaged FastAPI external-binary sidecar for all business behavior, and SQLite under OS application data. Browser/Docker remain supported; PostgreSQL is not bundled.

```text
Tauri host (single instance, least privilege)
  -> one FastAPI sidecar at 127.0.0.1:<ephemeral>
       -> serves React assets and canonical /api on one origin
       -> owns auth, validation, reports, backups, scheduler, business logic
       -> owns %LOCALAPPDATA%/Astryx/data/astryx.sqlite3
```

Same-origin loopback is preferred because it preserves HttpOnly `SameSite=Lax` cookies. A custom-origin frontend with an absolute runtime API URL is a fallback only after an executable cookie/CORS prototype succeeds.

| Concern | Owner |
| --- | --- |
| Window, single instance, OS paths/dialogs, child supervision | Tauri/Rust |
| Authentication, authorization, APIs, reports, backup/restore, scheduler | FastAPI |
| UI, queries, charts, route guards | React |
| Durable transactions | SQLite through the sidecar only |

## Startup

1. Acquire application/data locks.
2. Resolve protected directories and secrets.
3. Select an ephemeral loopback port and nonce.
4. Start the signed/allowlisted one-worker sidecar with absolute configuration.
5. Sidecar validates/migrates data, starts one scheduler, and reports readiness.
6. Verify child identity/readiness within a timeout.
7. Open the local origin; React checks setup and `/api/auth/me`.
8. Failure shows Retry, Open Logs, and Exit without duplicating children.

Closing enters `STOPPING`, blocks duplicate commands, drains mutations/jobs, invokes lifespan shutdown, waits, and terminates the process tree if necessary. Unexpected exit shows recovery UI. Restore always restarts the sidecar and reloads the WebView. A second launch focuses the first window.

## Security constraints

Loopback-only binding; no general shell; no arbitrary process/path/URL commands; no remote WebView content; strict CSP/navigation/exact-origin policy; current-user-only ACLs; redacted logs; secret outside the bundle; protected first-admin setup; backend enforcement for all privileged actions.

## Architecture gates

1. Prove same-origin assets/APIs and BrowserRouter routes.
2. Prove WebView2 cookie lifecycle; if custom origin is tested, prove CORS without weakening security.
3. Select PyInstaller or Nuitka through a clean-machine spike.
4. Version the launcher/sidecar configuration and nonce handshake.
5. Prove graceful/forced shutdown, no orphan, one scheduler, one SQLite owner.
6. Prove restore maintenance, rollback, restart, and reauthentication.
7. Approve capabilities, CSP/navigation, logs, and retention.

## Phase 11 implementation plan

### 11.0 — Architecture spikes

Build disposable origin/cookie prototypes; spike both Python packagers; freeze configuration, state machine, paths, and failure semantics.

Exit: evidence closes all architecture gates and the ADR is approved.

### 11.1 — Minimal skeleton

Initialize Tauri v2/Rust, local React assets, strict CSP/navigation, and single-instance behavior. Add no broad plugins or production installer.

Exit: offline window loads with no remote asset/request.

### 11.2 — Sidecar lifecycle

Package Python; implement port/nonce handshake, readiness, logs, crash recovery, graceful shutdown, and orphan tests; pass only validated absolute paths and one-worker settings.

Exit: repeated lifecycle/crash tests leave one scheduler, no orphan, and no conflict.

### 11.3 — Authentication and data

Validate setup/login/session/logout/expiry in WebView2; move new SQLite data to app data; add migration/recovery tests; preserve browser/Docker configuration.

Exit: clean install, upgrade, restart, first setup, and corruption recovery pass.

### 11.4 — Native workflows

Add scoped save/open and clipboard-write capabilities; implement restore/restart UX; verify reports, imports, exports, and backups.

Exit: browser parity with no unrestricted path/shell capability.

### 11.5 — Release hardening

Run clean-VM tests, SBOM/scans, signing preparation, accessibility/performance, and data-preserving update/uninstall tests. Auto-update and public distribution need separate approval.

Exit: release-candidate evidence and go/no-go review.
