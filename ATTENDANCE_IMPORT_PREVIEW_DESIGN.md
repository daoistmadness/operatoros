# Attendance Import Preview Design

## Contract

`POST /api/uploads/preview` is administrator-only. It reads an `.xls` or `.xlsx` workbook and persists only an import batch plus staging rows. It never creates, updates, deletes, or relinks `students`, `attendance`, attendance overrides, or student-master records.

Each staged logical row carries source row, device student identifier, student name, attendance date, existing attendance ID, a before snapshot, a proposed snapshot, validation information, and one classification:

- `NEW`: no attendance exists for the incoming student/date key.
- `UNCHANGED`: proposed and stored attendance payloads are identical.
- `DIFFERENCE`: the key exists and at least one import-managed value differs.
- `CONFLICT`: identity mismatch or divergent duplicate source rows require human resolution.
- `INVALID`: required identity/date data cannot be parsed.

An identical duplicate student/date row is collapsed to one logical row and carries a warning. A divergent duplicate is blocked as `CONFLICT`. A new device ID using an existing student's name is also blocked; preview never invokes the legacy foreign-key rewrite.

## Persistence

- `attendance_import_batches` records source metadata, SHA-256, administrator, timestamp, lifecycle state, classification totals, and an idempotent commit result.
- `attendance_import_rows` records the review payload and references existing attendance with `ON DELETE RESTRICT`.
- Both SQLite and PostgreSQL receive additive, dialect-specific migrations.
- Runtime `create_all` imports the models so new local installations create these tables without destructive compatibility work.

## Commit protocol

`POST /api/uploads/preview/{batch_id}/commit` is administrator-only and requires:

- an explicit non-empty list of staging row IDs;
- the exact token `COMMIT_ATTENDANCE_IMPORT`;
- a batch still in `preview` state;
- only `NEW`, `UNCHANGED`, or `DIFFERENCE` rows;
- unchanged student identity and attendance before-snapshots.

The service creates genuinely new students, applies selected attendance rows, writes one `upload_logs` audit record, stores the commit result, and marks the batch committed in one database transaction. Any error rolls the entire transaction back. A repeated request for a committed batch returns the stored result without another write.

Administrative overrides are never deleted or edited. Preview warns when an underlying attendance row has an override; commit changes only the base attendance payload selected by the administrator.

## Operational boundary

Preview metadata contains student identifiers and names, so both preview and commit are administrator-only. The preview response may be used by a future UI; no frontend was required for this phase. The legacy direct upload route is unchanged to avoid an unrequested public API break.

