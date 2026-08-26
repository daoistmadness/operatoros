# TypeScript Backend Phase 12 Report

## Target

`TYPESCRIPT_BACKEND_PHASE_12_FINAL_CUTOVER_READY`

## Baseline

- Accepted Phase 11 main: `f87b58997f474fa6bc489d158efe97096bff6e28`
- Normal backend before Phase 12: FastAPI
- Normal backend after Phase 12: Elysia
- Rollback backend: FastAPI
- Database contract: SQLite S4.3
- Protected database access: 0

## Runtime contract

The normal launcher starts Elysia. The frontend uses the same-origin Vite
proxy and the selected backend. FastAPI remains available with
`OPERATOROS_BACKEND=fastapi`.

Normal commands:

```bash
./start-dev.sh
./scripts/start-backend.sh
```

Rollback commands:

```bash
OPERATOROS_BACKEND=fastapi ./start-dev.sh
OPERATOROS_BACKEND=fastapi ./scripts/start-backend.sh
```

## Preserved behavior

- `astyx_session` remains an HttpOnly server-side session cookie.
- FastAPI remains available for rollback and parity regression.
- Python dependencies remain installed and supported for the fallback.
- No schema migration is part of the cutover.
- The frontend is not switched through source edits.
- Phase 13 has not started.

## Acceptance evidence

Local acceptance and the first pull request validation are green.

- Frontend tests: 301/301 passed across 57 files.
- TypeScript backend tests: 61/61 passed with 455 expectations.
- Frontend typecheck, build, API contract, boundary, dependency, and Node
  regression checks passed.
- Two full Python backend passes completed. Each pass reported 745 passed and
  30 skipped.
- Default Elysia E2E smoke passed with 7 backend and 19 browser scenarios.
- FastAPI fallback E2E smoke passed with 7 backend and 19 browser scenarios.
- Elysia health and readiness passed through the managed launcher.
- Standalone Elysia startup passed against a disposable database.
- The rollback path passed in the fallback E2E stack.
- The Phase 10 baseline remains 54/54 dual replay exact and 54/54 deliberate
  mismatches detected.
- The protected database was absent from the isolated worktree. Access count is
  zero.
- FastAPI source, dependencies, routes, and fallback startup remain present.

The required pull request checks passed. The Phase 12 gate remains withheld
until the merge and post-merge cutover and rollback drills pass.
