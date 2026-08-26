# OperatorOS E2E Testing

## 1. Overview

OperatorOS has one local blocking smoke suite and one guarded full suite. The smoke suite verifies critical backend and browser workflows against a fresh synthetic database. The full suite is reserved for GitHub Actions or an explicit owner-approved local override.

## 2. Components

- `Makefile` exposes the supported entry points.
- `e2e/run-smoke.sh` orchestrates the blocking smoke run and its safety checks.
- `e2e/run-full.sh` guards and orchestrates the full regression run.
- `e2e/start-test-stack.sh` starts an E2E-owned Elysia or FastAPI application stack.
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

## 3. Smoke execution flow

`make e2e-smoke` performs these steps:

1. Creates a unique invocation workspace under `.runtime/operatoros-e2e/`.
2. Selects an absolute SQLite path inside that workspace.
3. Rejects any database path outside the E2E root or equal to `backend/attendance.db`.
4. Records the production database checksum, or records that it is missing.
5. Initializes a fresh database with the current schema and approved baseline ledger.
6. Seeds deterministic synthetic users, students, attendance, academic metadata, and one intentional enrollment.
7. Records disposable database counts, checksum, and a deterministic enrollment fingerprint.
8. Starts the default Elysia backend and frontend through `start-dev.sh`, or starts the FastAPI fallback when `OPERATOROS_E2E_BACKEND=fastapi`.
9. Copies the ready launcher state into the invocation workspace and exports its backend and frontend URLs.
10. Runs the backend smoke tests with the backend virtual environment.
11. Runs Playwright browser tests with the selected native Linux Node runtime.
12. Stops only the recorded OperatorOS session and waits for its launcher.
13. Recomputes production checksum and disposable enrollment fingerprint, failing if either protected value changed.
14. Writes `e2e-results/summary.txt`; detailed logs, JUnit XML, screenshots, and traces are retained only where configured or needed for diagnosis.

## 4. Runtime responsibilities

The default Elysia application stack uses native Linux Bun. The FastAPI fallback uses the repository's managed Python runtime. Playwright 1.55.1 collection uses the installed native Linux Node runtime after WSL runtime preparation.

The smoke runner records the native Node path before narrowing `PATH`. It then invokes the installed Playwright CLI directly. Bun remains the package manager and Elysia runtime for the candidate stack.

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
OPERATOROS_E2E_BACKEND=fastapi timeout 420 make e2e-smoke
make e2e-clean
```

`make e2e-validate` performs shell syntax and Python compilation checks without starting the application. `timeout 300 make e2e-smoke` is the local blocking critical-path command. `make e2e-clean` removes only E2E-owned generated state.

```bash
make e2e-full
```

The full suite is for GitHub Actions. Local execution is rejected unless an owner explicitly authorizes the `OPERATOROS_ALLOW_LOCAL_E2E_FULL=1` override. It runs smoke first, then the complete backend pytest suite, frontend Vitest suite, and production frontend build. A first GitHub Actions run is CI environment acceptance, not evidence of success until it actually completes.

## 8. Coverage boundaries

The backend smoke suite covers health/authentication and the approved critical API scenarios. The web smoke suite covers login-state detection, attendance navigation, synthetic upload behavior, preview-only Class Allocation, grades, both Excel formats, report downloads, backup download, and read-only restore preflight. The same suite runs against Elysia by default and against the FastAPI fallback with `OPERATOROS_E2E_BACKEND=fastapi`.

## 9. Generated directories

- `.runtime/operatoros-e2e/` contains per-invocation database, runtime state, backups, session identity, and selected ports.
- `e2e-results/` contains summaries, logs, JUnit XML, Playwright screenshots, and traces.

These paths are generated evidence and must not be committed.

## 10. Failure behavior

The smoke command fails on backend or web test failure, startup failure, an unavailable genuine Node 24 runtime, a production checksum change, or a changed disposable enrollment fingerprint. Expected unauthenticated `/api/auth/me` detection may return 401; unexpected 401/403 and other unexpected 4xx/5xx responses remain failures.

Normal output is the terse summary. Diagnose failures using `e2e-results/summary.txt`, `e2e-results/logs/`, `e2e-results/junit/`, `e2e-results/playwright/`, and the before/after database metadata.

## 11. Extending coverage

Add only deterministic tests that use runtime-provided URLs and synthetic fixture data. Put blocking critical paths under `e2e/smoke/`; put broader CI-only browser coverage under `e2e/full/web/`. Update the fixture contract when deterministic seed data changes, preserve the production checksum and enrollment fingerprint gates, and keep tests independent of ordering.
