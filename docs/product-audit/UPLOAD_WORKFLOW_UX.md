# Upload Workflow UX

## Decision

The `/upload` route improves the existing attendance and student-roster preview
and commit services. It does not duplicate import logic, change the database
schema, or persist checkbox state.

## Workflow Modes

Attendance Upload and Student Roster Upload are explicit modes. Student Data
Update remains available as its existing guarded maintenance workflow. Changing
modes unmounts the inactive panel and clears incompatible file, preview,
selection, and result state.

Both primary workflows show:

1. Choose file
2. Preview
3. Resolve issues
4. Commit

The page states that preview does not update the database.

## Source Guidance

Attendance accepts `.xlsx` and `.xls` files with the parser's required columns:
`No. ID`, `Nama`, `Tanggal`, `Scan Masuk`, `Scan Pulang`, `Terlambat`,
`Lembur`, `Pengecualian`, and `week`. Dates use `DD/MM/YYYY`. Device IDs must
already have active student identity links.

Roster accepts `.xlsx` and exposes the existing template endpoint. Required
columns are `student_identifier`, `student_name`, `academic_year`, `jenjang`,
`class_name`, `program`, and `status`. Names alone are not matching keys.

## Eligibility

Attendance selectable classifications are `NEW`, `DIFFERENCE`, and
`UNCHANGED`. `CONFLICT` and `INVALID` are blocked.

Roster selectable classifications are `CREATE_NEW_MASTER` and
`CREATE_ENROLLMENT`. `POSSIBLE_DUPLICATE`, `MISSING_JENJANG`,
`MISSING_CLASS`, and `INVALID` are blocked.

Each workflow has one centralized, pure classification adapter. Unknown
classifications fail closed as blocked. Technical codes remain available in
expandable details, while the primary explanation and recommended action use
operator-readable language.

## Selection And Commit

The header checkbox and **Select eligible** action select all eligible rows in
the complete displayed preview. **Clear selection** removes all selection.
Attendance also provides **Select changed only**, defined as `NEW` and
`DIFFERENCE`. No filtering or pagination is currently applied, so selection
scope is the complete preview.

Selection uses stable backend row identifiers, is deduplicated, and is
intersected with current eligibility before commit. Disabled rows cannot be
selected. The backend independently rejects missing, blocked, stale, or changed
rows.

Roster commit remains bound to its preview checksum. Attendance commit now
submits and verifies the preview's source checksum in addition to existing
batch-state, row-membership, identity, period, and before-state checks.

## Confirmation And Safety

The confirmation panel displays the file, upload type, preview identifier,
selected count, create/change counts, skipped rows, unresolved rows, and invalid
rows. Primary buttons name the exact operation and selected count.

The panel explains that:

- only selected eligible rows are submitted;
- backend validation runs again;
- unresolved rows remain excluded;
- stale previews may be rejected;
- manual attendance overrides remain authoritative;
- commits follow the existing atomic rollback contract.

Attendance import does not create students or device identities. Roster import
does not match by display name alone. Override precedence and finalized-period
rules are unchanged.

## Results And Errors

Successful attendance results show created, changed, unchanged, and unresolved
counts. Successful roster results show students and enrollments created.
Operators can upload another file, review unresolved rows, or open upload
history.

Authentication, authorization, size, validation, stale-preview, server, and
network errors use actionable messages. All-conflict previews have zero eligible
rows and disabled commit controls.

## Accessibility And Responsive Behavior

Modes use semantic tabs. Progress uses an ordered list with `aria-current`.
Inputs have labels, selection uses native or Radix checkbox semantics, the
header supports indeterminate state, and selection/result changes use live
status regions. Blocked rows include textual reasons. Focus styles come from
shared controls.

At narrow widths, forms and action groups wrap. Preview tables use controlled
horizontal scrolling with a minimum table width, preserving the selection and
status columns. The sticky selection toolbar remains visible above long
previews without covering page content.

## Architecture And Validation

No migration or upload-selection table is introduced. Existing preview
sessions, roster batches, attendance batches, upload logs, audit actions, and
commit services remain authoritative. Validation is performed only in Ubuntu
WSL using isolated test databases. The protected `backend/attendance.db` is
inspected only through an immutable read-only SQLite URI and checksum checks.
