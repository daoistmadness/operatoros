# Student Enrollment Ledger Safety

## Scope and reality audit

This milestone hardens the existing enrollment ledger without implementing bulk promotion, graduation automation, or cross-Jenjang transition automation. The existing single enrollment, bulk enrollment, transfer, end, roster preview/commit, population preview/commit, and class-history workflows remain in place.

The pre-change audit found four destructive gaps:

- `student_enrollments.student_id` used `ON DELETE CASCADE`, coupling institutional enrollment history to a legacy attendance-machine identity.
- `student_subject_grades.enrollment_id` used `ON DELETE CASCADE`.
- the grade enrollment API hard-deleted any enrollment that was not already blocked by a database error;
- manual enrollment required an active `StudentDeviceIdentity`, and transfer did not close the preceding class-history interval.

## Ledger identity and invariants

`StudentMaster` is the stable institutional identity. A partial unique index continues to enforce one `StudentMaster` enrollment per academic year. The legacy `students.id` link is now optional and uses `ON DELETE SET NULL`; adding a device identity later attaches previously unlinked enrollment rows without changing their enrollment IDs.

An enrollment has one current class assignment. Transfer validates the year and Jenjang, closes the prior class-history interval, appends the new interval, updates the enrollment, and commits as one transaction. Cross-Jenjang transfer is rejected with `CROSS_JENJANG_TRANSITION_UNSUPPORTED` until the dedicated transition milestone.

Class history remains immutable except for one permitted operation: closing an open interval by changing `effective_to` from `NULL` to a valid date. Arbitrary updates and all deletes remain blocked by database triggers.

## Lifecycle states

The ledger supports `DRAFT`, `ACTIVE`, `ENDED`, `WITHDRAWN`, `GRADUATED`, and `VOIDED`.

- `ACTIVE` can receive grade activity and owns the current class assignment.
- `ENDED` preserves an ordinary completed historical enrollment.
- `WITHDRAWN` requires an effective date, safe reason code, reason, actor, and confirmation.
- `GRADUATED` requires the same effective-dated audit context and is terminal in this milestone.
- `VOIDED` is limited to erroneous unused records and is terminal.
- reactivation is allowed only from `ENDED` or `WITHDRAWN` into an open academic context and appends a new class interval.

Invalid backward transitions return `INVALID_LIFECYCLE_TRANSITION`. Every successful transition appends a `student_enrollment_lifecycle_audit` row containing enrollment ID, prior and new state, effective date, actor, reason code, and source workflow. SQLite and PostgreSQL triggers make this audit table append-only.

## Deletion and dependency rules

Hard deletion requires `DELETE_UNUSED_DRAFT_ENROLLMENT` and is allowed only when the row is an unassigned `DRAFT` with no class history, grades, interventions, lifecycle audit, import provenance, or linked attendance. Operational rows return a structured `ENROLLMENT_HAS_HISTORY` conflict and direct the operator to a lifecycle action. Database errors and internal table details are not returned to clients.

Grade rows now use `ON DELETE RESTRICT`. Classes, years, Jenjang records, lifecycle audit, class history, interventions, import provenance, and other existing restricted relationships continue blocking historical data loss.

## Academic and device validation

New enrollment rejects closed years, archived classes, and incompatible class/grade/program/Jenjang hierarchies. Candidate exclusion remains academic-year wide, preventing a student already enrolled in one Jenjang from appearing as eligible in another Jenjang for that year.

Academic enrollment no longer requires a biometric or attendance-machine identity. Readiness now reports academic enrollment separately from attendance-machine linking. Device uniqueness and reassignment protections remain unchanged.

## Authorization and confirmation

Enrollment mutation routes remain session-authenticated. Lifecycle changes require `manage_enrollment_lifecycle`; draft deletion requires `delete_enrollment_draft`; transfer retains `transfer_enrollment`. Staff remains read-only. Transfer, end, withdrawal, graduation, reactivation, voiding, and hard deletion each require their explicit confirmation token before mutation.

## Migration

Schema revision `20260722_s40` is an explicit migration from ledger-validated S3.9. Application startup remains fail-closed and is not a migration runner.

- SQLite uses an atomic disposable copy, refuses the protected repository database, requires isolated approval, preserves protected row counts, validates integrity and foreign keys, publishes with `os.replace`, and is idempotent.
- PostgreSQL uses a transaction and equivalent `SET NULL`, `RESTRICT`, lifecycle, audit, and trigger definitions.
- legacy active rows backfill to `ACTIVE`; inactive/ended rows backfill to `ENDED`; existing IDs, dates, grades, attendance, and history are preserved.

The former migration tests that copied `backend/attendance.db` are disabled because that fixture violates the protected-data contract. S4.0 migration coverage creates a synthetic legacy schema from scratch.

## Frontend behavior

`EnrollmentPanel` continues using the existing API infrastructure. It now shows lifecycle state, academic dates, class-history intervals, and device-link readiness separately. End, Withdraw, Graduate, Reactivate, Void, and Delete are distinct actions. Delete is rendered only when the backend reports that hard deletion is safe; otherwise the UI explains that history must be preserved. Lifecycle actions use a focus-managed effective-date and reason dialog, preserve row/form state after recoverable errors, and disable duplicate submission.

Vitest and real-browser checks cover lifecycle state rendering, class history, device-unlinked readiness, deletion restrictions, confirmation focus, and lack of page-level overflow at 390, 768, 1024, and 1366 pixels.

## Validation evidence

- Targeted enrollment/roster/transfer/lifecycle gate: 70 passed.
- Backend full run 1: 509 passed, 30 skipped, 539 collected. The skips are the prohibited protected-database-copy migration fixtures.
- Backend full run 2: 509 passed, 30 skipped, 539 collected, using the validated repository-root environment.
- Bun: 199 tests passed; production build passed.
- Node 22.23.1: 199 tests passed; production build passed.
- E2E validation passed; isolated smoke passed with 4 backend and 12 web tests.
- In-app browser: no console errors, correct dialog focus, and no page-level overflow at the four required widths.
- Protected database: SHA-256 remained `f5dc3fcfca212caa4891e1ba60eca7eb6e926442f6987b479187f3da088102dc`; immutable read-only checks returned `integrity_check=ok`, `quick_check=ok`, and zero enrollments. The final immutable query left the observed WAL/SHM sizes and timestamps unchanged.

All milestone migration and runtime validation used isolated synthetic databases; generated pytest database directories were removed after validation.

## Deferred work

Bulk promotion, automated graduation, automated academic-year rollover, and supported cross-Jenjang transition workflows remain deferred. This milestone supplies the stable identity, lifecycle, migration, authorization, and history foundations those workflows require.
