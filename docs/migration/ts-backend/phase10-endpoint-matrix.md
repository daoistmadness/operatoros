# Phase 10 endpoint matrix

Audit base: `daaa1a8ff052b958be573c15a390e42c6d035d2c`.

Audit commit: Phase 10 route-registration closure slice.

FastAPI remains the reference. The audit used the current application OpenAPI
document and a disposable SQLite database for the Elysia route list.

## Counts

| Measure | FastAPI | Elysia | Result |
| --- | ---: | ---: | --- |
| OpenAPI paths | 282 | 282 candidate routes | Route omissions: 0 |
| Operations | 327 | 327 candidate operations | Route omissions: 0; parity evidence remains incomplete |
| Elysia runtime routes | — | 328 | `/ready` is an Elysia-only readiness route |
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

- The accepted Phase 3 through Phase 9 gates cover the previously migrated
  route groups.
- Analytics, operator-queue, teacher-assignment, student-export, roster, staff-import,
  student-import-session, data-portability, upload-history, attendance-followup, and
  report-builder candidate
  routes are registered and tested on disposable SQLite, but they do not become
  `PARITY_GREEN` until FastAPI-versus-Elysia replay proves them.
- `GET /ready` is `NOT_APPLICABLE`. It is an Elysia foundation route.
- The existing 40-scenario replay remains `40/40 EXACT_MATCH`.

## Remaining matrix

Every row below covers every listed method and path in that family. No route is
unknown.

| FastAPI module | Count | Routes | Classification | Evidence or next action |
| --- | ---: | --- | --- | --- |
| `api.analytics` | 6 | Management-summary exports, historical-trends, and both legacy aliases | `MIGRATION_DEFECT` | Candidate routes exist. Complete dual replay and export parity. |
| `api.attendance_followups` | 17 | `/api/attendance/followups*` | `MIGRATION_DEFECT` | Candidate routes exist. Complete dual replay and preserve the follow-up state machine and history. |
| `api.data_portability` | 8 | `/api/data-portability/*` | `MIGRATION_DEFECT` | Candidate routes exist. Complete dual replay for CSV export, import, templates, and history. |
| `api.operator_work_queue` | 1 | `/api/operator/work-queue` | `MIGRATION_DEFECT` | Candidate route exists. Complete dual replay and capability checks. |
| `api.report_builder` | 12 | `/api/report-builder/*` | `MIGRATION_DEFECT` | Candidate routes exist. Complete dual replay for templates, preview, branding, and exports. |
| `api.staff` | 2 | `/api/staff/imports/history`, `/api/staff/imports/{batch_id}` | `MIGRATION_DEFECT` | Candidate import-history routes exist. Complete dual replay and issue-count parity. |
| `api.student_enrollments` | 2 | Roster preview and commit | `MIGRATION_DEFECT` | Candidate routes exist. Complete roster preview, commit, and dual replay. |
| `api.student_exports` | 2 | `/api/student-exports/preview`, `/api/student-exports/download` | `MIGRATION_DEFECT` | Candidate routes exist. Complete dual replay and sensitive-field authorization checks. |
| `api.student_import_sessions` | 2 | `/api/student-import-sessions/{session_id}/rollback*` | `MIGRATION_DEFECT` | Candidate routes exist. Complete dual replay and rollback safety checks. |
| `api.student_masters` | 6 | Student update preview, commit, history, template, and result workbook | `MIGRATION_DEFECT` | The frontend uses update preview and commit. Preserve checksum and provenance. |
| `api.system` | 1 | `POST /api/system/clear-data` | `MIGRATION_DEFECT` | Candidate route exists. Complete destructive-operation dual replay and audit comparison. |
| `api.teacher_class_assignments` | 5 | `/api/teacher-class-assignments*` | `MIGRATION_DEFECT` | Candidate routes exist. Complete dual replay for overlap and lifecycle behavior. |
| `api.upload_conflicts` | 8 | `/api/upload-conflicts/*` | `MIGRATION_DEFECT` | The frontend uses resolution and retry routes. Preserve conflict state and audit events. |
| `api.uploads` | 10 | Attendance import, upload history, evidence, missing records, and sample template | `MIGRATION_DEFECT` | Candidate routes exist. Complete dual replay for history and evidence contracts. |
| `api.uploads` | 1 | `POST /api/uploads/upload` | `INTENTIONALLY_DEPRECATED` | FastAPI marks this route deprecated and returns `410 LEGACY_ATTENDANCE_IMPORT_DISABLED`. |

Remaining missing operations: **0** plus one deprecated operation. The
candidate families listed above remain parity-blocked until dual replay.

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

The FastAPI and Elysia OpenAPI operation counts now match. The matrix still
uses `MIGRATION_DEFECT` for candidate routes without dual replay evidence.
There is no hidden or unknown route drift. The OpenAPI gate remains withheld
until contract differences are replayed and the `.xls` disposition is approved.

FastAPI remains available. The frontend has not cut over. Phase 11 has not
started.
