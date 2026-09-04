# OperatorOS E2E Testing

## 1. Overview

OperatorOS has one local blocking smoke suite and one guarded full suite. The smoke suite verifies critical backend and browser workflows against a fresh synthetic database. The full suite is reserved for GitHub Actions or an explicit owner-approved local override.

## 2. Components

- `Makefile` exposes the supported entry points.
- `e2e/run-smoke.sh` orchestrates the blocking smoke run and its safety checks.
- `e2e/run-full.sh` guards and orchestrates the full regression run.
- `e2e/start-test-stack.sh` starts an E2E-owned Elysia application stack.
- `e2e/stop-test-stack.sh` stops only the session recorded for that invocation.
- `e2e/clean.sh` removes only `.runtime/operatoros-e2e/` and `e2e-results/`.
- `e2e/helpers/create-test-workspace.py` defines the isolated database-path contract.
- `e2e/helpers/seed-test-database.py` creates deterministic synthetic records.
- `e2e/helpers/write-summary.py` and `e2e/helpers/write-full-summary.py` produce terse summaries.
- `e2e/fixtures/expected/smoke-fixture.json` records the deterministic fixture contract.
- `e2e/smoke/backend/` and `e2e/smoke/web/` contain the blocking tests.
- `e2e/full/` is the expansion point for CI-only coverage.
- `apps/web/playwright.config.ts` reads the selected frontend URL from runtime state and stores failure evidence.
- `start-dev.sh` and `stop-dev.sh` provide session-aware process ownership and dynamic ports.

## 3. Smoke execution flow

`make e2e-smoke` performs these steps:

1. Creates a unique invocation workspace under a temporary `/tmp/operatoros-e2e.*` root.
2. Selects an absolute SQLite path inside that workspace.
3. Rejects any database path outside the disposable E2E root or equal to the protected operational path before opening a database.
4. Initializes a fresh database with the current schema and approved baseline ledger.
5. Seeds deterministic synthetic users, students, attendance, academic metadata, and one intentional enrollment.
6. Records disposable database counts, checksum, and a deterministic enrollment fingerprint.
7. Starts the Elysia backend and frontend through the E2E-owned stack.
8. Copies the ready launcher state into the invocation workspace and exports its backend and frontend URLs.
9. Runs the backend smoke tests with the backend virtual environment.
10. Runs Playwright browser tests with the selected native Linux Node runtime.
11. Stops only the recorded OperatorOS session and waits for its launcher.
12. Recomputes the disposable checksum and enrollment fingerprint, failing if the disposable fixture violates its expected boundary.
13. Writes `e2e-results/summary.txt`; detailed logs, JUnit XML, screenshots, and traces are retained only where configured or needed for diagnosis.

## 4. Runtime responsibilities

The Elysia application stack uses native Linux Bun. Python remains only for disposable fixture setup and smoke assertions. Playwright 1.55.1 collection uses the installed native Linux Node runtime after WSL runtime preparation.

The smoke runner records the native Node path before narrowing `PATH`. It then invokes the installed Playwright CLI directly. Bun remains the package manager and Elysia runtime for the candidate stack.

## 5. Ports and process ownership

Ports are selected at runtime. Port 5173 remains the preferred frontend development port when available, but tests must consume `frontend_url` and `backend_url` from the invocation's `ports.json`; they must not assume fixed ports.

The launcher writes session identity and selected URLs under the invocation-owned runtime directory. The E2E wrapper copies the ready state to `.runtime/operatoros-e2e/<run-id>/ports.json`, and Playwright reads the frontend URL through `OPERATOROS_E2E_FRONTEND_URL` or `OPERATOROS_E2E_PORTS_FILE`.

Never kill an unknown process merely because it owns a preferred port. Cleanup and shutdown must target only the recorded OperatorOS session. `make e2e-clean` uses the launcher-owned cleanup interface and refuses paths outside the two E2E-owned directories.

## 6. Database isolation

- Never use `backend/attendance.db` or any database under `backend/.local-dev/` as an E2E fixture.
- Every smoke run uses a new absolute path under `/tmp/operatoros-e2e.*/<run-id>/state/`.
- The runner performs a lexical path check before database initialization and rejects a path outside the E2E runtime root or equal to `backend/attendance.db`.
- Fixtures are generated from the current schema and deterministic synthetic data; no production database, export, student identity, or enrollment is copied.
- The intentional seeded enrollment is separated from new rows with a deterministic ordered-row fingerprint. Preview-only Class Allocation must leave that fingerprint unchanged.
- The protected operational path is deny-only metadata. The runner never checks its existence, metadata, checksum, contents, or sidecars.
- `OPERATOROS_E2E_DATABASE`, `OPERATOROS_DATA_DIR`, and `DATABASE_URL` are explicitly assigned to the disposable workspace; no ambient operational database configuration is used.
- Mutating tests must use deterministic E2E-only records and restore their boundary state or perform deterministic transactional/API cleanup. Tests may not depend on execution order.

## 7. Supported commands

```bash
make e2e-validate
timeout 300 make e2e-smoke
make e2e-clean
```

`make e2e-validate` performs shell syntax and Python compilation checks without starting the application. `timeout 300 make e2e-smoke` is the local blocking critical-path command. `make e2e-clean` removes only E2E-owned generated state.

`make e2e-critical` runs the Fresh School readiness journey and the `@critical` attendance and academic journeys. It uses the same disposable roots, synthetic fixtures, dynamic ports, and cleanup as the existing E2E runners. `make e2e-smoke` remains the broad route and feature smoke suite.

```bash
make e2e-full
```

The full suite is for GitHub Actions. Local execution is rejected unless an owner explicitly authorizes the `OPERATOROS_ALLOW_LOCAL_E2E_FULL=1` override. It runs smoke first, then the TypeScript backend suite, frontend Vitest suite, and production frontend build. A first GitHub Actions run is CI environment acceptance, not evidence of success until it actually completes.

## 8. Coverage boundaries

The backend smoke suite covers health/authentication and the approved critical API scenarios. The web smoke suite covers login-state detection, attendance navigation, synthetic upload behavior, preview-only Class Allocation, grades, both Excel formats, report downloads, backup download, and read-only restore preflight. All E2E workflows run against Elysia.

The browser suite logs the same disposable account once per test. The E2E
launcher raises only the disposable server's login buckets above the suite
count so repeated browser setup does not become a cross-test rate-limit
collision. Login rate-limit behavior remains covered by the API security
suite.

## 9. Generated directories

- The temporary `/tmp/operatoros-e2e.*` root contains per-invocation database, runtime state, backups, session identity, and selected ports. The smoke runner removes it on exit.
- `e2e-results/` contains summaries, logs, JUnit XML, Playwright screenshots, and traces.

These paths are generated evidence and must not be committed.

## 10. Failure behavior

The smoke command fails on backend or web test failure, startup failure, an unavailable genuine Node 24 runtime, an unsafe database path, or a changed disposable enrollment fingerprint. Expected unauthenticated `/api/auth/me` detection may return 401; unexpected 401/403 and other unexpected 4xx/5xx responses remain failures.

Normal output is the terse summary. Diagnose failures using `e2e-results/summary.txt`, `e2e-results/logs/`, `e2e-results/junit/`, `e2e-results/playwright/`, and the before/after database metadata.

## 11. Extending coverage

Add only deterministic tests that use runtime-provided URLs and synthetic fixture data. Put blocking critical paths under `e2e/smoke/`; put broader CI-only browser coverage under `e2e/full/web/`. Update the fixture contract when deterministic seed data changes, preserve the disposable enrollment fingerprint gate, and keep tests independent of ordering.
