# Attendance Correction Approval

## Reality-audit decision

`EXTEND_EXISTING_OVERRIDE_LEDGER`

`attendance_overrides` remains the single approved-value ledger. Raw `attendance`
rows retain the device/import result, each attendance record has at most one
current override, `attendance_override_history` records every approved change,
and review, reporting, and analytics queries already resolve status with the
override first. The extension adds approved check-in/check-out values and
structured before/after snapshots; it does not introduce a second effective
attendance source.

## Pending requests and maker-checker rules

`attendance_correction_requests` stores the immutable effective-value snapshot
and fingerprint captured when a request is created, along with the proposed
status and supported time fields. Requests move through `DRAFT`, `SUBMITTED`,
`APPROVED`, `REJECTED`, `CANCELLED`, `EXPIRED`, or `STALE`. Draft and submitted
requests never write the approved ledger and therefore cannot affect reports.

Requester and decision-maker names come only from authenticated database
sessions. Staff may create, view, submit, and cancel their own requests. Approval
and rejection require administrative capabilities; approval additionally
requires `APPROVE_ATTENDANCE_CORRECTION` and cannot be performed by the
requester. The effective-value fingerprint is checked immediately before the
approved override is written. A changed fingerprint moves the request to
`STALE` without changing attendance.

Approval calls the canonical correction service, updates or creates the existing
override, appends an `attendance_override_history` before/after record, links the
request to that override, and commits the transition together. Rejection
requires a reason and cancellation is limited to the requester or an
administrator; neither changes attendance.

## Finalization and reopening

The smallest authoritative scope supported by the current attendance model is
one attendance date. `attendance_periods` holds the current `OPEN` or
`FINALIZED` state and an optimistic version. Finalization requires
`FINALIZE_ATTENDANCE_PERIOD`; repeating it is idempotent. Direct single-record
and mass overrides, correction approval, and preview-import commits all consult
the same date lock.

Reopening requires the stronger `reopen_attendance_period` capability,
`REOPEN_ATTENDANCE_PERIOD`, a reason, and the expected period version. A stale
version is rejected. Reopening changes only governance state, never attendance
values, and a reopened date may be finalized again.

## Audit chain

`attendance_correction_audit` records every request transition and
`attendance_period_audit` records finalization, reopening, and re-finalization.
Both use `ON DELETE RESTRICT`, are protected from updates and deletes by the
repository's SQLite and PostgreSQL append-only trigger installation, and retain
session-derived actors. Together with `attendance_override_history`, the chain
explains raw input, pending proposal, decision, and the approved effective value.

## API and frontend

The canonical API is `/api/attendance-corrections`, with create/list/detail and
submit/approve/reject/cancel actions. Date-scoped finalization, reopening, and
status endpoints live under `/api/attendance-corrections/periods`. Responses use
safe error codes and do not expose ORM or SQL details.

The Attendance Corrections page provides the request form, queue,
original-versus-proposed comparison, permission-aware actions, finalized-period
controls, rejection confirmation, and audit timeline. Actor fields are
read-only, duplicate actions are disabled while requests are in flight, and the
layout remains overflow-safe from mobile through desktop widths.

## Reporting contract

Raw attendance is never rewritten. Pending, rejected, cancelled, expired, and
stale requests are absent from the approved ledger and do not affect reporting.
Approved requests update the same override resolver already used by attendance
review, report services, analytics trends, and management analytics. Finalizing
or reopening a period alone never changes a reported value.

## Migration and validation

Schema S4.2 uses an isolated atomic-copy SQLite migration from S4.1. It preserves
attendance and override row counts, validates foreign keys, installs append-only
audit triggers, records the schema ledger entry, and is idempotent. Fresh
databases receive the same tables and trigger protections. All migration and
test work uses synthetic databases.

Validation evidence is recorded in the milestone merge report: focused backend
workflow and migration tests, complete backend runs twice, Bun and Node frontend
tests/builds, E2E infrastructure validation, and the synthetic smoke lifecycle.
The protected `backend/attendance.db` is checked only by SHA-256 and immutable
read-only SQLite inspection before and after validation.

## Deferred scope

Early-departure semantics, teacher-to-class authorization, and a new general
bulk-entry workflow remain explicitly deferred. Preview-first import,
session-derived attendance authorization, disabled legacy direct import, and
unmatched-device handling are unchanged.
