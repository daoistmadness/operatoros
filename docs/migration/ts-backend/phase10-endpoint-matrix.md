# Phase 10 endpoint matrix

Audit base: `daaa1a8ff052b958be573c15a390e42c6d035d2c`.

Audit commit: Phase 10 attendance-followup candidate slice.

FastAPI remains the reference. The audit used the current application OpenAPI
document and a disposable SQLite database for the Elysia route list.

## Counts

| Measure | FastAPI | Elysia | Result |
| --- | ---: | ---: | --- |
| OpenAPI paths | 282 | 251 candidate routes | 36 FastAPI operations remain unresolved |
| Operations | 327 | 292 candidate operations | 35 missing operations and one deprecated route remain |
| Elysia runtime routes | — | 293 | `/ready` is an Elysia-only readiness route |
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

- 224 FastAPI operations are `PARITY_GREEN` at route and prior-phase evidence.
- Analytics, operator-queue, teacher-assignment, student-export, roster, staff-import,
  student-import-session, data-portability, upload-history, and attendance-followup candidate
  routes are tested on disposable SQLite, but they do not become
  `PARITY_GREEN` until FastAPI-versus-Elysia replay proves them.
- `GET /ready` is `NOT_APPLICABLE`. It is an Elysia foundation route.
- The existing 40-scenario replay remains `40/40 EXACT_MATCH`.

## Remaining matrix

Every row below covers every listed method and path in that family. No route is
unknown.

| FastAPI module | Count | Routes | Classification | Evidence or next action |
| --- | ---: | --- | --- | --- |
| `api.analytics` | 6 | Management-summary exports, historical-trends, and both legacy aliases | `MIGRATION_DEFECT` | The management-summary candidate exists. Complete dual replay, export parity, and the remaining historical-trends routes. |
| `api.attendance_followups` | 17 | `/api/attendance/followups*` | `MIGRATION_DEFECT` | Candidate routes exist. Complete dual replay and preserve the follow-up state machine and history. |
| `api.report_builder` | 12 | `/api/report-builder/*` | `MIGRATION_DEFECT` | The frontend uses templates, preview, and exports. Port the service contract before cutover. |
| `api.student_enrollments` | 2 | Roster preview and commit | `MIGRATION_DEFECT` | Academic-master preview and roster-template candidates exist. Complete roster preview, commit, and dual replay. |
| `api.student_masters` | 6 | Student update preview, commit, history, template, and result workbook | `MIGRATION_DEFECT` | The frontend uses update preview and commit. Preserve checksum and provenance. |
| `api.system` | 1 | `POST /api/system/clear-data` | `MIGRATION_DEFECT` | The frontend uses this destructive control. Preserve confirmation, locks, triggers, and audit state. |
| `api.upload_conflicts` | 8 | `/api/upload-conflicts/*` | `MIGRATION_DEFECT` | The frontend uses resolution and retry routes. Preserve conflict state and audit events. |
| `api.uploads` | 1 | `POST /api/uploads/upload` | `INTENTIONALLY_DEPRECATED` | FastAPI marks this route deprecated and returns `410 LEGACY_ATTENDANCE_IMPORT_DISABLED`. |

Remaining missing operations: **35** plus one deprecated operation. Candidate analytics, operator-queue, teacher-assignment, student-export, roster, staff-import, student-import-session, data-portability, upload-history, and attendance-followup routes remain parity-blocked until dual replay.

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

The FastAPI and Elysia OpenAPI documents differ because the 36 unresolved
operations are not registered in Elysia. The matrix explains every difference.
There is no hidden or unknown drift. The OpenAPI gate remains withheld until
the migration-defect rows close and the `.xls` disposition is approved.

FastAPI remains available. The frontend has not cut over. Phase 11 has not
started.
