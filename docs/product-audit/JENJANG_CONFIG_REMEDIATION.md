# Jenjang Cutoff Configuration Remediation

**Workstream**: Jenjang Config status messaging, setup-boundary guidance, validation clarity, and permission-aware actions
**Branch**: `feature/product-audit-remediation`
**Date**: 2026-07-20
**Status**: COMPLETE

## Original findings and root causes

The `/config/jenjang` page was labeled as a general Jenjang configuration surface even though it edits only the legacy `jenjang_config` lateness-cutoff table. Available rows are derived from distinct `students.jenjang` values; the page does not create or edit the seeded, read-only `jenjangs` academic master.

The old page also:

- showed “complete” whenever the API-reported `unconfigured` array was empty, without validating either response;
- treated the absence of student-derived jenjang values as a class-mapping failure;
- exposed mutation controls to every authenticated role while the backend endpoints had no authorization dependency;
- enabled Save without a dirty-state check;
- allowed same-turn duplicate submissions;
- rendered raw backend validation details;
- updated local state optimistically and displayed success without confirming authoritative server state;
- did not distinguish permission denial, malformed data, blocking load errors, incomplete configuration, or partial responses.

Affected surfaces are `frontend/src/pages/JenjangConfig.jsx`, its navigation label, `/api/config/jenjang...`, authorization tests, and responsive smoke coverage. Downstream consumers include attendance ingestion through `services/excel_parser.py`; class, enrollment, analytics, and reporting use the separate canonical academic master and enrollment structures.

## Canonical terminology

The product term for the academic master remains **Jenjang**, backed by the seeded `jenjangs` table. This workstream calls the legacy setting **Cutoff Keterlambatan per Jenjang** or **Cutoff Jenjang**. It never presents `jenjang_config` as the master academic structure.

## Deterministic state model

Page-state precedence is:

1. `PERMISSION_RESTRICTED`: a read request returns 403;
2. `LOADING_INITIAL`: the first authoritative request is pending;
3. `ERROR_BLOCKING`: loading fails or either response is malformed/invalid;
4. `EMPTY_UNCONFIGURED`: no student-derived jenjang values exist;
5. `READY_INCOMPLETE`: one or more available jenjang values lack a cutoff;
6. `READY_WITH_WARNINGS`: configured and available data can render, but server-reported completeness is inconsistent;
7. `READY_COMPLETE`: every available jenjang has a valid cutoff;
8. mutation feedback: saving/deleting, confirmed success, validation failure, conflict, permission denial, or recoverable failure.

Blocking states are mutually exclusive with the configuration table. Recoverable mutation failures preserve the editor and entered value. Success appears only after a refetch confirms the saved or deleted state.

## Configuration health and actions

- `NOT_CONFIGURED`: no student-derived jenjang is available; administrators are linked to Student Data while read-only users receive guidance.
- `INCOMPLETE`: specific missing jenjang names are listed.
- `VALID`: every row has a valid `HH:MM` cutoff.
- `WARNING`: server completeness metadata disagrees with the derived row status; mutation is disabled pending reload.
- `INVALID`: malformed rows, duplicate definitions, invalid times, or malformed containers block rendering.
- `IN_USE`: available names originate from student records and the cutoff affects subsequent attendance processing.
- `INACTIVE`: not represented by this legacy API; academic-master active status belongs to the separate `jenjangs` domain.

Authenticated users can view. Administrators can create/update and delete cutoff rows. Staff receive a read-only explanation and no focusable mutation controls. Deleting a cutoff does not delete Jenjang, students, enrollments, attendance, or history; after confirmation it restores the automatic cutoff fallback.

## Setup dependencies

The setting requires a non-empty Jenjang value in student data. It affects lateness evaluation during attendance processing. Canonical class setup, academic-year filters, enrollment, Grade Ledger, Management Analytics, promotion, and reporting depend on the separate academic-master/enrollment model and are not blocked by this optional cutoff page.

The empty-state CTA routes authorized administrators to `/students`. It is omitted for read-only users. The copy explicitly directs users away from confusing this page with master Jenjang management.

## Save, validation, and error behavior

The inline form initializes from the last authoritative response and tracks its original cutoff. Save is disabled when unchanged, invalid, already submitting, inconsistent server data is present, or the user is read-only. A synchronous mutation guard prevents duplicate same-turn submissions.

Invalid times have field-associated help and error text. Validation focuses the cutoff input when invoked with invalid data. HTTP 401, 403, 409, validation errors, server errors, and malformed responses receive bounded user-facing messages; raw backend detail is not rendered. A successful PUT or DELETE is followed by a refetch and reconciliation before success is announced.

## Accessibility and responsive coverage

Loading and success feedback use status semantics; errors and permission failures use alert semantics. Controls are native labeled inputs and buttons, icon decoration is hidden from assistive technology, field errors use `aria-invalid` and `aria-describedby`, and read-only actions are absent rather than disabled focus targets.

The status header and actions wrap on narrow screens. The table uses intentional local horizontal scrolling with no body overflow. Browser smoke coverage checks 390×844, 768×1024, 1024×768, and 1366×768.

## Tests and safety

Targeted frontend coverage exercises loading, complete, empty, incomplete, warning/partial, blocking failure and retry, permission restriction, read-only access, dirty Save behavior, authoritative refetch, duplicate-submit prevention, deletion guidance, malformed/duplicate payloads, and error sanitization. Shared Management Analytics state tests and legacy API route contracts remain covered.

Targeted backend coverage verifies anonymous read denial, authenticated staff read access, staff mutation denial, and admin access reaching domain validation. Complete frontend, backend, build, and bounded E2E results are recorded at closeout.

The protected `backend/attendance.db` is never opened writable. Validation uses isolated test databases and E2E-generated synthetic fixtures.

## Deferred items

Navigation density, broad terminology harmonization, onboarding, native Tauri coverage, canonical academic-master redesign, and unrelated administration-area UI work remain deferred.
