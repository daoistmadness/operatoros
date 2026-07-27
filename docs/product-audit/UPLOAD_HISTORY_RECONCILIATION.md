# Upload History Reconciliation

## Decision

The selected design is `DERIVED_RECONCILIATION_FROM_EXISTING_RECORDS`.

No schema migration is introduced. The service derives read-only history from:

- `attendance_import_batches` and stable `attendance_import_rows`;
- `academic_roster_import_batches`;
- `student_import_sessions` and immutable `student_import_applied_actions`;
- allowlisted projections of `operations_audit_events`.

Historical evidence that is absent or ambiguous remains `null` and produces
`INCOMPLETE`. It is never inferred as zero.

## Equations

Attendance preview:

`preview_total = eligible (NEW + DIFFERENCE + UNCHANGED) + conflict + invalid`

Attendance commit:

`selected_total = committed_total + skipped_total + protected_total + failed_total`

`committed_total = rows_inserted + rows_updated + rows_unchanged`

Roster preview:

`preview_total = eligible (CREATE_ENROLLMENT + CREATE_NEW_MASTER) + blocked + invalid`

Roster commit:

`selected_total = created_total + updated_total + skipped_total + failed_total`

Preview duplicate and conflict classifications are excluded from selected-row
commit equations because the canonical commit services prohibit their
selection. Selected evidence is read from durable selection flags for
attendance and the import session plus applied source-row actions for roster.
Eligibility is never treated as proof of selection or commit.

Retry totals are isolated from original commit totals. Retry attempts and
committed conflict references come only from allowlisted conflict audit events.
A row already counted in the original commit is not counted again.

## Truthfulness States

- `BALANCED`: all applicable equations can be proved.
- `BALANCED_WITH_UNRESOLVED`: equations balance and canonical conflicts remain.
- `INCOMPLETE`: required historical evidence is absent or an unknown event may
  affect totals.
- `INCONSISTENT`: persisted totals violate a provable equation.
- `UNKNOWN`: the workflow state cannot be safely interpreted.

When a roster import session has rollback state `APPLIED`, successful committed,
created, and updated totals are reported as zero and the status is
`ROLLED_BACK`. Partial or failed rollback states do not erase committed claims.

## Timeline And Rows

The timeline combines synthetic file/preview/selection/commit milestones with
an allowlist of conflict-resolution and retry events. It exposes only actor,
timestamp, safe reference, safe counts, reason code, and operator-facing text.
Unknown events remain visible as `ADDITIONAL_HISTORICAL_ACTIVITY` and make
reconciliation incomplete.

Row outcomes use stable database or preview references. Source row number is
informational only. Identifiers are masked, names and raw spreadsheet payloads
are excluded, and unknown selection or commit evidence fails closed.

## Evidence Exports

CSV and JSON are separate deterministic downloads. Both contain reconciliation,
timeline, and row-outcome sections. JSON uses format version `1.0` and includes
a SHA-256 content manifest. CSV uses UTF-8, CRLF line endings, fixed headers,
stable ordering, string-preserving output, and prefixes values beginning with
`=`, `+`, `-`, or `@` with an apostrophe.

Exports exclude original workbooks, full local paths, raw rows, unmasked
identifiers, secrets, exceptions, and unrestricted audit metadata.

## Authorization And Safety

Every list, detail, timeline, row, and export route requires the existing
`view_student_audit` capability before record lookup or export generation.
Upload references are workflow-prefixed UUIDs.

The center is read-only. It provides no replay, recommit-all, restore, undo,
attendance reversal, source mutation, or audit editing. Related conflict links
enter the existing Needs Attention workflow.

Validation runs only in Ubuntu WSL against synthetic test databases. The
protected `backend/attendance.db` is inspected only through immutable SQLite
and is never used by application tests, exports, migrations, or E2E.
