# Attendance Authorization and Import Safety

## Scope and original findings

This milestone closes the reality-audit defects where attendance review and history endpoints were anonymous, override actor identity was client-controlled, the frontend used a legacy immediate-write upload, and unmatched biometric identifiers could create legacy `Student` rows. It does not add correction approval, finalization/reopening, early-departure semantics, teacher class scope, or class bulk entry.

## Secured routes

| Method and path | Required capability | Behavior |
| --- | --- | --- |
| `GET /api/review/classes` | `view_attendance` | Authenticated attendance readers |
| `GET /api/review/attendance` | `view_attendance` | Authenticated attendance readers |
| `GET /api/review/attendance/{id}/history` | `view_attendance` | Authenticated attendance readers |
| `POST /api/review/attendance/{id}/override` | `manage_attendance` | Attendance administrators |
| `POST /api/review/attendance/mass-override-incomplete` | `manage_attendance` | Attendance administrators |
| `POST /api/uploads/preview` | `import_attendance` | Attendance import administrators |
| `POST /api/uploads/preview/{batch_id}/commit` | `import_attendance` | Attendance import administrators |
| `POST /api/uploads/upload` | `import_attendance` | Deprecated and always returns `410 LEGACY_ATTENDANCE_IMPORT_DISABLED` |
| `GET /api/uploads/history` | `import_attendance` | Attendance import administrators |
| `GET /api/uploads/missing-records` | `view_attendance` | Authenticated attendance readers |
| `GET /api/uploads/sample-template` | `import_attendance` | Attendance import administrators |

Anonymous requests receive `401`. The current `staff` role has `view_attendance` only; `admin` has `view_attendance`, `manage_attendance`, and `import_attendance`. Backend dependencies enforce this matrix before route writes.

## Trusted actor attribution

Override and mass-override request schemas forbid extra actor fields. `reviewed_by` is taken from the authenticated database user's username and is written consistently to the current override and append-only override history. The frontend displays that session username as read-only and does not transmit reviewer or role fields.

## Preview-first import and unmatched identities

The operational frontend posts workbooks only to `/api/uploads/preview`, displays every staged classification, and commits explicitly selected committable rows with `COMMIT_ATTENDANCE_IMPORT`. Duplicate commit clicks are disabled while a request is active.

Attendance identity resolution now requires an active `StudentDeviceIdentity` linked through `StudentMaster` to an existing legacy `Student`. It never matches by name. An unknown device identifier is staged as `CONFLICT` with `DEVICE_IDENTITY_UNMATCHED`; selecting it for commit returns `UNRESOLVED_IMPORT_ROWS`. Preview and commit create no `Student`, `StudentMaster`, or `StudentEnrollment`.

## Preserved behavior

Preview remains non-mutating. Commit remains atomic and idempotent, duplicate source rows are detected, existing attendance differences are explicit, cutoff-derived status calculation is retained, successful commits write upload history, administrative overrides remain authoritative, override history remains append-only, and reports/analytics continue to use effective override values.

## Verification

Synthetic backend tests cover anonymous and staff rejection, no-write failures, session actor attribution, spoof rejection, preview/commit authorization, disabled direct upload, unresolved identities, no academic-record creation, duplicate protection, upload logging, override history, and effective-report behavior. Frontend tests enforce the preview-only route contract, capability-gated controls, read-only actor display, unresolved-row visibility, safe errors, and duplicate-submit protection. E2E smoke uses only its generated runtime database and covers anonymous/staff override rejection, session-derived actor history, matched preview/commit, and unresolved-row rejection.

`backend/attendance.db` is excluded from all test routing. Safety verification uses only SHA-256 and SQLite `mode=ro&immutable=1`; the expected enrollment count remains zero.

## Deferred workflows

Correction request/approval/rejection, attendance cutoff finalization and reopening, teacher class scope, early departure, and class bulk entry remain intentionally deferred.
