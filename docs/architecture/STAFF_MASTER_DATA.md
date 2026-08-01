# Employee master data and audited import

## Current audit (`EMPLOYEE_SCHEMA_AUDIT`)

The application has no reusable person, employee, or staff master table. `student_masters` is student-specific and is not reused. Authenticated identities live in `users` and `sessions`, with no user-to-person relationship; the employee import does not create accounts. Existing import provenance is student-oriented (`student_import_sessions`, batches, rows, and applied actions). Existing append-only operational audit events remain the correct place for batch-level audit events.

The recommended integration is the separate staff extension implemented here: `staff_members`, `staff_identifiers`, `staff_contact_details`, `staff_import_batches`, `staff_import_rows`, `staff_import_issues`, and reviewable `staff_job_title_mappings`. It is additive to S4.3 and is recorded in `staff_schema_migrations`; the core S4.3 ledger is not advanced.

## Source mapping and privacy

The Edelweiss workbook maps `Id Staff` to `INTERNAL_STAFF_ID`, `STATUS` to `ACTIVE` or `FORMER`, and preserves raw job titles and Dapodik values alongside cautious normalized values. `Umur` and `Masa Kerja` are formula-derived display fields and are not imported. Excel dates are converted to ISO dates. All identifiers are stored as text; precision-risk and length issues remain visible and values are never truncated. Duplicate identifiers and possible same-person matches are review-only and are never merged automatically.

Raw import rows contain sensitive source values and are restricted to the database. CLI output, audit summaries, and ordinary directory responses contain counts, hashes, issue codes, and masked identifiers only. The source workbook, populated databases, staff CSVs, screenshots, and PII-bearing logs must remain outside Git.

## Commands

Validation is read-only and does not use `DATABASE_URL`:

```bash
PYTHONPATH=backend/src backend/.venv/bin/python -m core.staff_import validate \
  --file /absolute/path/to/staff.xlsx --sheet "Data Karyawan Edelweiss"
```

Application requires an existing current S4.3 disposable/development database, an absolute path, and explicit confirmation:

```bash
PYTHONPATH=backend/src backend/.venv/bin/python -m core.staff_import apply \
  --file /absolute/path/to/staff.xlsx --sheet "Data Karyawan Edelweiss" \
  --database /absolute/path/to/disposable.db --confirm-import
```

The command rejects the protected operational database, ephemeral session databases, non-S4.3 databases, and repeated file hashes. It never creates user accounts, adopts historical sessions, or changes student import behavior. Rollback is removal of the additive staff extension from a disposable database or restoration from the approved database backup under the normal operations procedure; do not run rollback against `backend/attendance.db`.
