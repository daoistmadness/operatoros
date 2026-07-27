# Upload Conflict Browser Regression

PR #19 left the exact sequential browser scenario as a documented validation
gap. The canonical smoke fixture now creates two attendance conflicts,
`991001` and `991002`, plus one roster `POSSIBLE_DUPLICATE` in its disposable
database.

## Fresh-install root cause

The blocker was classified as `FRESH_INSTALL_SCHEMA_DRIFT`.
`operations_audit_events` is owned by
`models.operations_audit.OperationsAuditEvent` and is required by the conflict
queue's durable resolution-state lookup. Normal application startup imported
that model, but the explicit fresh initializer omitted
`models.operations_audit` from `core.schema_migrations.MODEL_MODULES` before
calling `Base.metadata.create_all()`.

The repair registers the existing model in that canonical model manifest. It
does not add a migration or change the schema version. A fixture-local
`CREATE TABLE`, broad `OperationalError` handling, and an empty-queue fallback
were rejected because each would conceal fresh-install schema drift.

`test_fresh_database_bootstrap_supports_upload_conflict_queue` initializes an
empty database through `initialize_fresh_sqlite_database`, verifies required
audit columns and `ix_ops_audit_operation_occurred`, creates a real attendance
conflict, and exercises `list_upload_conflicts()`.

The fixture uses `core.database.SessionLocal`,
`services.attendance_import_preview.create_attendance_preview`, and
`services.excel_parser.REQUIRED_COLUMNS`. Preflight asserts the canonical
`Pengecualian` and lowercase `week` headers, conflict classifications, source
rows, checksums, and derived queue entries before the browser starts.
Legacy `Student` and `StudentMaster` records retain one-to-one parity. The
legacy IDs and uploaded device IDs are deterministically `991001` and `991002`,
names match their masters, historical fixture mappings are inactive, and both
targets have active enrollments.

`e2e/smoke/web/upload-conflict-regression.spec.ts` proves in one browser
lifecycle that:

- `991001` supports stable-student selection, explicit retry preview, eligible
  row selection, provenance review, and selected-row commit;
- opening `991002` resets search, candidate, mutation, retry, commit, and error
  state;
- roster duplicate comparison is visible and requires explicit stable-student
  selection;
- the 390 pixel layout has no document-level horizontal overflow.

The shared Radix dialog tests retain focus-trap and focus-restoration coverage.
The item-keyed component prevents obsolete item responses from updating a newly
opened dialog. Other canonical responsive smoke specs cover 768, 1024, and 1366
pixel layouts.

Browser screenshots, traces, logs, uploads, and synthetic databases remain
temporary E2E artifacts and are removed after validation. Desktop
infrastructure remains an explicit existing-infrastructure skip. The protected
database is never opened by the fixture or browser stack and is verified by
immutable read-only inspection. No schema change is introduced.

## Validation evidence

- Focused fresh-schema and upload-conflict tests: 13 passed, 16 expected skips.
- Complete backend run 1: 653 passed, 30 skipped in 815.78 seconds.
- Complete backend run 2: 653 passed, 30 skipped in 858.98 seconds.
- E2E backend: 7 passed.
- E2E web: 14 passed, including the sequential conflict regression.
- Desktop: skipped because existing desktop infrastructure is unavailable; no
  desktop product failure was reproduced.
- Protected-database writable access: zero.

The web run verified explicit eligible-row retry selection and commit, a fresh
`991002` search after completing `991001`, no link/retry/commit state leakage,
roster `POSSIBLE_DUPLICATE` comparison, and the 390 pixel responsive layout.
