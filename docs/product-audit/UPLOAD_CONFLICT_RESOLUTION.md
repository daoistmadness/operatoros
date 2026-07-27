# Upload Conflict Resolution

## Architecture decision

**Selected design:** `EXISTING_LOGS_REQUIRE_SAFE_EXTENSION_WITHOUT_SCHEMA`

No schema migration is required. Attendance preview rows already persist source
session, checksum, row number, device identifier, date, classification, and
commit selection. Roster batches persist the source session, checksum, source
row, classification, safe input payload, and applied-action evidence.
`operations_audit_events` supplies durable resolution and retry evidence.

Future unmatched attendance previews retain a sanitized `_retry_source` envelope
in the existing `proposed_change` JSON. It contains only canonical parser output
needed to rerun validation. Historical rows without this envelope remain visible
but fail closed as non-retryable.

## Derived queue

`GET /api/upload-conflicts` derives queue items from persisted attendance preview
rows and roster batches. It supports workflow, technical code, resolution
status, source session, retry eligibility, date-range, and pagination filters.
Items are ordered unresolved first, then newest session, then source row.
Unknown classifications remain unresolved and non-retryable.

The API returns safe source provenance: filename, stable session ID, source row,
content checksum, creation time, classification, and safe affected identifiers.
It does not return source paths, raw spreadsheet rows, guardian contacts,
password data, or hidden audit payloads. The frontend displays only a checksum
prefix while sending the full checksum back for stale-source validation.

## Device identity resolution

An unmatched attendance row may be linked only to a specifically selected,
active `StudentMaster`. Search accepts stable identifiers and normalized names
as a discovery aid, but the request must contain the selected student's UUID and
record version. Name-only matching is never accepted.

The backend revalidates the resolution row, source checksum, device identifier,
classification, student status, record version, and current active mappings.
An existing mapping to the target is idempotent. A mapping to another student
fails with `DEVICE_ALREADY_ASSIGNED`; ordinary linking never reassigns it.
Reassignment remains in the existing Student Management identity workflow,
where it receives separate confirmation and audit.

## Roster resolution

`POSSIBLE_DUPLICATE` rows can be compared against an explicitly selected stable
student. The comparison classifies identity, personal, enrollment, and reference
fields. Stable identifier differences are immutable conflicts and block the
plan. Linking recalculates comparison server-side, rejects stale student
versions, and records only the resolution type, student ID, source row, checksum
prefix, and safe field names.

Unsupported create-master, enrollment, and reference-repair plans remain
blocked rather than introducing a weaker alternative to the canonical roster
service.

## Retry and commit safety

Attendance retry preview accepts only unresolved rows from one original source
session and checksum. It preserves original source row numbers and checksum,
excludes committed rows, reruns canonical identity and duplicate checks, and
creates a new preview batch. Linking never auto-commits.

Selected newly eligible retry rows are committed only through
`commit_attendance_preview`. That service revalidates preview checksum,
classification, device mapping, student identity, current attendance payload,
and open-period protections. It preserves administrative overrides and rejects
stale or finalized attendance through existing guards. Retry resolution and
commit outcomes are recorded in the operations audit.

## Frontend

`/upload` retains Attendance Upload, Student Roster Upload, and Student Data
Update, and adds a single **Needs Attention** view. The view presents counts,
filters, responsive conflict cards, operator-first messages, expandable
technical provenance, stable student navigation, and upload-history navigation.

The device dialog is keyboard-operable through the shared Radix dialog,
restores focus, labels candidate selection as a radio group, provides textual
disabled reasons, and announces mutation outcomes. At narrow widths, cards and
stacked controls avoid a wide data table.

### Resolution state isolation

Browser validation reproduced a stale-dialog defect: after device `991001` was
linked and previewed, opening `991002` displayed the first item's mutation
result and hid student search. The repair keys dialog content by
`resolution_item_id`, keeps all query keys item-scoped, and remounts local
search, selection, comparison, retry, confirmation, success, and error state
when the item changes or the dialog closes. An obsolete response remains bound
to its unmounted item and cannot replace the newly opened item's visible state.

Attendance resolution now proceeds explicitly through identity selection,
device-link confirmation, retry preview, eligible-row selection, provenance
summary, and selected-row commit. Preview never commits automatically. Blocked
rows remain visible and disabled, while the commit request uses stable retry
row IDs and the canonical retry batch, session, and checksum.

Roster `POSSIBLE_DUPLICATE` cards expose **Compare records** independently of
attendance retry eligibility. Operators must select a stable student record,
review imported and existing values, and confirm the server-allowed link plan.
Immutable identifier conflicts visibly block submission and are never
overwriteable.

## Verification contract

All automated tests use synthetic databases and generated workbooks. Commands
run in Ubuntu WSL with the repository Python virtual environment and Linux Node,
npm, Bun, and Playwright binaries. `backend/attendance.db` is inspected only by
checksum and immutable read-only SQLite URI before and after validation.

Schema change: **none**.

The canonical synthetic browser fixture uses
`core.database.SessionLocal`, attendance headers from
`services.excel_parser.REQUIRED_COLUMNS` (including `Pengecualian` and lowercase
`week`), device conflicts `991001` and `991002`, and one roster
`POSSIBLE_DUPLICATE`. The sequential regression and responsive checks target
390, 768, 1024, and 1366 pixel widths. Browser artifacts stay under `/tmp`.
Desktop infrastructure is explicitly skipped when unavailable. Protected
database writable access remains zero.
