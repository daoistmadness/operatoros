# Student Database Implementation Plan

This plan begins only after S1 architecture review. S1 makes no implementation change.

## Guiding sequence

All work is additive, preview-first, auditable, SQLite/PostgreSQL compatible, and reversible until explicit cutover. Existing `students.id` values and 3,409 attendance links remain unchanged throughout the initial phases. Each phase has its own migration, tests, backup/restore validation, and rollback plan.

## S2 — Student Master Foundation

### Scope

- Add stable student-master identity using an immutable UUID/key.
- Add a separate protected profile boundary for restricted/highly sensitive fields.
- Add effective-dated attendance device identities with source/device namespace.
- Add nullable reviewed linkage from the existing attendance registry to the stable master; do not move attendance FKs.
- Add import batches, source-row staging, and append-only student update/link audit history.
- Define field-level authorization, masking, export allow-lists, and audit events.
- Replace automatic scanner-ID primary-key migration with conflict classification before any profile/enrollment population.

### Migration rules

- Separate SQLite and PostgreSQL migration implementations with equivalent constraints.
- No drops, renames, student deletes, attendance rewrites, or automatic backfill by name.
- Backfill one master proposal per existing registry row only as `pending_review` unless authoritative evidence supports linking.
- Preserve temporary unique name compatibility until importer and APIs no longer rely on it.
- Verify row counts, FK integrity, override triggers, backup/restore, and rollback on production-like snapshots.

### Exit criteria

- Stable master/device schema and privacy controls reviewed.
- Existing attendance queries unchanged and all 3,409 rows attached as before.
- Ambiguous scanner/name conditions are representable without mutation.
- SQLite and PostgreSQL migration tests pass.

## S3 — Enrollment Population

### Preparation

- Obtain an authoritative roster and its effective academic year/status definitions.
- Complete normalized `jenjangs` and program masters; do not assume the seeded `Primary` is sufficient.
- Confirm active/default academic year dates.
- Map source class/program labels through reviewed dictionaries.

### Population workflow for current 107

1. Produce identity-link preview for every attendance-registry student.
2. Compare roster membership with the 107 attendance identities.
3. Separate attendance-only, roster-only, uniquely linked, ambiguous, inactive/departed, and out-of-scope program records.
4. Require review for name-only candidates, ID contradictions, duplicate names, and multiple device IDs.
5. Create/link masters without changing attendance ownership.
6. Propose academic-year, program, jenjang, class, dates, and status.
7. Bulk commit only reviewed rows atomically with audit.
8. Reconcile master, active enrollment, attendance, and unresolved counts.

### Contract evolution

Current `(student_id, academic_year_id)` supports one row/year only. Before transfers/concurrent programs are required, add effective enrollment dates/status and effective class-assignment history. If concurrent PKBM/formal enrollment is allowed, introduce program-scoped uniqueness and non-overlap rules. Do not overload legacy student class fields.

### Exit criteria

- All 107 classified; unresolved rows retained and visible.
- No student declared active solely from attendance.
- No missing-roster deactivation.
- Grade Ledger candidates/enrollments operate from normalized records.

## S4 — Student Excel Import Preview

### Capabilities

- Workbook safety inspection, sheet selection, header row detection, and explicit column mapping.
- Raw protected staging with source file/sheet/row/checksum and import-batch identity.
- Canonical normalization and controlled dictionary mapping.
- Matching in frozen priority order.
- Classifications: `NEW_MASTER`, `LINK_TO_EXISTING_ATTENDANCE_STUDENT`, `UPDATE_MASTER`, `UPDATE_ENROLLMENT`, `UNCHANGED`, `CONFLICT`, `INVALID`.
- Field-level diffs, identity evidence, conflict reasons, completeness warnings, and population reconciliation.
- No mutation from upload/preview endpoints.

### Tests

- Duplicate names; spelling/case/space changes; leading-zero IDs; same device ID/different name; multiple IDs/person; conflicting NIPD/NISN/NIK; ambiguous dates; duplicate file rows; absent prior student; formulas/hidden sheets; malformed/oversized file.
- PII never appears in ordinary logs/errors or test fixtures.

### Exit criteria

- Preview is deterministic and idempotent for a source checksum/rule version.
- All conflicts are explicit; no name-only automatic link.

## S5 — Safe Commit and Audit

### Commit protocol

- Require approved preview ID, unchanged checksum, idempotency key, administrator authorization, and explicit conflict resolutions.
- Use one transaction per approved batch (or explicitly reviewed partitions if later approved).
- Upsert stable master/profile values with protected-null overwrite rules.
- Create/effectively close device identities; never reinterpret or discard an existing scanner ID silently.
- Create/update effective enrollments and class assignments.
- Append field/link/enrollment audit records containing actor, source, before/after classification, time, and reason without raw highly sensitive values.
- Write success, partial rejection, or failure batch outcome reliably.

### Safety

- No delete-by-absence synchronization.
- No primary-key mutation of current students.
- Preserve manual attendance overrides and append-only history.
- Detect concurrent edits using row versions/updated timestamps and reject stale previews.
- Validate FK integrity and reconciliation before commit.

### Exit criteria

- Retry is idempotent.
- Failure rolls back all approved mutations.
- Existing attendance and override integrity tests pass on both dialects.

## S6 — Monthly Snapshot Engine

### Scope

- Add immutable snapshot header and row-per-active-student tables.
- Select active population from effective enrollment on explicit snapshot date.
- Freeze master demographics plus program/jenjang/class/status values.
- Calculate admissions, transfers, withdrawals, graduates, incomplete fields, and supporting attendance metrics.
- Enforce unique generation scope/idempotency and atomic publication.
- Reconcile all category totals including `Unknown / Not Recorded`.
- Fail severe integrity discrepancies; retain audited failed generation.
- Regenerate as a new version, never overwrite valid history.

### Exit criteria

- Historical report is unchanged after current-profile edits.
- Concurrent/duplicate generation is prevented.
- Reconciliation and snapshot/export parity tests pass.

## S7 — Dashboard and Export

### Dashboard

- Month/snapshot, academic year, program, jenjang, and class filters.
- Total active, movements, completeness, and attendance-support cards.
- Category tables/charts that always include Unknown.
- Data-integrity banner with admin-only resolution details.
- Clear labels separating active academic, attendance, and master populations.

### Exports

- PDF and Excel generated from one immutable snapshot service.
- Exact parity with dashboard totals and reconciliation metadata.
- Privacy allow-lists, masking, role checks, purpose/audit metadata, and safe filenames.
- No routine export of national IDs, contacts, detailed address, documents, or health data.

### Exit criteria

- Accessible loading/error/empty states and no layout shifts from category ordering.
- Dashboard/PDF/Excel totals are identical for the same snapshot ID.

## S8 — Acceptance

### Data acceptance

- Import an approved representative student dataset through preview and commit.
- Reconcile source rows, new/linked/updated/unchanged/conflict/invalid outcomes.
- Reconcile master, active enrollment, attendance, and unresolved populations.
- Verify no orphan, duplicate identity, overlapping enrollment, or missing Unknown bucket.

### Integrity acceptance

- Existing 3,409 attendance rows remain present and attached to the same reviewed identities.
- Attendance upsert and manual override protection remain intact.
- Enrollment deletion targets only junction/history records according to contract, never a master student.
- Grades/interventions resolve through valid enrollment and stable master context.
- Backup/restore and upgrade from historical SQLite/PostgreSQL snapshots pass.

### Product acceptance

- Backend unit/integration/migration/security tests.
- Frontend preview, conflict review, enrollment, monthly dashboard, error, and export tests.
- Real-browser WSL workflow and clean packaged Windows desktop workflow.
- PDF/Excel visual and data parity checks.
- Authorization, masking, and export-audit penetration checks.

### Release gate

Release only with zero unresolved severe integrity errors, documented accepted conflicts, reconciled snapshot totals, complete backup evidence, and clean packaged acceptance.

## Cross-phase risks and controls

| Risk | Control |
|---|---|
| `students.id` is a machine ID | Preserve it; stable master and device identity are additive |
| Unique names reject legitimate duplicates | Transition matching first; later remove constraint through reviewed migration |
| Legacy class/jenjang diverge | Treat as compatibility/proposal only; normalized enrollment is authoritative |
| Empty enrollment branch | Populate from authoritative roster through preview/review, never attendance inference |
| Grades/interventions depend on enrollment | Gate those features on valid enrollment context |
| Attendance loss/misattachment | No attendance FK rewrite; before/after counts and identity reconciliation |
| Roster larger than 107 | Create new masters and separately link attendance identities; report all populations |
| Incorrect monthly denominator | Effective active enrollment at snapshot date only |
| Missing demographics disappear | Mandatory Unknown buckets and reconciliation |
| File omission deactivates students | Explicit lifecycle event required; imports are not authoritative deletion feeds |

## Architecture review decision required

Before S2, reviewers must approve:

1. staged Option C and the compatibility role of current `students`;
2. stable key type and device-identity namespace/effective-date rules;
3. profile storage/privacy split;
4. enrollment program/concurrency policy;
5. materialized monthly snapshot strategy;
6. name uniqueness transition and current importer shutdown/replacement sequence.
