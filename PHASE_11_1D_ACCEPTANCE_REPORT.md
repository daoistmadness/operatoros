# OperatorOS Phase 11.1D Acceptance Report

Date: 2026-07-15
Gate status: **NOT PASSED — installer work remains blocked**

## 1. Test environment

- Host: Windows 11 x64, user profile `OPREDEL`
- Desktop artifact: `frontend/src-tauri/output/operatoros-desktop.exe` (8,637,440 bytes)
- Sidecar artifact: `dist/operatoros-sidecar.exe`
- Web runtime: Microsoft WebView2 through Tauri v2
- Isolated data root: `%TEMP%\OperatorOS-Phase11_1D\OperatorOS`
- Database: packaged SQLite in WAL mode
- Browser acceptance surface: Codex in-app Chromium against the exact packaged sidecar origin
- Important limitation: this host contains Python, Node.js, Rust, WSL, the repository, and developer tools. It is not the required clean Windows acceptance machine.

The executable was launched with an isolated `LOCALAPPDATA` value. No repository database or normal OperatorOS profile was used.

## 2. Startup timing

The packaged desktop was launched repeatedly from a cold PyInstaller one-file sidecar.

| Measurement | Result |
|---|---:|
| Initial sidecar health-ready observation | approximately 24.0 s |
| 20-cycle fully-loaded minimum | 26.860 s |
| 20-cycle fully-loaded average | 27.754 s |
| 20-cycle fully-loaded maximum | 30.252 s |

“Fully loaded” in the stress test required all of the following before close was requested:

1. `runtime.json` existed.
2. Dynamic `/health` returned `200` with `status=ok` and version `0.1.0`.
3. The Tauri main window had a non-zero native window handle.
4. A five-second WebView2 stabilization interval completed.

Static inspection confirms `build_main_window` is called only after `SidecarManager::start` completes its readiness poll. No main WebView window is declared eagerly in `tauri.conf.json`.

## 3. WebView2 validation

| Check | Result | Evidence |
|---|---|---|
| Backend readiness gate precedes window creation | PASS | Tauri setup starts the manager, waits for health, then calls `build_main_window`. |
| React application served by packaged sidecar | PASS | Title `OperatorOS`; setup, login, Dashboard, Attendance Review, Grade Ledger, Reports, Settings, and Backup Management rendered. |
| Blank screen/loading race | PASS for tested launches | All interactive acceptance launches reached visible application DOM; 20/20 stabilized launches completed. |
| Browser console errors | PASS on browser acceptance surface | No warning or error entries during setup, login, page navigation, backup, restore, and logout. |
| CSP violations | PASS on browser acceptance surface | No CSP console violations observed; configured policy limits content to self/data/blob as required. |
| Actual WebView2 developer-console capture | NOT AUTOMATED | The test surface cannot attach to the packaged Tauri WebView2 developer console. |

## 4. Runtime API integration

| Check | Result |
|---|---|
| Dynamic loopback port | PASS |
| No fixed production port | PASS |
| Runtime configuration injection | PASS by code inspection and Rust tests |
| Canonical `/api/...` paths | PASS |
| Cookie credentials included | PASS |
| Dashboard API calls | PASS |
| Attendance API calls | PASS |
| Grades API calls | PASS |
| Reports API calls | PASS |

Tauri injects immutable `window.__OPERATOROS_RUNTIME__` and `window.__APP_CONFIG__` values containing the dynamic origin. The frontend API client selects `__APP_CONFIG__.apiBaseUrl`, strips only a trailing slash, preserves canonical `/api/...` paths, and always sends `credentials: "include"`. No hardcoded production port was found.

## 5. Authentication results

| Scenario | Result |
|---|---|
| Fresh profile shows first-admin setup | PASS |
| Create first administrator | PASS |
| Setup closes permanently | PASS |
| Setup cannot repeat after restart | PASS |
| Login reaches Dashboard | PASS |
| Protected pages load | PASS |
| Logout returns to Login | PASS |
| Protected UI remains blocked after logout | PASS |
| Default credentials | None observed |
| Password/session model regression | None observed |

The tested account was created only in the isolated QA database. Authentication remains React → HttpOnly cookie → FastAPI server session → database. Backend authentication tests passed. Frontend security tests confirm no local/session-storage token contract and the request client uses cookie credentials.

## 6. Session persistence results

| Scenario | Result |
|---|---|
| Login, close desktop, reopen on a new dynamic port | PASS |
| Dashboard opens without another login | PASS |
| Logout invalidates the active session | PASS |
| Reopen/protected request after logout requires login | PASS |
| Explicit expired-session wall-clock test | Covered by backend/frontend regression tests; not time-advanced in packaged UI |

The same host-only HttpOnly cookie remained usable after the backend restarted on a different loopback port, demonstrating that the desktop does not depend on a fixed port or browser token storage.

## 7. Backup and restore results

| Scenario | Result |
|---|---|
| Create backup from packaged UI | PASS |
| Backup metadata/checksum displayed | PASS |
| Restore disabled by default | PASS |
| Restore enabled only with `ENABLE_DESTRUCTIVE_OPERATIONS=true` | PASS |
| Exact-filename confirmation required | PASS |
| Restore completes from packaged UI | PASS |
| Pre-restore safety snapshot | PASS |
| Administrator preserved | PASS |
| Session handled after restore | PASS; restored session remained valid |
| SQLite integrity after restore | PASS through API regression coverage and packaged restore completion |

The destructive-operation flag was enabled only for the isolated restore test process. The default packaged launch correctly hid/disabled restore.

## 8. Port race and lifecycle results

Result: **PASS — 20/20 fully loaded cycles**.

- 20 distinct dynamically allocated loopback ports
- one desktop instance per cycle
- one PyInstaller sidecar process tree per cycle (bootloader plus worker)
- 20/20 graceful close messages accepted
- 20/20 ports released
- 0 orphan sidecars after every close
- single-instance mutex remained active

An early harness attempt requested close as soon as health became ready and exposed that WebView2 may not yet have accepted its first native close message. The final acceptance definition waits for the window handle and stabilization interval, which represents the required launch → load → close workflow.

## 9. Failure handling results

### Sidecar startup failure — FAIL

An invalid `LOCALAPPDATA` root produced exit code `101` and a Rust panic:

`Failed to setup app: ... could not create ... OperatorOS\Data`

No orphan desktop or sidecar remained, but the application did **not** show a controlled user-facing failure. This violates Task 9.

### Sidecar crash while running — PARTIAL / FAIL

Killing the packaged sidecar process tree caused health to disappear while the Tauri parent remained alive. The manager's code transitions its internal state from `READY` to `CRASHED` and does not restart in a loop. However:

- no explicit desktop crash diagnostic entry was written;
- no controlled crash/recovery UI was shown;
- the WebView remained open against a dead backend.

This does not meet the required crash-diagnostic acceptance behavior.

## 10. Security review

| Review item | Result |
|---|---|
| HttpOnly cookie/server-session architecture preserved | PASS |
| `credentials: include` preserved | PASS |
| localStorage/sessionStorage token code | Not found |
| JWT desktop storage | Not found |
| Rust authentication duplication | Not found |
| Desktop login bypass | Not found |
| Passwords in packaged logs | Not observed |
| Runtime JSON secrets | Rust test PASS; only port, directories, and version serialized |
| Sidecar binds to loopback | PASS |

## 11. Automated verification

- Backend: `303 passed` in 242.57 seconds
- Frontend: `21` test files, `110 passed` in 7.49 seconds
- Rust/Tauri: `5 passed`, `0 failed`
- Packaged browser acceptance: setup, login, Dashboard, Attendance Review, Grade Ledger, Executive Reports, backup, guarded restore, restart persistence, and logout completed without browser warnings/errors
- Packaged lifecycle stress: `20/20` passed

The Windows `tests/desktop/test_sidecar_lifecycle.py` harness was not accepted as a clean result in this session because its `CTRL_BREAK_EVENT` handling interrupted the invoking PowerShell console and left the pytest runner active. Equivalent packaged lifecycle behavior was exercised directly, and the harness itself remains a test-infrastructure issue to repair.

## 12. Remaining release blockers

1. Replace startup panic/exit with a controlled user-facing failure surface.
2. Emit an explicit desktop diagnostic when a running sidecar exits unexpectedly and present a controlled crashed/recovery state without an infinite restart loop.
3. Repair the Windows pytest lifecycle harness so it cannot interrupt or strand its parent runner.
4. Execute the complete checklist on a clean Windows 11 x64 machine with no Python, Node.js, Rust, Cargo, WSL, repository, or developer tools.
5. Re-run actual packaged WebView2 console/CSP inspection on that clean machine.

Because Tasks 9 and 10 are not accepted, **Phase 11.1D is not complete and installer work must not begin**.
