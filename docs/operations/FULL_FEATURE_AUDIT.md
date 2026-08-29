# Full Feature Audit — 2026-08-29

Target: `OPERATOROS_FULL_FEATURE_AUDIT_COMPLETE`

## Scope and method

- Audit base: `090b432cb6dae3d6916aa0984906f9ded78e53ab` (accepted final
  origin/main at audit start).
- Feature inventory was derived from current source only: React Router route
  catalog (`apps/web/src/routes/routeDefinitions.tsx`), sidebar navigation
  (`apps/web/src/components/SidebarNav.tsx`), Elysia route plugins
  (`apps/api/src/app.ts` and `apps/api/src/domains/*`), capability model
  (`apps/api/src/auth/capabilities.ts`), Drizzle schema snapshot
  (`packages/db/src/schema.ts`), the committed OpenAPI contract, and the test
  suites. Historical documentation was used only for intent.
- Behavioral testing ran against a disposable data root
  (`/tmp/operatoros-feature-audit-20260829`) with a fresh S4.3 database,
  seeded with the retained synthetic E2E fixture. The protected operational
  database `backend/attendance.db` was never opened; its SHA-256 was recorded
  before and verified unchanged after the audit.
- Runtime backend for behavioral testing was rebuilt from the audit branch
  after the repair below, so all live results reflect the repaired code.

## Repair

### DEFECT-01 — Fresh bootstrap produced an incomplete S4.3 schema (HIGH, repaired)

- Class: `DATABASE_INTEGRITY_DEFECT`.
- A fresh database created by the documented retained tooling
  (`core.schema_migrations initialize-fresh`) contained only 65 of the 78
  tables declared by the S4.3 schema snapshot. The 13 missing tables are the
  staff domain (`staff_members`, `staff_education`, `staff_identifiers`,
  `staff_contact_details`, `staff_import_*`, `staff_job_title_mappings`,
  `staff_jenjang_assignments`), dismissal policies
  (`dismissal_policies`, `dismissal_policy_audits`), and teacher-class
  assignments (`teacher_class_assignments`, `teacher_class_assignment_audit`).
  The migration ledger still claimed `20260725_s43`, so startup validation
  passed and `GET /api/staff` plus `GET /api/attendance/departure-policies`
  returned HTTP 500 on any freshly bootstrapped environment. Automated test
  bootstraps masked the gap by importing all ORM models and calling
  `init_db()` after the same bootstrap call.
- Repair (commit `fix(db): complete fresh-bootstrap schema with model-defined
  tables`): fresh bootstraps now create every model-defined table after the
  registered migrations. Existing databases are never modified, the migration
  ledger and schema guards are untouched, and data seeding stays out of
  bootstrap. A regression test asserts a fresh database contains every table
  declared by `packages/db/src/schema.ts`.
- Verified end-to-end: after the repair a plain `initialize-fresh` database
  yields 78 tables and the complete live API sweep (59 checks) passes,
  including staff list and departure policies.

## Inventories

### Routes

- Route entries: 37 (33 navigable pages, 2 redirects (`/mapping`,
  `/reports`), `/login`, wildcard 404). Protected: 35 (all except `/login`).
- Parameterized: 3 (`/staff/:id`, `/students/:id`, `/attendance/students/:id`).
- All pages lazy-loaded; sidebar items are validated against the route
  catalog at module load, so dead navigation links are structurally
  impossible; deep-link and refresh behavior covered by the browser suite.
- Roles: 2 — `admin` (68 capabilities) and `staff` (18 capabilities, scoped
  to assigned classes and own-correction paths). Server-side `actor()` checks
  every protected route; UI hiding is never the only boundary (verified by
  direct API denial checks: staff → 403 on staff management, grades,
  management monthly report, backups, imports, student create).

### API

- Committed contract: 285 paths / 330 operations (frozen legacy paths
  included). Live source: 23 route plugins, ~218 registrations.
- Every operation was classified against the domain inventory below.
- OpenAPI drift check (`api:check`) and the OpenAPI contract test pass.

### Feature registry (domain → status)

| Domain | Representative routes / APIs | Result |
|---|---|---|
| Auth/session | login, logout, me, setup bootstrap/admin | PASS |
| Student masters | student-masters CRUD, profile, health, documents, guardians, audit | PASS |
| Staff | staff list/detail/education/employment, staff imports | PASS (after DEFECT-01 repair) |
| Enrollment | student-enrollments, transfer, end, lifecycle, drafts | PASS |
| Attendance entry/review | review, class entry, overrides, mass-override | PASS |
| Corrections | correction requests, approve/reject, period finalize/reopen | PASS |
| Follow-ups | candidates, queue, assign, notes, bulk | PASS |
| Operator work queue | `/api/operator/work-queue` | PASS |
| Early departure | policies, departures, excuses | PASS (after DEFECT-01 repair) |
| Teacher assignments | teacher-class-assignments, assigned classes | PASS (after DEFECT-01 repair) |
| Grades / academic | grade ledger, enrollment, KKM, terms, subjects | PASS |
| Interventions | academic-interventions CRUD | PASS |
| Progression | previews, commit, mapping rules | PASS |
| Dashboard/analytics | overview, trends, cohorts, rekap v2, tardiness, attendance report | PASS |
| Reports | filters, monthly, annual, management monthly (admin-only verified) | PASS |
| Report builder | sections, templates, branding, excel/pdf export | PASS |
| Imports (.xlsx/.xls) | uploads preview/commit, roster, updates, conflict center | PASS (21/21 live checks) |
| Exports | Excel exports, CSV, templates, data portability | PASS (formula-injection scan clean) |
| Backup/restore | encrypted backup, preflight, restore, scheduler (single owner) | PASS; negatives fail closed |
| Config | jenjang, HEB, absence reasons, readiness, system health | PASS |
| System | clear-data (destructive gated), health, readiness | PASS |

## Observations (unresolved, none HIGH/CRITICAL)

1. `TEST_COVERAGE_GAP` (MEDIUM, RESOLVED): the full API suite intermittently
   failed one different test per run. Root cause was not test pollution:
   fresh-bootstrap ledger writes use wall-clock `applied_at` timestamps, and
   a backward clock step (NTP correction) between the S4.2 and S4.3 ledger
   inserts inverted their order; the schema validator selected the migration
   head by wall-clock ordering, so the stale S4.2 row became the head and a
   healthy database failed with `DATABASE_MIGRATION_REQUIRED`. Captured twice
   in diagnostics (S4.3 at 10:11:16.338 with S4.2 at 10:11:17.184, and
   10:23:17.465/10:23:18.425). Fix: the S4.3 migration now writes a monotonic
   `applied_at` (stepped one microsecond past the newest existing ledger row
   when the wall clock steps backward), and the validator checks the ledger
   by version identity (current version present with matching fingerprint;
   any newer version fails closed) instead of wall-clock ordering. Ordinary
   startup still never modifies an existing database. A second, related
   wall-clock dependence surfaced during merged-main stress (Retry-After 61
   instead of 60 after an NTP step); the login rate limiter now runs on a
   monotonic clock, keeping windows and Retry-After exact across clock
   steps without weakening limiting.
2. `BEHAVIOR_REVIEW_REQUIRED` (MEDIUM, RESOLVED): the canonical persistent
   development database predated the repair and contained only 65 tables. It
   was reconciled to 78/78 on 2026-08-29 under the explicit one-time
   authorized procedure `OPERATOROS_DEV_DB_SCHEMA_RECONCILIATION`
   (verified pre-reconciliation backup retained; ledger untouched). A
   verified backup remains under the development data root's
   `reconciliation-backups/` directory. Related hardening: existing-schema
   startup validation now derives required tables from the canonical schema
   snapshot and fails closed with `EXISTING_SCHEMA_INCOMPLETE` when an
   existing database is incomplete; ordinary startup still never migrates an
   existing database.
3. `DEAD_FEATURE_CANDIDATE` (LOW): `pages/ClassMapping.tsx` and
   `pages/Upload.tsx` are not routed; `/attendance/students/:id` (legacy
   student profile) is reachable only from the unrouted `ClassMapping`.
   Classified only; no removal was performed.
4. `RESTORE` message (LOW): preflight rejects checksum-mismatched backup
   files with "Invalid backup filename" — fail-closed and safe, but the
   message does not distinguish checksum failure from a bad filename.

## Test results (audit branch)

- `bun run lint`, `bun run check:typebox`, `bun run check:architecture`,
  `bun run test:architecture`, `bun run check:contracts`, `bun run check:ui`:
  PASS
- Typecheck: all packages PASS. Frontend production build: PASS.
- Package tests: contracts 2/2, db 11/11, excel 3/3, ui 4/4,
  api 80/80 (551+ expectations), web 58 files / 304/304.
- `bun run test:security`: 17/17 PASS.
- `bun run security:audit`: no vulnerabilities; documented exceptions only
  (esbuild, uuid).
- `make fresh-db-parity`: PASS (`FRESH_DATABASE_RELEASE_GATE_ESTABLISHED`).
- OpenAPI drift check: PASS.
- Retained Python tooling tests: 1/1 PASS on a disposable database.
- Live API feature sweep (positive, negative, permission, persistence):
  59/59 PASS.
- Live import/export/report sweep: 21/21 PASS (xlsx + legacy xls import
  parity, negative workbook cases, Excel/CSV exports parse, no formula
  injection).
- Live backup preflight negatives: valid 200; truncated, tampered, unknown
  fail closed (4xx); staff denied 403.
- Browser E2E: see "E2E results" below.

## Safety

- Protected DB accessed: NO (checksum unchanged, no WAL/SHM sidecars).
- Operator-owned backups modified: NO. Recovery archives: untouched.
- Root user spreadsheets: unchanged.
- Disposable data root only; all runtime artifacts under
  `/tmp/operatoros-feature-audit-20260829`.
- Authored commits SSH-signed; no force push, no amend, no direct main push.

## E2E results

Playwright smoke suite on the audit branch: **backend 7/7, web 20/20, PASS**
(duration 2m36s, isolated temporary data root and ports, artifacts cleaned).
