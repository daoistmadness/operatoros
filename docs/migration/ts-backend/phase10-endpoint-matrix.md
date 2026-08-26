# Phase 10 endpoint matrix

Audit base: `daaa1a8ff052b958be573c15a390e42c6d035d2c`.

Audit commit: Phase 10 dual-replay and OpenAPI closure slice.

FastAPI remains the reference. The audit used the current application OpenAPI
document and a disposable SQLite database for the Elysia route list.

## Counts

| Measure | FastAPI | Elysia | Result |
| --- | ---: | ---: | --- |
| OpenAPI paths | 282 | 282 candidate routes | Route omissions: 0; deprecated upload and `/ready` are documented separately |
| Operations | 327 | 327 candidate operations | 326 intended operations match; one deprecated FastAPI operation and one Elysia-only operation remain explicit |
| Elysia runtime routes | — | 328 | `/ready` is an Elysia-only readiness route |
| Unknown operations | — | — | 0 |

The route comparison normalizes only FastAPI `{id:type}` and Elysia `:id`
parameter syntax. It does not ignore methods, aliases, status codes, payloads,
headers, cookies, database state, or audit state.

## Status rules

| Status | Meaning |
| --- | --- |
| `PARITY_GREEN` | The route exists in Elysia and prior phase evidence covers its contract. |
| `DUAL_REPLAY_GREEN` | A representative FastAPI-versus-Elysia replay covers the family contract and side effects. |
| `INTENTIONALLY_DEPRECATED` | FastAPI marks the route deprecated and returns its documented terminal response. |
| `LATER_RUNTIME_ONLY` | The route remains a documented FastAPI runtime surface with approved later ownership. |
| `NOT_APPLICABLE` | The route is not part of the FastAPI contract. |
| `MIGRATION_DEFECT` | The intended FastAPI behavior has no proven Elysia equivalent. |

## Green and non-applicable routes

- The accepted Phase 3 through Phase 9 gates cover the previously migrated
  route groups.
- Analytics, operator-queue, teacher-assignment, student-export, roster, staff-import,
  student-import-session, data-portability, upload-history, attendance-followup, and
  report-builder candidate routes have representative dual replay evidence on
  disposable SQLite.
- `GET /ready` is `NOT_APPLICABLE`. It is an Elysia foundation route.
- The full corpus replay is `54/54 EXACT_MATCH`.

## Remaining matrix

Every row below covers every listed method and path in that family. No route is
unknown.

| FastAPI module | Count | Routes | Classification | Evidence or next action |
| --- | ---: | --- | --- | --- |
| `api.analytics` | 6 | Management-summary exports, historical-trends, and both legacy aliases | `DUAL_REPLAY_GREEN` | `phase10_candidate_analytics`; disposable replay is exact. |
| `api.attendance_followups` | 17 | `/api/attendance/followups*` | `DUAL_REPLAY_GREEN` | `phase10_candidate_attendance_followups`; workflow and history replay are exact. |
| `api.data_portability` | 8 | `/api/data-portability/*` | `DUAL_REPLAY_GREEN` | `phase10_candidate_data_portability`; CSV and history replay are exact. |
| `api.operator_work_queue` | 1 | `/api/operator/work-queue` | `DUAL_REPLAY_GREEN` | `phase10_candidate_operator_queue`; capability and queue replay are exact. |
| `api.report_builder` | 12 | `/api/report-builder/*` | `DUAL_REPLAY_GREEN` | `phase10_candidate_report_builder`; template and export replay is exact. |
| `api.staff` | 2 | `/api/staff/imports/history`, `/api/staff/imports/{batch_id}` | `DUAL_REPLAY_GREEN` | `phase10_candidate_staff_import_history`; issue-count replay is exact. |
| `api.student_enrollments` | 2 | Roster preview and commit | `DUAL_REPLAY_GREEN` | `phase10_candidate_roster`; non-mutating preview replay is exact. |
| `api.student_exports` | 2 | `/api/student-exports/preview`, `/api/student-exports/download` | `DUAL_REPLAY_GREEN` | `phase10_candidate_student_exports`; authorization and audit replay is exact. |
| `api.student_import_sessions` | 2 | `/api/student-import-sessions/{session_id}/rollback*` | `DUAL_REPLAY_GREEN` | `phase10_candidate_student_import_rollback`; fail-closed replay is exact. |
| `api.student_masters` | 6 | Student update preview, commit, history, template, and result workbook | `DUAL_REPLAY_GREEN` | `phase10_candidate_student_update_history`; provenance replay is exact. |
| `api.system` | 1 | `POST /api/system/clear-data` | `DUAL_REPLAY_GREEN` | `phase10_candidate_system_clear_data`; destructive gates replay is exact. |
| `api.teacher_class_assignments` | 5 | `/api/teacher-class-assignments*` | `DUAL_REPLAY_GREEN` | `phase10_candidate_teacher_assignments`; lifecycle replay is exact. |
| `api.upload_conflicts` | 8 | `/api/upload-conflicts/*` | `DUAL_REPLAY_GREEN` | `phase10_candidate_upload_conflicts`; empty-state replay is exact. |
| `api.uploads` | 10 | Attendance import, upload history, evidence, missing records, and sample template | `DUAL_REPLAY_GREEN` | `phase10_candidate_upload_history`; history and evidence replay is exact. |
| `api.uploads` | 1 | `POST /api/uploads/upload` | `INTENTIONALLY_DEPRECATED` | FastAPI marks this route deprecated and returns `410 LEGACY_ATTENDANCE_IMPORT_DISABLED`. |

Remaining missing operations: **0** plus one intentionally deprecated operation.
All 14 candidate families have dual replay evidence.

## Legacy `.xls`

The `POST /api/uploads/preview` route is green for both workbook formats:

- FastAPI accepts `.xls` in the current preview path.
- The frontend still advertises `.xls`.
- Elysia uses ExcelJS for `.xlsx` and `@e965/xlsx` for legacy BIFF8 `.xls`.
- Both adapters emit the existing normalized attendance workbook model.

Disposition: `MIGRATED_TO_ELYSIA`.

Parser: `@e965/xlsx` `0.20.3` (`Apache-2.0`).

The Phase 6 replay covers `.xlsx` preview/apply and `.xls` preview/apply.

## OpenAPI disposition

The full-app Elysia OpenAPI document uses the accepted FastAPI public contract
for request, response, status, cookie, and security declarations. The
executable contract test compares 326 intended operations and 159 schemas.
The deprecated FastAPI upload operation is absent. Elysia-only `/ready` is
outside the FastAPI contract. No unexplained OpenAPI drift remains.

FastAPI remains available. The frontend has not cut over. Phase 11 has not
started.
