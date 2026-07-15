# S3 Database Reconciliation Plan

Date: 2026-07-15  
Decision: Option A — retain the authenticated runtime database as authoritative and reconcile reference-only records through controlled application workflows.

## Decision rationale

`backend/.local-dev/astryx-development.db` is explicitly selected by `start-dev.sh`, contains the persistent authentication state, has the most recent runtime modification time, and passes integrity checks. Replacing it with database B would discard or reconstruct authentication state and conflate two environment histories.

Database B proves that an additional 242-row/10-student upload and 29 mapping assignments existed in another development history. Its data must be treated as reconciliation evidence, not copied as raw SQLite rows.

## Required controlled sequence

1. Keep both databases unchanged and create verified online backups of both immediately before reconciliation.
2. Recover the exact original `absen smp term 4.xls.xlsx` source artifact. Record its SHA-256 checksum and retain it according to the import retention policy.
3. Run the standard authenticated upload preview/validation against database A. Confirm it proposes exactly 242 attendance records and 10 new legacy students, with zero changes to the existing 3,409 logical attendance keys.
4. Stop if the recovered workbook does not reproduce the reference-only identity/date/payload set exactly.
5. Commit the validated upload through the existing import API. Do not copy `students` or `attendance` rows with SQL.
6. Review the 29 reference-only `Primary`/`P1A`/`P1B` assignments against an approved class roster. Reapply approved assignments through the existing mapping API; do not bulk-copy fields from database B.
7. Verify database A now has 117 students and 3,651 attendance rows, with all original runtime row payloads unchanged and zero attendance orphans.
8. Regenerate the authenticated S3 legacy-link preview against database A. Only if it returns 117 safe rows and no ambiguity/conflict may the separately approved S3 link execution resume.

## Answers to the mandatory questions

1. **Which database receives S3?** Database A: `backend/.local-dev/astryx-development.db`, after controlled reconciliation and a fresh preview.
2. **How are the ten missing students handled?** Recreated only by the normal validated attendance upload using the recovered exact source workbook. No direct row copy and no name-only reconstruction.
3. **How are the 242 attendance differences handled?** Imported atomically through the existing attendance ingestion workflow after exact preview parity with database B is proven.
4. **Is controlled import required?** Yes. Direct SQLite merging is prohibited.
5. **What backup is needed?** Separate online SQLite backups of A and B, each validated with `integrity_check`, `foreign_key_check`, file size, timestamp, and SHA-256. A post-import backup is also required.
6. **What verification is required?** Relative count preservation, exact `(student_id,date)` parity, full payload comparison, zero orphans, zero duplicate logical attendance keys, upload-log evidence, identity/mapping review, trigger inventory, full backend tests, and authenticated browser smoke checks.

## Safety properties

- Existing `attendance.student_id` values are never rewritten.
- Authentication remains in database A.
- No audit/history table is copied, dropped, or bypassed.
- Student masters, device identities, and enrollments remain empty until reconciliation completes and S3 is freshly approved.
- The plan uses application contracts compatible with both SQLite development and PostgreSQL production rather than SQLite-specific row copying.

## Current blocker and stop decision

The exact second-import source artifact is unavailable at its recorded filename, and the two databases demonstrably have different identity/migration histories. Under the supplied stop conditions, no reconciliation or S3 linking may execute yet.

Required next approval: recover and identify the exact source workbook, then authorize an authenticated dry-run upload into database A. If the workbook cannot be recovered, a separate reviewed export/import package must be designed; that would be new migration work and is outside this audit task.

