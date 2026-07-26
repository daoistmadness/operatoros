# Backup Health and Restore Preflight

## Architecture Decision

`BUILD_BACKEND_RECOVERY_CONTRACT_BEFORE_GUIDED_UI`

This milestone adds the backend recovery contract only. It does not add guided
recovery UI, change the database schema, or alter restore publication,
replacement, rollback, WAL cleanup, engine disposal, or session revocation.

## API Compatibility

The canonical administrative prefix remains `/api/admin/backups`.

- `GET /status` returns the derived health contract plus the legacy status
  fields consumed by `BackupManagement`.
- `GET /` lists backups.
- `POST /` creates a manual backup.
- `GET /history` retains the existing scheduler execution-history response.
- `GET /recovery-history` returns sanitized restore audit history.
- `POST /{filename}/restore-preflight` performs read-only source validation.
- `POST /{filename}/restore` retains the existing guarded restore execution.

All routes require an authenticated administrator. The actor used by restore
execution is derived from the authenticated session; clients cannot supply or
override it.

## Backup Health

Health is calculated by the backend from the backup directory, manifests,
checksums, SQLite integrity, operation locks, age thresholds, and available
space. The ordered precedence is:

1. `RESTORE_IN_PROGRESS`
2. `BACKUP_IN_PROGRESS`
3. `DESTINATION_UNAVAILABLE`
4. `NO_BACKUP` or `LAST_BACKUP_FAILED`
5. `LOW_DISK_SPACE`
6. `STALE`
7. `AGING`
8. `HEALTHY`
9. `UNKNOWN` for an unsupported or unresolvable configuration

The default aging threshold is 24 hours and the default stale threshold is 72
hours. Both are positive, stale must be greater than aging, and the low-space
multiplier must be positive. Boundaries are inclusive: a backup exactly 24
hours old is `AGING`, and one exactly 72 hours old is `STALE`.

Status responses expose only a backup-directory basename, a database basename,
safe reason codes, aggregate sizes/counts, and verification results. They do
not expose absolute paths, environment values, secrets, exceptions, or stack
traces. A missing manifest cannot be verified, and a corrupt or mismatched
latest backup cannot be `HEALTHY`.

## Read-Only Preflight

Preflight accepts only the canonical generated SQLite backup filename inside
the configured backup directory. Absolute paths, traversal, encoded traversal,
symlinks, CSV, ZIP, missing files, missing or invalid manifests, manifest
filename mismatch, checksum mismatch, invalid SQLite, integrity failures,
foreign-key violations, incompatible schema, incompatible identity tables,
missing active administrator identity, and content identical to the active
database are blocked or marked ineligible.

SQLite inspection uses `mode=ro&immutable=1`. Preflight does not checkpoint
WAL, create a safety backup, create candidate or rollback files, dispose the
engine, replace or delete files, revoke sessions, publish a restore, run
migrations, or append restore-execution audit events. It returns only aggregate
student, attendance, and enrollment counts and deltas. No row-level student or
identity data is returned.

Impact classification uses this precedence:

1. Identical content: `NO_CHANGE`
2. Checksum, integrity, quick-check, or foreign-key failure: `INVALID_BACKUP`
3. Identity or schema incompatibility: `SCHEMA_INCOMPATIBLE`
4. Major reduction or substantially old source: `HIGH_RISK`
5. Lower operational counts: `DATA_REDUCTION`
6. Higher operational counts: `DATA_INCREASE`
7. Compatible ordinary difference: `LOW_IMPACT`
8. Indeterminate input: `UNKNOWN`

Larger counts are described as an increase, not interpreted as better data.

## Recovery History

Recovery history is projected onto a fixed allow-list: timestamp, safe backup
filename, event, actor display, result, safe reason code, operation/reference
ID, and safe safety-backup filename. Malformed and legacy JSONL records are
ignored or safely projected. Passwords, confirmation phrases, absolute paths,
stack traces, exceptions, environment values, and arbitrary metadata are never
returned.

## Validation Environment

Validation is WSL-only and uses synthetic databases and WSL temporary backup
directories. The protected `backend/attendance.db` is inspected only through
SHA-256 and SQLite `mode=ro&immutable=1`.

Python and pytest are invoked through:

`/home/mikhailryu/projects/absensi/school-attendance-analytics/backend/.venv/bin/python`

The venv launcher resolves to `/usr/bin/python3.12`, which is expected Linux
virtual-environment behavior. Virtual-environment identity is verified using
`sys.prefix`, `sys.base_prefix`, site-package paths, and the imported pytest
module path. Windows Python and Windows pytest are not used.

No schema migration is included in this milestone.
