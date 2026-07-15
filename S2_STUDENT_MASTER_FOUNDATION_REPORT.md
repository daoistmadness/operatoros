# S2 Student Master Foundation Report

Date: 2026-07-15  
Status: Implemented; S3 import execution intentionally not started.

## Outcome

S2 adds a canonical student identity foundation alongside the legacy attendance identity. It does not rewrite `attendance.student_id`, does not auto-create master records from ambiguous legacy names, and does not delete or transform existing data.

## Delivered foundation

- `student_masters` uses application-generated UUID strings as stable primary keys. NIPD, NISN, NIK, and device identifiers remain strings so leading zeroes are retained.
- Duplicate student names are allowed. Non-null NIPD, NISN, and NIK values have independent partial unique indexes.
- `student_device_identities` records device/source mappings with effective dates, an active-state constraint, and `ON DELETE RESTRICT` links to both the master and optional legacy student.
- Address, contact, parent/guardian, health, and document-status data are separated into profile tables. This avoids exposing high-sensitivity fields through ordinary list queries.
- `student_import_batches` and `student_import_rows` provide preview/classification persistence for a later import workflow. No S3 matching or commit operation is implemented in this phase.
- `student_master_change_history` is append-only at database level. Both it and `attendance_override_history` reject UPDATE and DELETE while allowing INSERT.
- `student_enrollments.student_master_id` is nullable and additive. The existing required `student_id` contract remains intact for backward compatibility.
- Canonical read routes are registered under `/api/student-masters`. Authentication is required; identifiers are masked; device identity history is admin-only; contact, guardian, health, and raw document data are not exposed.

## Migration behavior

The SQLite and PostgreSQL 16 migration definitions are additive and use `CREATE ... IF NOT EXISTS` for foundation objects. PostgreSQL uses `ADD COLUMN IF NOT EXISTS` for the enrollment link. SQLite adds that column through the inspected startup compatibility patch because SQLite has no portable `ADD COLUMN IF NOT EXISTS` equivalent.

Startup imports the new models before `create_all`, then applies the inspected compatibility patch and restores canonical append-only triggers. Repeated SQLite migration execution is covered by a test.

## Normalization contract

The foundation provides deterministic normalization for names, identifiers, gender, phone values, birth dates, religion, and kelurahan. Dates accept only explicit `YYYY-MM-DD` or `DD/MM/YYYY` inputs. Invalid gender, phone, and date inputs fail closed instead of being guessed.

Import-row JSON is a staging boundary, not a public response shape. Future S3 services must store only normalized/masked values there when a value is sensitive; raw source files require an independently approved retention and protection policy.

## Deferred decisions

- Legacy-to-master backfill is deliberately deferred. The approved S1 architecture requires reviewable matching rather than automatic name-based identity creation.
- Enrollment creation remains on the legacy required `student_id` path until S3 supplies an explicit, reviewed bridge workflow.
- Write APIs for student profiles and import commit are outside S2.
- Encryption-at-rest and retention policy for source import artifacts require a deployment-level decision before raw sensitive payloads may be persisted.

## Verification

- Focused S2 tests: 8 passed.
- Guarded reset regression tests after trigger-name remediation: 7 passed.
- Full backend run initially found 2 reset regressions because the reset route dropped only the pre-S2 trigger names. The route now drops and re-establishes the canonical trigger names for SQLite and PostgreSQL. Final full backend result: 314 passed.
- PostgreSQL migration is statically checked for boolean-safe syntax, `ON DELETE RESTRICT`, and idempotent enrollment-column syntax. A live PostgreSQL service was not available in this workspace, so execution against PostgreSQL remains a release-environment verification item.

## Files of record

- `backend/src/models/student_master.py`
- `backend/src/services/student_normalization.py`
- `backend/src/api/student_masters.py`
- `backend/migrations/20260716_student_master_foundation_sqlite.sql`
- `backend/migrations/20260716_student_master_foundation_postgresql.sql`
- `backend/tests/test_student_master_foundation.py`
