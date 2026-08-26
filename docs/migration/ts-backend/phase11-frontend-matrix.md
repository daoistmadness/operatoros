# Phase 11 frontend verification matrix

Status: `LOCAL_ACCEPTANCE_READY_PENDING_PR_MERGE`.

Accepted Phase 10: `65e7b4f56ed7765a17578adf973ededc9fbe32c9`.

Phase 11 base: `ba8d75eb40d19e9d6cf934bb071051bca2c985b6`.

Branch: `codex/ts-backend-phase11-frontend-verification`.

FastAPI remains the default backend. Elysia is selected only for the isolated
browser stack with `OPERATOROS_E2E_BACKEND=elysia`.

## Frontend API inventory

The active frontend inventory contains 19 API modules. Each module resolves to
the Phase 10 Elysia contract. The Phase 10 contract contains 327 operations
across 282 paths with no unknown operation or path.

| Frontend area | API modules | Elysia status |
| --- | --- | --- |
| Setup and auth | `setup`, `auth` | `PARITY_GREEN` |
| Academic configuration | `academicConfig`, `progression`, `academicInterventions` | `PARITY_GREEN` |
| Students | `students`, `enrollment` | `PARITY_GREEN` |
| Staff and assignments | `staff`, `teacherClassAssignments` | `PARITY_GREEN` |
| Attendance | `earlyDeparture`, attendance API calls, corrections | `PARITY_GREEN` |
| Excel and upload history | `uploadConflicts`, `uploadHistory` | `PARITY_GREEN` |
| Grades | `grades`, `grades.compat` | `PARITY_GREEN` |
| Reports and analytics | `analytics`, `reports`, `reportBuilder` | `PARITY_GREEN` |
| Safety and portability | `backups`, `dataPortability` | `PARITY_GREEN` |

The client uses same-origin `/api` URLs when no API base is configured. Every
request includes browser credentials. Vite proxies `/api` to the selected
backend in the isolated test stack.

## Browser workflow matrix

| Workflow | FastAPI | Elysia | Evidence |
| --- | --- | --- | --- |
| Login, refresh, logout, protected request | `GREEN` | `GREEN` | `phase11-verification.spec.ts`, `@auth` |
| Authenticated navigation and responsive shell | `GREEN` | `GREEN` | Existing web smoke suite |
| Academic configuration and progression preview | `GREEN` | `GREEN` | `@configuration` |
| Students and student profile mutation | `GREEN` | `GREEN` | `@operator-queue` |
| Staff and assignment surfaces | `GREEN` | `GREEN` | Existing route and API coverage |
| Enrollments and protected mutation behavior | `GREEN` | `GREEN` | Existing backend and browser coverage |
| Attendance review and correction surfaces | `GREEN` | `GREEN` | `@attendance`, `@corrections` |
| `.xlsx` validate, preview, apply | `GREEN` | `GREEN` | `@phase11 @imports` |
| `.xls` validate, preview, apply | `GREEN` | `GREEN` | `@phase11 @imports` |
| Grade read and save | `GREEN` | `GREEN` | `@phase11 @grades` |
| Monthly report and Excel download | `GREEN` | `GREEN` | `@phase11 @reports` |
| Backup create and download | `GREEN` | `GREEN` | `@phase11 @safety` |
| Read-only restore preflight | `GREEN` | `GREEN` | `@phase11 @safety` |
| Error recovery and focus behavior | `GREEN` | `GREEN` | Existing error and dialog smoke |

Full smoke result for each backend:

- Backend smoke: 7/7 passed.
- Browser smoke: 19/19 passed.
- Application console errors: 0.
- Unexplained network errors: 0.

## Runtime and safety disposition

- FastAPI fallback remains available and passes the same 19 browser workflows.
- Elysia production-like test startup uses Bun and a disposable SQLite database.
- Playwright uses the installed native Linux Node CLI because the Bun launcher
  does not collect this repository's Playwright tests reliably.
- The E2E runner records the native Node path before its controlled PATH setup.
- `e2e-full` had a pre-job YAML parse defect. Quoting the SQLite URL repairs the
  workflow syntax without changing application behavior.
- Backup restore mutation was not run. Destructive operations remain disabled.
  Read-only restore preflight passed against a disposable database.
- Protected database access: 0.
- FastAPI available: yes.
- Permanent frontend cutover: no.
- Phase 12 started: no.
