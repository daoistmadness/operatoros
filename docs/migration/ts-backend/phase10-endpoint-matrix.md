# Phase 10 endpoint matrix

Audit base: `daaa1a8ff052b958be573c15a390e42c6d035d2c`.

Audit commit: pending next Phase 10 slice commit.

FastAPI remains the reference. The audit used the current application OpenAPI
document and a disposable SQLite database for the Elysia route list.

## Counts

| Measure | FastAPI | Elysia | Result |
| --- | ---: | ---: | --- |
| OpenAPI paths | 282 | 199 | 90 unresolved operations are mapped below |
| Operations | 327 | 237 matching operations | 89 migration defects and one deprecated route remain |
| Elysia runtime routes | — | 238 | `/ready` is an Elysia-only readiness route |
| Unknown operations | — | — | 0 |

The route comparison normalizes only FastAPI `{id:type}` and Elysia `:id`
parameter syntax. It does not ignore methods, aliases, status codes, payloads,
headers, cookies, database state, or audit state.

## Status rules

| Status | Meaning |
| --- | --- |
| `PARITY_GREEN` | The route exists in Elysia and prior phase evidence covers its contract. |
| `INTENTIONALLY_DEPRECATED` | FastAPI marks the route deprecated and returns its documented terminal response. |
| `LATER_RUNTIME_ONLY` | The route remains a documented FastAPI runtime surface with approved later ownership. |
| `NOT_APPLICABLE` | The route is not part of the FastAPI contract. |
| `MIGRATION_DEFECT` | The intended FastAPI behavior has no proven Elysia equivalent. |

## Green and non-applicable routes

- 237 FastAPI operations are `PARITY_GREEN` at route and prior-phase evidence
  level.
- `GET /ready` is `NOT_APPLICABLE`. It is an Elysia foundation route.
- The existing 40-scenario replay remains `40/40 EXACT_MATCH`.

## Remaining matrix

Every row below covers every listed method and path in that family. No route is
unknown.

| FastAPI module | Count | Routes | Classification | Evidence or next action |
| --- | ---: | --- | --- | --- |
| `api.analytics` | 12 | Dashboard detail, attendance-rate, management-summary, historical-trends, intervention-impact, and both legacy aliases | `MIGRATION_DEFECT` | Filters, lateness aggregates, attendance-rate routes, and monthly-by-class are green on both aliases. Implement and replay the remaining paths. |
| `api.attendance_followups` | 17 | `/api/attendance/followups*` | `MIGRATION_DEFECT` | Frontend consumers exist. Preserve the follow-up state machine and history. |
| `api.data_portability` | 8 | `/api/data-portability/*` | `MIGRATION_DEFECT` | The frontend uses this surface. Preserve preview, commit, error-file, and history behavior. |
| `api.operator_work_queue` | 1 | `GET /api/operator/work-queue` | `MIGRATION_DEFECT` | The frontend exposes the work queue. Reuse follow-up authorization. |
| `api.report_builder` | 12 | `/api/report-builder/*` | `MIGRATION_DEFECT` | The frontend uses templates, preview, and exports. Port the service contract before cutover. |
| `api.staff` | 2 | `/api/staff/imports/*` | `MIGRATION_DEFECT` | Import history is a production API surface. Preserve provenance and result files. |
| `api.student_enrollments` | 4 | Roster preview, commit, template, and academic-master preview | `MIGRATION_DEFECT` | The frontend uses roster preview, commit, and template routes. |
| `api.student_exports` | 2 | `/api/student-exports/{preview,download}` | `MIGRATION_DEFECT` | Export authorization and preview checksum are not proven in Elysia. |
| `api.student_import_sessions` | 2 | `/api/student-import-sessions/*` | `MIGRATION_DEFECT` | Rollback behavior is not proven in Elysia. |
| `api.student_masters` | 6 | Student update preview, commit, history, template, and result workbook | `MIGRATION_DEFECT` | The frontend uses update preview and commit. Preserve checksum and provenance. |
| `api.students` | 1 | `GET /students/operations` | `MIGRATION_DEFECT` | Canonical `/api` behavior exists. The legacy alias must remain or receive approved deprecation. |
| `api.system` | 1 | `POST /api/system/clear-data` | `MIGRATION_DEFECT` | The frontend uses this destructive control. Preserve confirmation, locks, triggers, and audit state. |
| `api.teacher_class_assignments` | 5 | `/api/teacher-class-assignments/*` | `MIGRATION_DEFECT` | The frontend uses this CRUD surface. Preserve capability checks and overlap rules. |
| `api.upload_conflicts` | 8 | `/api/upload-conflicts/*` | `MIGRATION_DEFECT` | The frontend uses resolution and retry routes. Preserve conflict state and audit events. |
| `api.uploads` | 8 | `/api/uploads/history*`, missing-records, and sample-template | `MIGRATION_DEFECT` | The frontend uses upload history. Preserve row, timeline, export, and missing-record contracts. |
| `api.uploads` | 1 | `POST /api/uploads/upload` | `INTENTIONALLY_DEPRECATED` | FastAPI marks this route deprecated and returns `410 LEGACY_ATTENDANCE_IMPORT_DISABLED`. |

Remaining migration defects: **89**.

## Legacy `.xls`

The `POST /api/uploads/preview` route is `PARITY_GREEN` for the Phase 0
`.xlsx` contract. Its `.xls` compatibility is not green:

- FastAPI accepts `.xls` in the current preview path.
- The frontend still advertises `.xls`.
- Elysia uses ExcelJS and currently supports `.xlsx` only.
- The repository has no approved deprecation record for the `.xls` preview
  path.

Disposition: `EXPLICIT_FASTAPI_COMPATIBILITY_BLOCKER`.

Phase 10 cannot issue its gate until the `.xls` surface is migrated or an
approved deprecation decision records the replacement and consumer impact.

## OpenAPI disposition

The FastAPI and Elysia OpenAPI documents differ because the 104 unresolved
operations are not registered in Elysia. The matrix explains every difference.
There is no hidden or unknown drift. The OpenAPI gate remains withheld until
the migration-defect rows close and the `.xls` disposition is approved.

FastAPI remains available. The frontend has not cut over. Phase 11 has not
started.
