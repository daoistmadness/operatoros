# S3 Enrollment Population Report

Date: 2026-07-15  
Status: Workflow implemented; live business-data commit awaiting approval.

## Implemented workflow

- Administrator-only legacy-link preview, reviewed commit, and manual-resolution APIs.
- Deterministic priority for existing active mappings, explicit evidence, and normalized-name candidates. Name-only candidates are never auto-linked.
- Safe auto-create copies only the legacy display name and creates a pending-review master plus effective-dated `legacy_students` device identity.
- Administrator-only enrollment preview and commit APIs with persisted checksum evidence.
- Enrollment commits require a canonical master, canonical jenjang, non-empty class, and an academic-year-valid effective date.
- One canonical enrollment per academic year is protected by a partial unique index.
- Initial class assignments are written to append-only `student_enrollment_class_history`.
- Legacy `students.jenjang` and `students.class_name` remain unchanged and are used only as proposal inputs.

## Live preview evidence

Legacy link preview:

- Reference: `9f2c53cb-afa2-4558-9456-bd3191a68ad5`
- Checksum: `3ec738ee234cfdf789bfac71e05169602925dbd2da2c03b12c7940c81e05a645`
- `SAFE_AUTO_CREATE=117`; every other classification is zero.
- Masters created: 0.
- Links created: 0.
- Conflicts deferred: 0.

Enrollment preview before linking:

- Reference: `d559c223-0b33-4fa5-b483-98e77f97dadc`
- Checksum: `247378582d0a580fcc203a1287231957f14eab12e90f4faa1a2c290d209ee338`
- `MISSING_MASTER_LINK=117`; all other classifications are zero.
- Enrollments created: 0.

If the reviewed 117 safe links are later approved and committed, a new enrollment preview is required. Based on current immutable preview inputs, 29 rows have exact `Primary` plus `P1A/P1B` mappings and should become enrollment candidates; 88 will remain blocked for missing jenjang/class. This is a forecast, not a committed result.

## APIs

- `POST /api/student-masters/legacy-link/preview`
- `POST /api/student-masters/legacy-link/commit`
- `POST /api/student-masters/legacy-link/{legacy_student_id}/resolve`
- `POST /api/student-enrollments/populate/preview`
- `POST /api/student-enrollments/populate/commit`

Confirmation tokens are `LINK_LEGACY_STUDENTS_TO_MASTERS` and `POPULATE_STUDENT_ENROLLMENTS`.

## Migration and compatibility

Both dialect migrations are additive. SQLite uses inspected startup additions for the two enrollment date columns because it lacks portable `ADD COLUMN IF NOT EXISTS`; PostgreSQL uses explicit idempotent column additions. Class history is protected by UPDATE/DELETE triggers in both dialects.

No frontend was added because the approved S3 plan marks it optional. API authorization and workflow behavior are covered by backend integration tests; browser UI verification is therefore not applicable in this phase.

PostgreSQL received static SQL contract verification only; no live PostgreSQL service was available. S4 is not ready until the live safe-link decision is reviewed and, if approved, linking and enrollment post-integrity evidence is captured.

Verification results: 323 backend tests passed, including 9 new S3 workflow/integrity tests. Python compilation and `git diff --check` also passed. Existing API/report/configuration compatibility is covered by the unchanged full regression suite.
