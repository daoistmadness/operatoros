# TypeScript Backend Phase 2–5 Endpoint Matrix

Base: `7c3dfb6f7531f77346904d3bf45f0329791d5bb1`

Branch: `codex/ts-backend-phase2-5`

PR: `#53`

The matrix uses the Phase 0 dual replay harness. The replay compares status,
payload, cookies, database state, and audit state. The harness normalizes only
timestamps, environment paths, request metadata, and cookie flag casing.

## Phase 2 prerequisite

Status: `READY`.

The branch uses the S4.3 manifest and fingerprint from the accepted Phase 2
data layer. The connection opens disposable SQLite databases only. It rejects
the protected `attendance.db` basename before opening. It validates foreign
keys, schema identity, migration identity, required indexes, and required
triggers. Transaction rollback and missing-trigger rejection have focused
tests.

## Phase 3

| Endpoint group | FastAPI routes | Elysia routes | Status |
| --- | --- | --- | --- |
| Authentication | `POST /api/auth/login`; `POST /api/auth/logout`; `GET /api/auth/me` | Same | `MIGRATED_PARITY_GREEN` |
| Setup | `GET /api/setup/status`; `POST /api/setup/bootstrap`; `POST /api/setup/admin` | Same | `MIGRATED_PARITY_GREEN` |

Phase 0 auth replay: 13 exact matches. The session cookie is `astyx_session`.

## Phase 4

| Endpoint group | FastAPI routes | Elysia routes | Status |
| --- | --- | --- | --- |
| Academic masters | `/api/academic-masters/{academic-years,jenjangs,programs,grades,classes}` GET/POST/PUT/DELETE | Same | `MIGRATED_PARITY_GREEN` |
| Academic configuration | `/api/config/jenjang*`; `/api/config/heb*`; `/api/academic-config/terms*`; `/api/academic-config/kkm-*`; `/api/config/deployment-mode` | Same | `MIGRATED_PARITY_GREEN` |
| Legacy students | `/api/students`; `/api/students/{set-class,assign-class,classes,all}` and legacy `/students` equivalents | Same | `MIGRATED_PARITY_GREEN` |
| Canonical student read and subrecords | `/api/student-masters`; `/{id}`; `/{id}/profile`; `/{id}/health`; `/{id}/documents`; `/{id}/guardians*`; `/{id}/history`; `/{id}/device-identities` | Same | `MIGRATED_PARITY_GREEN` |
| Canonical student management | `/api/student-masters/management/list`; `/management/quality`; `/management/export.csv` | Same | `MIGRATED_PARITY_GREEN`; XLSX template, update preview/commit, import history, and result workbook remain later |
| Canonical legacy linking | `/api/student-masters/legacy-link/{preview,commit,resolve}`; `/{id}/legacy-link*` | Same | `MIGRATED_PARITY_GREEN` |
| Device reassignment | `/api/student-masters/{id}/device-identities/reassign` | Same | `MIGRATED_PARITY_GREEN` |
| Staff CRUD | `/api/staff`; `/{id}`; `/{id}/education*`; `/{id}/jenjangs` | Same | `MIGRATED_PARITY_GREEN` |
| Staff export and imports | `/api/staff/export`; `/api/staff/{id}/sensitive`; `/api/staff/imports/*` | Export and sensitive routes | `MIGRATED_PARITY_GREEN` for export and sensitive read; import batch history remains later with staff workbook import |
| Enrollment base and lifecycle | `/api/student-enrollments/student/{id}`; `/{id}/{transfer,end,deletion-status}`; `/{id}/{withdraw,graduate,reactivate,void}` | Same | `MIGRATED_PARITY_GREEN` |
| Enrollment population and roster | `/api/student-enrollments/{mapping-preview,populate/*}` | Same | `MIGRATED_PARITY_GREEN`; academic-master preview and XLSX roster/template routes remain later with roster import |
| Student attendance profile | `/api/students/{id}/attendance-summary`; `/api/students/{id}/monthly-history` | Same | `MIGRATED_PARITY_GREEN` |
| Student creation and operations | `POST /api/students`; `GET /api/students/operations` | Same | `MIGRATED_PARITY_GREEN` |

Phase 0 academic placement replay: 3 exact matches. Local core tests cover the
academic hierarchy, canonical identity separation, staff records, management
exports, legacy mapping preview, and base enrollment lifecycle.

## Phase 5

| Endpoint group | FastAPI routes | Elysia routes | Status |
| --- | --- | --- | --- |
| Scoped attendance | `/api/attendance/classes/assigned`; `/api/attendance/classes/{class}/dates/{date}`; `/entries` | Same | `MIGRATED_PARITY_GREEN` |
| Attendance review | `/api/review/classes`; `/api/review/attendance`; override; history; mass override | Same | `MIGRATED_PARITY_GREEN` |
| Corrections and periods | `/api/attendance-corrections`; request lifecycle; period finalize/reopen/status | Same | `MIGRATED_PARITY_GREEN` |
| Early departure | `/api/attendance/departure-policies*`; departures; excuses; history | Same | `MIGRATED_PARITY_GREEN` |
| Attendance rules | Status, lateness, late source, cutoff, and departure pure functions | `src/domains/attendance-rules.ts` | `MIGRATED_PARITY_GREEN` |
| Absence reasons | `/api/config/absence-reasons*` | Same | `MIGRATED_PARITY_GREEN` |
| Attendance follow-ups | `/api/attendance/followups*` | Not migrated | `INTENTIONALLY_LATER_PHASE`; this workflow is outside the Phase 5 acceptance order and has no Phase 0 follow-up golden corpus |

Phase 0 attendance review and correction replay: 10 exact matches. The full
corpus adds 17 exact database-integrity matches. The remaining 10 candidate
defects are backup/restore and reports endpoints. Those belong to later
milestones. FastAPI self-replay is 40 exact matches. Deliberate mismatch
injection classifies all 40 scenarios as `MIGRATION_DEFECT`.

## Intentionally later

The following endpoint groups are outside Phases 3–5:

- `/api/admin/backups/*` and restore operations.
- `/api/reports/*`, `/api/report-builder/*`, and analytics exports.
- Excel workbook parsing and import routes.
- Grades, interventions, progression, scheduler, and frontend cutover.

The gates remain withheld while any required Phase 3–5 row is not green. Rows
marked intentionally later do not block these gates.
