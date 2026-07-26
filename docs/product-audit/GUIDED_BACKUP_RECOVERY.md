# Guided Backup and Recovery

## Architecture

The guided workflow reuses the existing `/api/admin/backups` contract, backup
manifests, restore audit JSONL, operation locks, password verifier, and atomic
restore service. It does not add a database migration, restore job, preflight
token, or alternate publication path.

Backup health is derived by the backend and displayed without frontend
threshold calculations. The page shows the health label, successful and failed
backup details, age, retention, destination availability, disk space, checksum,
integrity, schema, active operations, and next scheduled run.

Manual backup creation is single-submit and is disabled during restore. A
successful response displays the safe filename, creation time, size, checksum
verification, integrity state, and schema. Repository entries show backend
verification, age, eligibility, blocker reasons, and a distinct
`pre_restore_auto` safety-backup label.

## Guided Restore

The wizard has seven ordered steps:

1. Select Backup
2. Verify Backup
3. Compare Impact
4. Safety Acknowledgements
5. Re-authenticate & Confirm
6. Execute
7. Result

Selection is limited to backups returned by the configured backend repository.
Verification calls the existing read-only preflight route. Comparison displays
only aggregate students, attendance, and enrollment counts, checksum prefixes,
schema, age, deltas, and impact classification; it does not expose row-level
personal data.

All four acknowledgements start unchecked and cover complete replacement,
session revocation, restart, and automatic safety-backup creation. Execution
requires the current session user's password, the exact selected filename, and
the exact phrase `RESTORE_DATABASE`. The client cannot select or identify a
different actor.

The password is sent only in the request body, never placed in browser storage,
URL state, query cache, logs, audit metadata, or responses, and is cleared from
component and request variables after the request settles. Router-scoped
validation responses omit submitted input values.

## Server Revalidation

Immediately before the existing restore service runs, the API:

- verifies the authenticated administrator with the canonical password helper;
- validates the filename, phrase, acknowledgements, and lowercase SHA-256
  syntax;
- reruns source path, manifest, checksum, SQLite integrity, quick check,
  foreign-key, schema, identity, and active-administrator checks;
- recalculates source and active checksums and compares both with the expected
  preflight values;
- rejects identical, incompatible, corrupt, changed, or ineligible sources;
- checks free space for the safety backup and restore candidate;
- rejects an occupied destructive-operation lock.

SQLite read-only preflight uses `mode=ro` so committed WAL content is included
in active-database comparisons. The API does not duplicate candidate creation,
atomic replacement, sidecar handling, session revocation, verification, or
rollback publication code.

## Execution Results

Because restore remains synchronous, the UI presents execution stages as a
static explanation and never displays fake percentages. The dialog cannot be
dismissed during the request.

`COMPLETED` reports the restored filename, completion time, safety backup,
post-restore integrity, quick check, foreign-key result, aggregate counts,
session revocation, and restart requirement.

`ROLLED_BACK` is returned only when rollback completed and the prior active
database passed verification. `FAILED` does not claim active data safety when
rollback was unsuccessful or unconfirmed; it carries a high-severity flag,
safe next action, and support reference. Raw exceptions and filesystem paths
are not exposed.

No safe Tauri relaunch command exists in the current supervisor contract.
Operators therefore receive the explicit fallback: "Close and reopen
OperatorOS, then sign in again." A browser reload is not presented as an
application restart.

Recovery history remains separate from scheduler execution history and is
loaded from the sanitized recovery-history endpoint. It displays only timestamp,
safe filename, event, actor display, result/reason, operation reference, and
safety-backup filename.

## Authorization and CSV Boundary

Existing administrator authorization remains mandatory for status, list,
creation, preflight, restore, and recovery history. Authorization dependencies
run before repository inspection. Restore adds current-password verification
and a bounded in-process failure throttle; `single_user_offline` does not bypass
these controls.

Backup & Recovery accepts only backend-listed SQLite backups. CSV remains in
the separate Data Import & Export workflow and is explicitly described as data
exchange that cannot restore the complete application.

## Validation and Data Safety

Destructive integration tests use temporary synthetic SQLite databases and
temporary backup directories only. Backend tests cover security gates,
freshness, insufficient space, maintenance locks, successful publication,
session revocation, and verified versus unverified rollback reporting.
Frontend tests cover all backend health states, wizard ordering and gates,
metadata, sanitization, and synchronous result language.

All Git, Python, pytest, Node, npm, Bun, Make, and E2E validation for this
milestone runs inside Ubuntu WSL. `backend/attendance.db` is never initialized,
tested, backed up, or restored. Its release evidence is collected only through
SHA-256, filesystem stat, sidecar search, and SQLite
`mode=ro&immutable=1` inspection. The expected protected state is schema
`20260724_s42`, 117 students, 3651 attendance rows, zero enrollments, zero
foreign-key violations, and no adjacent sidecars.

Validation used sequential, non-overlapping gates. A Windows/UNC-contaminated
generated `node_modules` installation was replaced with a pure WSL installation
using the authoritative tracked `package-lock.json` and `npm ci`. The package
manifest and lockfile remained byte-identical. Vitest then resolved inside the
Linux repository under Node 22.

Release-gate evidence:

- targeted backend: 131 passed, 1 skipped, 537 deselected;
- backend full run 1: 639 passed, 30 skipped, 0 failed;
- backend full run 2: 639 passed, 30 skipped, 0 failed;
- Bun: 43 test files and 220 tests passed; production build passed;
- Node 22: 43 test files and 220 tests passed; production build passed;
- E2E validation passed;
- clean E2E smoke: backend 7 passed, web 13 passed, desktop infrastructure 1
  skipped, and zero failures.

The final immutable protected-database check produced the expected SHA-256
`a657108e8c15d62cc91962326d57c4cdd1f25fba4dceb5828d519076bc1c6274`,
`integrity_check=ok`, `quick_check=ok`, zero foreign-key violations, 117
students, 3651 attendance rows, zero enrollments, and schema
`20260724_s42`.
