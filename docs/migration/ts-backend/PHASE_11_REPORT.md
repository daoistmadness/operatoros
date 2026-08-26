# Phase 11 frontend verification report

Status: `LOCAL_ACCEPTANCE_READY_PENDING_PR_MERGE`.

Phase 11 target: `TYPESCRIPT_BACKEND_PHASE_11_FRONTEND_VERIFICATION_READY`.

Accepted Phase 10 main:
`65e7b4f56ed7765a17578adf973ededc9fbe32c9`.

Phase 11 base:
`ba8d75eb40d19e9d6cf934bb071051bca2c985b6`.

Branch: `codex/ts-backend-phase11-frontend-verification`.

## Changes

- Added an isolated Elysia browser stack selected by
  `OPERATOROS_E2E_BACKEND=elysia`.
- Kept FastAPI as the default E2E and rollback backend.
- Added synthetic `.xlsx` and `.xls` browser fixtures.
- Verified the Elysia candidate with a built frontend served by `vite preview`.
- Added browser verification for logout, session refresh, grades, both Excel
  formats, report download, backup download, and restore preflight.
- Repaired the `e2e-full` YAML scalar that prevented jobs from being created.
- Added the frozen backend-TS install required by the synthetic Excel fixtures.
- Preserved full-suite log directories after successful smoke cleanup.
- Repaired the PR test-tier handoff for the native Playwright Node path.
- Closed Elysia browser compatibility defects in correction IDs, student
  profiles, student exports, grade candidates, and progression errors.

## Results

| Check | Result |
| --- | --- |
| Frontend API modules classified | 19/19 |
| FastAPI browser smoke | 19/19 green |
| Elysia browser smoke | 19/19 green |
| FastAPI backend smoke | 7/7 green |
| Elysia backend smoke | 7/7 green |
| Frontend tests | 301/301 green |
| Backend TypeScript tests | 61/61 green |
| Backend TypeScript expectations | 455 |
| Python backend tests | 744 passed, 30 skipped |
| Frontend production build | passed |
| TypeScript typecheck | passed |
| API contract and boundary checks | passed |
| Frozen Bun installs | passed |
| Protected database access | 0 |

The Phase 10 backend baseline remains 54/54 exact dual replay and 54/54
deliberate mismatch detections. The Phase 10 inventory remains 327 operations
and 282 paths, with 14/14 candidate families replay-green.

## Browser contract

The frontend keeps the same-origin cookie-session model. It sends credentials
with every API request. The test topology selects FastAPI or Elysia behind the
same Vite `/api` proxy. No JWT or localStorage authentication was added.

The browser suite proves login, refresh, logout, CRUD navigation, attendance,
`.xlsx` import, `.xls` import, grades, reports, downloads, backup creation,
and read-only restore preflight against both backends. It captures browser
console and request failures. It found zero application errors in the final
runs.

The disposable safety test keeps destructive restore disabled. It proves the
restore dialog and read-only preflight. A destructive restore is outside this
verification run.

## Existing CI baseline

The `e2e-full` workflow previously failed before job creation because the YAML
parser rejected the unquoted value `sqlite:///:memory:`. The value is now
quoted. Its first executable run then lacked the backend-TS packages required
by the synthetic Excel fixtures. The workflow now installs those packages with
the frozen Bun lockfile. Its next run passed smoke, then exposed that smoke
cleanup removed the full-suite log directories. `run-full.sh` now recreates
those owned directories before the remaining checks. These are CI workflow
repairs, not application behavior changes.

The local `make test-pr` run completed its static, frontend, and first Python
backend stages. Its second Python pass also passed. It then exposed a runner
environment defect: `test-tier.sh` had removed the mise Node path before the
smoke runner resolved Playwright. The runner now receives that absolute native
Linux Node path before PATH narrowing. The full smoke suite passed under the
same narrowed PATH after this repair.

Required PR CI and merged-main CI remain pending until the Phase 11 branch is
pushed and merged.

## Scope boundaries

- FastAPI remains available.
- The frontend default runtime remains unchanged.
- Permanent frontend cutover has not started.
- Phase 12 has not started.
- Python dependencies remain installed.
- The protected operational database was not opened or changed.
