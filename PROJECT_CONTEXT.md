# Project context

OperatorOS is an offline-first school attendance and academic analytics system.
The supported runtime is a local browser application. The current runtime
contract is:

- Bun and TypeScript run the application.
- Elysia is the authoritative API runtime.
- React and Vite provide the browser UI.
- SQLite is the supported database. PostgreSQL is not supported.
- Containers are not required.
- The Tauri desktop shell is removed.

See [AGENTS.md](AGENTS.md), [docs/README.md](docs/README.md), and the current
architecture and operations documents for detailed procedures.

## Recent completed work — 2026-10-01

- Phase A metric contracts, Phase B Student Insights, Attendance C0-C4, and
  Analytics Phase C report consolidation are complete. Phase C merged as PR
  #173 (`caa6b346`) with the card-density follow-up PR #174 (`88dbf97f`).
- Reports & Reviews is the formal-report destination. Monthly is consolidated;
  Annual and Term Review remain distinct. Compatibility routes are preserved.
  `management-summary` remains `RETIRE_LATER` because internal callers and
  compatibility endpoints remain.
- Canonical routes are `/reports?view=monthly`, `/reports?view=annual`, and
  `/reports?view=term-review`. Attendance Rate is Hadir / Expected Student-Days;
  Late Event Rate is Late Events / Expected Student-Days. Zero denominators are
  unavailable. Formal reports preserve OBSERVED, DECLARED, NOT_REPORTED,
  CONFLICT, and coverage; they do not equate declared with observed or
  fabricate lateness.
- `packages/db` owns Bun/TypeScript fresh bootstrap, explicit existing-database
  migration, schema validation, and SQLite lifecycle. The current target is
  S4.7; migration accepts only the approved S4.6 Variant A and Variant B
  physical fingerprints. Normal startup validates and never migrates.
- The persistent development database is distinct from the protected
  operational database. The latter remains S4.3 and needs a separately
  authorized controlled migration. Follow the database operations runbook for
  development database maintenance; normal startup validates and never
  migrates automatically. Do not access protected operational data without
  explicit authorization for that operation.
- Python remains transitional test, fixture, and operations tooling. It is not
  part of application startup or the Bun/TypeScript bootstrap and migration
  paths.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `apps/api/` | Elysia API, domain services, authentication, and API transport |
| `apps/web/` | React browser application and domain UI |
| `packages/contracts/` | TypeBox DTOs and cross-boundary contracts |
| `packages/db/` | Drizzle, SQLite lifecycle, schema, bootstrap/migration, and data paths |
| `packages/ui/` | Reusable presentation primitives |
| `packages/excel/` | Excel import and export infrastructure |
| `packages/config/` | Shared workspace configuration |
| `apps/api/tests/` | API test suites (Bun test) |
| `apps/web/src/**/*.test.ts(x)` | Web test suites (Vitest) |
| `e2e/` | Playwright smoke and full regression harnesses |
| `backend/` | Retained Python reference code, schema tooling, and tests |
| `openapi/operatoros.openapi.json` | Committed OpenAPI contract |
| `apps/web/src/generated/openapi/` | Generated web API types |

Bun is the runtime, package manager, and workspace resolver. The root
`bun.lock` is the lockfile authority. Mise manages tool versions. HK manages
Git lifecycle checks. Turbo manages tasks and cache. Mise pins Bun `1.4.2`,
hk `1.56.1`, and Python `3.12.3`.

## Main user groups and domains

Two roles exist: `admin` and `staff`. Major functional domains are student
master data and enrollment, class attendance entry and review, attendance
corrections and follow-ups, early departures, grades and academic management,
dashboard analytics, reports and Excel exports, data import/export and data
portability, backups and restore, and system configuration.

## Architecture

`apps/api/src/app.ts` assembles the API from domain route modules under
`apps/api/src/domains/`. Browser endpoints live under `/api/<domain>/...`.
Routes validate bodies and queries with TypeBox schemas and use the shared
`actor()` helper for authorization.

`apps/web/` talks to the API through the shared client (`lib/api/client.ts`)
and endpoint adapters (`lib/api/endpoints.ts`, `src/api/*`). TanStack Query
owns server state with one `QueryClient`; logout clears protected query data;
nothing authenticated is persisted to `localStorage`. React Router is the only
router. Chart adapters format server DTOs; the browser never recomputes
canonical business metrics.

`packages/contracts/` owns TypeBox request and response contracts. Zod is not
used. `packages/db/` owns the Drizzle schema, SQLite lifecycle, fresh bootstrap,
explicit migration, schema manifest, canonical data-path resolver
(`src/data-dir.ts`), and startup validation. The preferred data-root variable is
`OPERATOROS_DATA_DIR`; the canonical database filename is `operatoros.sqlite`,
and `OPERATOROS_DEV_DATA_DIR` remains a deprecated alias.

Authentication uses server-side sessions and an HttpOnly `astyx_session`
cookie. Authorization is always a server-side decision; UI capability gating
(`useAuth().can(...)`) only controls visibility and never substitutes for the
API check.

## Roles and authorization

- **admin** holds the full capability list, including `export_student_data`,
  `export_assigned_class_attendance`, `export_staff`, and
  `export_sensitive_student_fields`. Admins bypass per-class assignment
  scoping and can act on any active class.
- **staff** holds a bounded list (`enter_assigned_class_attendance`,
  `view_assigned_attendance`, `export_assigned_class_attendance`, correction
  request and follow-up capabilities, `view_student`, and similar). Staff do
  not hold import, staff-management, backup, or student-edit capabilities.

Capability checks alone are not enough where resources are scoped: class
attendance routes additionally verify an **active `teacher_class_assignments`
row** for non-admin users (the same pattern used by the attendance entry and
assigned-class export routes). Authorization denials are audited to
`operations_audit_events`. Export endpoints write an audit row per download.

## Attendance domain

- Attendance rows are keyed by legacy `students.id`; canonical
  `student_masters` link to them through active `student_device_identities`.
- Class entry writes per-date rows through a transactional endpoint that
  validates duplicate students and ACTIVE enrollment on the target date.
- `attendance_overrides` hold corrections (`override_status`,
  `override_check_in/out`, note, reviewer); append-only history triggers
  protect the audit tables. The effective-status pattern across the API is
  `COALESCE(override_status, status)`.
- Periods can be finalized and reopened; finalized dates reject new entries
  and overrides.
- Jenjang/HEB: `heb_overrides` provide expected school days per jenjang and
  month; absent an override, endpoints derive a fallback from observed data.
- Exports: `GET /api/student-masters/{id}/attendance-history/export-excel`
  (capability `export_student_data`) exports one student's history, and
  `GET /api/attendance/classes/{class_id}/attendance/export-excel?month&year`
  (capability `export_assigned_class_attendance`; non-admins must be assigned
  to the class) exports a class month with recap and daily-detail sheets.
  Both are audited, build workbooks via `@operatoros/excel` (which guards
  formula injection through `appendRow`), and read data without mutating it.

## Data safety

- `backend/attendance.db` is the protected operational S4.3 database, not the
  developer database authority. The Elysia API refuses to open it
  (`PROTECTED_DATABASE_FORBIDDEN`). Tests, E2E, and development startup must
  never use it.
- Ordinary startup validates an existing database and never creates or
  migrates it. Use `bun run db:bootstrap --data-dir <empty-directory>` for a
  fresh S4.7 database. Use `bun run db:migrate-existing --data-dir
  <directory>` only for an explicitly approved existing source schema. The
  persistent development database migration uses the locked wrapper in
  [DATABASE_OPERATIONS.md](docs/operations/DATABASE_OPERATIONS.md).
- The persistent development database lives under the canonical data root and
  is distinct from `backend/attendance.db`. Never inspect, copy, or mutate
  protected data outside an explicitly authorized procedure.
- Tests, fixtures, and E2E use disposable databases and data roots (the
  repository convention is `/tmp` paths combining the process PID and a
  timestamp). Never point `DATABASE_URL` at operator data during tests.
- Backups, recovery archives, reconciliation backups, and root-level operator
  spreadsheets are operator-owned: never modify, move, or read their contents
  as test input.
- Files that may be recreated freely: anything under `/tmp`, the Turbo cache,
  and `node_modules`. Files that must never be modified casually:
  `backend/attendance.db`, anything under the canonical data root, and the
  recovery/audit archive directories.
- `make fresh-db-parity` proves a fresh bootstrap matches the accepted schema
  snapshot; `packages/db` validation fails closed (`EXISTING_SCHEMA_INCOMPLETE`)
  when an existing database is incomplete. Export endpoints are tested with
  explicit no-mutation assertions.

## Validation

Use focused checks first. Fetch `origin/main` before `mise run check:affected`.
Run `bun install --frozen-lockfile` when dependency or workspace state requires
installation. Then run the relevant package tests/typechecks and affected
checks. Use E2E for changes that affect browser workflows; `make e2e-full` is
GitHub-Actions-only unless an owner explicitly approves local execution.

Common focused checks include:

```bash
mise run check:affected
bun run test:security
bun run security:audit
cd apps/web && bun run api:check
cd apps/web && bun run build
make fresh-db-parity
make e2e-smoke
```

`bun run test:architecture`, `bun run turbo:check`, and
`make test-fast|test-pr|test-release` provide deeper or tiered validation.
Retained Python tests use disposable synthetic databases through the external
`OPERATOROS_PYTHON_VENV` environment; do not create a worktree-local
`backend/.venv`. `./start-dev.sh` is the normal Bun/TypeScript launcher
(`--check` for a dry run; `stop-dev.sh`, `make dev-db-status`, and
`make dev-sessions-status` manage sessions). CI runs required checks; do not
remove checks to obtain green CI.

## API and contract discipline

Every browser-visible API route must be represented in
`openapi/operatoros.openapi.json`; `apps/api/tests/openapi-contract.test.ts`
compares the live app against the committed document. After adding or changing
a route, update the committed contract, run `bun run api:generate` in
`apps/web` to refresh `src/generated/openapi/schema.ts`, and confirm
`bun run api:check` reports no drift. Web pages consume endpoint adapters, not
generated types directly.

## Conventions

- Client-facing errors are sanitized; raw stack traces, SQL, and internal
  paths never reach the browser.
- Downloads use the blob request path (`responseType: "blob"`,
  `expectedBlobTypes`) plus `createDownloadUrl`/`revokeDownloadUrl`, with busy
  (`aria-busy`, disabled button) and error states rendered locally.
- Excel workbooks are built only through `@operatoros/excel` helpers;
  `appendRow` guards formula injection and filenames go through
  `safeExportFilename`.
- Tests own their state: per-test disposable databases (PID + timestamp
  paths), closed handles, restored environment, no cross-test fixtures, and
  no wall-clock assertions. Rate-limit windows and relative durations use
  monotonic clocks.
- Mutations run inside `inTransaction` and must roll back cleanly; export
  endpoints assert no-mutation.

## Change-completion checklist

- [ ] Behavior covered by focused API and web tests (positive, invalid input, unauthorized, insufficient role, missing entity, persistence, empty state).
- [ ] OpenAPI contract updated and generated types refreshed (`api:check` green).
- [ ] Server-side authorization verified for every new route (capability plus resource scoping where needed).
- [ ] `bun run check`, security tests, and audit pass; build passes.
- [ ] Schema-affecting work passes `make fresh-db-parity`; no implicit migration of existing databases.
- [ ] E2E smoke green; disposable data only; no leaks (processes, ports, temp artifacts).
- [ ] Current documentation updated; no new phase-report clutter.
- [ ] Commits explicitly staged and SSH-signed; PR merged via green CI.
