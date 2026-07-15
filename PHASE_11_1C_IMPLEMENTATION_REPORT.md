# Phase 11.1C — Tauri v2 Sidecar Process Manager Report

- Date: 2026-07-15
- Status: **Implemented; ready for Phase 11.1D packaged validation**

## 1. Implementation summary

OperatorOS now has a Tauri v2 process manager that resolves the production sidecar, prepares the frozen AppData tree, writes a secret-free `runtime.json`, allocates a dynamic loopback port, launches `operatoros-sidecar.exe`, assigns it to a kill-on-close Windows Job Object, validates `/health`, and creates the WebView only after `READY`.

The WebView loads the sidecar-served React application at the verified same-origin loopback URL. Tauri injects immutable `window.__OPERATOROS_RUNTIME__` and compatibility `window.__APP_CONFIG__` objects before page scripts execute. No renderer process or shell API was exposed.

## 2. Files changed

- `frontend/src-tauri/Cargo.toml`, `Cargo.lock`: OperatorOS crate naming and minimal serde/url/Windows API dependencies.
- `frontend/src-tauri/tauri.conf.json`: OperatorOS metadata, sidecar resource, active bundle, no eager window, and explicit CSP.
- `frontend/src-tauri/src/lib.rs`, `main.rs`: readiness-gated application/window lifecycle.
- `frontend/src-tauri/src/sidecar/mod.rs`
- `frontend/src-tauri/src/sidecar/manager.rs`
- `frontend/src-tauri/src/sidecar/process.rs`
- `frontend/src-tauri/src/sidecar/health.rs`
- `frontend/src-tauri/src/sidecar/lifecycle.rs`
- `frontend/src-tauri/src/sidecar/job_object.rs`
- `frontend/src-tauri/src/sidecar/instance_lock.rs`
- `frontend/src-tauri/resources/operatoros-sidecar.exe`: bundled sidecar resource.
- `frontend/src-tauri/output/operatoros-desktop.exe`: verified release desktop executable.

No FastAPI business, authentication, authorization, database, or migration logic was moved into Rust.

## 3. Lifecycle and state machine

Startup follows `STOPPED -> STARTING -> READY`; invalid resource, spawn failure, child exit, health mismatch, and timeout produce `FAILED`. A monitor transitions an unexpectedly exited ready child to `CRASHED` without an automatic restart loop. Shutdown follows `READY/FAILED/CRASHED -> STOPPING -> STOPPED`.

Tauri acquires `Local\OperatorOSDesktopSingleInstance`, creates the five `%LOCALAPPDATA%\OperatorOS` directories, writes runtime metadata, spawns one process group, verifies health status/service/version, then creates the main WebView. Normal exit sends `CTRL_BREAK_EVENT`, waits 20 seconds, and force-terminates only as fallback.

## 4. Windows Job Object

Rust creates a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` and assigns the sidecar immediately after spawn. Assignment failure kills the child and fails startup. When Tauri crashes, Windows closes the job handle and terminates the PyInstaller process tree. The sidecar retains its independent data-root lock as defense in depth.

## 5. Tests and evidence

| Check | Result |
|---|---|
| `cargo check` | Passed |
| Rust unit tests | **5 passed**: transitions, secret-free runtime JSON, dynamic port, unavailable-health timeout, invalid executable |
| Windows release build | Passed in 5m 03s |
| Live normal window-close test | Passed; health ready, FastAPI stopped, port released |
| Live forced-parent crash test | Passed; Job Object removed sidecar, no orphan, port released |
| Backend regression suite | **303 passed**, 4,250 existing warnings |

The live run used a disposable `LOCALAPPDATA` root and the independently built Phase 11.1B sidecar. It created the contracted database/runtime files and returned the matching health version before showing the application.

## 6. Security review

Authentication remains React → HttpOnly `SameSite=Lax` cookie → FastAPI session → database. Rust contains no login, password, cookie/session parsing, authorization, SQL, or database dependency. `runtime.json` contains only port, data/log/runtime paths, and version. Runtime injection contains only API origin, port, and version. No browser-storage token or default credential was added.

## 7. Known limitations

1. Installer-level resource resolution has been configured and compile-checked, but MSI/NSIS installation on a clean Windows profile belongs to Phase 11.1D.
2. The reserve-to-bind port race is bounded operationally by child/health failure but does not yet use socket inheritance; Phase 11.1D must stress occupied/racing ports.
3. The current single-instance behavior rejects the second process; focus-forwarding is not implemented.
4. `CRASHED` state is recorded internally; a dedicated recovery screen with Retry/Open Logs is deferred.
5. WebView2 login/session persistence is structurally same-origin and covered by existing backend authentication tests, but full UI-driven packaged authentication/restore testing remains a Phase 11.1D gate.
6. Code signing, installer signing, SBOM, updater behavior, and SmartScreen/antivirus validation remain outstanding.
7. The historical migration-ledger limitation from Phase 11.1B remains a release blocker.

## 8. Phase 11.1D readiness

The process-manager foundation is ready for packaged runtime validation. Phase 11.1D should build an installer, validate packaged resource paths, drive first-admin/login/session restart/logout/restore in WebView2, test invalid resources and startup timeouts at executable level, stress port races and sleep/resume, verify second-instance behavior, inspect filesystem/ACL/CSP behavior, and repeat normal/crash cleanup on a clean Windows 11 x64 VM.
