# OperatorOS E2E Testing

## 1. Overview

OperatorOS has one local blocking smoke suite and one guarded full suite. The smoke suite verifies critical backend and browser workflows against a fresh synthetic database. The full suite is reserved for GitHub Actions or an explicit owner-approved local override. Native Windows/Tauri acceptance is a separate manual workflow and is not part of either automated result.

## 2. Components

- `Makefile` exposes the supported entry points.
- `e2e/run-smoke.sh` orchestrates the blocking smoke run and its safety checks.
- `e2e/run-full.sh` guards and orchestrates the full regression run.
- `e2e/start-test-stack.sh` starts an E2E-owned Bun application stack.
- `e2e/stop-test-stack.sh` stops only the session recorded for that invocation.
- `e2e/clean.sh` removes only `.runtime/operatoros-e2e/` and `e2e-results/`.
- `e2e/helpers/create-test-workspace.py` defines the isolated database-path contract.
- `e2e/helpers/seed-test-database.py` creates deterministic synthetic records.
- `e2e/helpers/write-summary.py` and `e2e/helpers/write-full-summary.py` produce terse summaries.
- `e2e/fixtures/expected/smoke-fixture.json` records the deterministic fixture contract.
- `e2e/smoke/backend/` and `e2e/smoke/web/` contain the blocking tests.
- `e2e/full/` is the expansion point for CI-only coverage.
- `frontend/playwright.config.ts` reads the selected frontend URL from runtime state and stores failure evidence.
- `start-dev.sh` and `stop-dev.sh` provide session-aware process ownership and dynamic ports.
- `scripts/start-tauri-dev.ps1` provides the separate Windows/Tauri development acceptance path.

## 3. Smoke execution flow

`make e2e-smoke` performs these steps:

1. Creates a unique invocation workspace under `.runtime/operatoros-e2e/`.
2. Selects an absolute SQLite path inside that workspace.
3. Rejects any database path outside the E2E root or equal to `backend/attendance.db`.
4. Records the production database checksum, or records that it is missing.
5. Initializes a fresh database with the current schema and approved baseline ledger.
6. Seeds deterministic synthetic users, students, attendance, academic metadata, and one intentional enrollment.
7. Records disposable database counts, checksum, and a deterministic enrollment fingerprint.
8. Starts the backend and frontend through `start-dev.sh` using Bun and runtime-selected ports.
9. Copies the ready launcher state into the invocation workspace and exports its backend and frontend URLs.
10. Runs the backend smoke tests with the backend virtual environment.
11. Runs Playwright browser tests with genuine Node.js 22.
12. Stops only the recorded OperatorOS session and waits for its launcher.
13. Recomputes production checksum and disposable enrollment fingerprint, failing if either protected value changed.
14. Writes `e2e-results/summary.txt`; detailed logs, JUnit XML, screenshots, and traces are retained only where configured or needed for diagnosis.

## 4. Runtime responsibilities

The OperatorOS application stack uses the pinned Bun 1.3.14 runtime. Playwright 1.55.1 collection in this project must use genuine Node.js 22.23.1; Bun 1.3.14 is unsupported for Playwright collection because collection hangs when real specifications are present. `OPERATOROS_NODE22_EXECUTABLE` may identify the approved Node binary when it is not the active `node`.

The smoke runner narrows `PATH` for Playwright so the selected Node 22 binary owns `node` and `npx`. Bun continues to own the application frontend launched by `start-dev.sh`.

## 5. Ports and process ownership

Ports are selected at runtime. Port 5173 remains the preferred frontend development port when available, but tests must consume `frontend_url` and `backend_url` from the invocation's `ports.json`; they must not assume fixed ports.

The launcher writes session identity and selected URLs under the invocation-owned runtime directory. The E2E wrapper copies the ready state to `.runtime/operatoros-e2e/<run-id>/ports.json`, and Playwright reads the frontend URL through `OPERATOROS_E2E_FRONTEND_URL` or `OPERATOROS_E2E_PORTS_FILE`.

Never kill an unknown process merely because it owns a preferred port. Cleanup and shutdown must target only the recorded OperatorOS session. `make e2e-clean` uses the launcher-owned cleanup interface and refuses paths outside the two E2E-owned directories.

## 6. Database isolation

- Never use `backend/attendance.db` or any database under `backend/.local-dev/` as an E2E fixture.
- Every smoke run uses a new absolute path under `.runtime/operatoros-e2e/<run-id>/state/`.
- The runner rejects a path outside the E2E runtime root and explicitly rejects equality with `backend/attendance.db`.
- Fixtures are generated from the current schema and deterministic synthetic data; no production database, export, student identity, or enrollment is copied.
- The intentional seeded enrollment is separated from new rows with a deterministic ordered-row fingerprint. Preview-only Class Allocation must leave that fingerprint unchanged.
- Production checksum equality before and after the run is a blocking requirement.
- Mutating tests must use deterministic E2E-only records and restore their boundary state or perform deterministic transactional/API cleanup. Tests may not depend on execution order.

## 7. Supported commands

```bash
make e2e-validate
timeout 300 make e2e-smoke
make e2e-clean
```

`make e2e-validate` performs shell syntax and Python compilation checks without starting the application. `timeout 300 make e2e-smoke` is the local blocking critical-path command. `make e2e-clean` removes only E2E-owned generated state.

```bash
make e2e-full
```

The full suite is for GitHub Actions. Local execution is rejected unless an owner explicitly authorizes the `OPERATOROS_ALLOW_LOCAL_E2E_FULL=1` override. It runs smoke first, then the complete backend pytest suite, frontend Vitest suite, and production frontend build. A first GitHub Actions run is CI environment acceptance, not evidence of success until it actually completes.

## 8. Coverage boundaries

The backend smoke suite covers health/authentication and the approved critical API scenarios. The web smoke suite covers login-state detection, attendance navigation, synthetic upload behavior, and preview-only Class Allocation without creating a new enrollment. The full suite adds existing backend and frontend regressions plus a frontend production build.

Desktop is reported as skipped with `BLOCKED_BY_EXISTING_INFRASTRUCTURE`. No automated run claims native Tauri, WebView2, installer, sidecar, restart, or Windows lifecycle coverage.

### Windows/Tauri manual development acceptance

Run native Tauri tooling from an NTFS Windows worktree, not a WSL UNC path. The Windows and WSL worktrees must both be clean and at the same commit. From PowerShell, use:

```powershell
.\scripts\start-tauri-dev.ps1 `
  -WslRepositoryPath /home/<user>/projects/absensi/school-attendance-analytics `
  -WindowsSourcePath C:\path\to\school-attendance-analytics `
  -JavaScriptRuntime bun `
  -PortStrategy fixed
```

The launcher verifies Bun 1.3.14 (or Node 22 when explicitly selected), starts the WSL application stack, waits for synchronized runtime state, verifies Windows-to-WSL reachability, generates a temporary Tauri override under `%LOCALAPPDATA%\OperatorOS\dev\<session-id>`, and runs Tauri from the Windows worktree. Its `finally` block stops only the session it started. This is a manual development workflow and does not change the automated desktop status.

## 9. Generated directories

- `.runtime/operatoros-e2e/` contains per-invocation database, runtime state, backups, session identity, and selected ports.
- `e2e-results/` contains summaries, logs, JUnit XML, Playwright screenshots, and traces.
- `%LOCALAPPDATA%\OperatorOS\dev\<session-id>` contains temporary Windows/Tauri override state and is preserved when a failed run needs diagnosis.

These paths are generated evidence and must not be committed.

## 10. Failure behavior

The smoke command fails on backend or web test failure, startup failure, an unavailable genuine Node 22 runtime, a production checksum change, or a changed disposable enrollment fingerprint. Expected unauthenticated `/api/auth/me` detection may return 401; unexpected 401/403 and other unexpected 4xx/5xx responses remain failures.

Normal output is the terse summary. Diagnose failures using `e2e-results/summary.txt`, `e2e-results/logs/`, `e2e-results/junit/`, `e2e-results/playwright/`, and the before/after database metadata. Do not reinterpret a missing desktop prerequisite as a desktop pass.

## 11. Extending coverage

Add only deterministic tests that use runtime-provided URLs and synthetic fixture data. Put blocking critical paths under `e2e/smoke/`; put broader CI-only browser coverage under `e2e/full/web/`. Update the fixture contract when deterministic seed data changes, preserve the production checksum and enrollment fingerprint gates, and keep tests independent of ordering. Native desktop automation requires a separately approved Windows automation interface before it can enter either suite.
