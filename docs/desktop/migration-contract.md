# OperatorOS Desktop Database Migration Contract

- Status: **Frozen for Phase 11.1B–11.1D**
- Scope: SQLite desktop database only
- Last reviewed: 2026-07-15

## Ownership and invariant

FastAPI/Python owns database initialization and migration. Tauri prepares paths and supervises the process but never opens SQLite, executes SQL, interprets schema versions, or performs rollback. PostgreSQL deployment remains independent and is not migrated by the desktop sidecar.

At most one sidecar and one scheduler may own `%LOCALAPPDATA%\OperatorOS\Data\operatoros.db`. The sidecar acquires the canonical data-root lock before inspecting or changing the database.

## Startup decision flow

```text
Application starts
  -> validate absolute paths, lock, secret, space, and ownership
  -> does operatoros.db exist?
       no  -> initialize a new database through the full approved migration sequence
       yes -> perform read-only SQLite integrity and schema-version validation
  -> pending migrations?
       no  -> validate required tables/triggers/indexes
       yes -> determine whether a pre-migration backup is required
              -> create and verify backup before any destructive/rebuild step
              -> apply ordered safe forward migrations transactionally where supported
  -> re-run integrity and required-schema checks
  -> initialize SQLAlchemy and compatibility checks
  -> start scheduler/services
  -> report /health ready
```

No scheduler, HTTP mutation endpoint, setup flow, or frontend becomes available until this sequence succeeds.

## Version ledger

Phase 11.1B must introduce one authoritative, monotonic SQLite schema-version ledger and an explicit ordered migration manifest. Every migration has a unique immutable identifier, checksum, supported source version, target version, transaction/backup classification, and verification predicate. Applied identifiers/checksums are recorded in the database.

SQL files and existing `database.py` compatibility logic must be inventoried into this authority before production packaging. The sidecar must not blindly replay every historical script. Runtime compatibility patches remain non-destructive and backward-compatible; any patch that changes schema becomes a versioned migration. Identity/session tables retain their migration-owned boundary.

## Migration rules

Migrations must:

- be additive when possible;
- preserve user data, audit trails, foreign keys, triggers, constraints, and dual-dialect model expectations;
- run in deterministic order exactly once;
- use transactions where SQLite permits and explicit safe rebuild procedures where it does not;
- verify adequate disk space before backup/rebuild operations;
- create a checksum/integrity-verified backup before any table rebuild, column/data removal, destructive normalization, or other nontrivially reversible change;
- leave a clear redacted diagnostic and non-zero startup result on failure;
- validate `PRAGMA integrity_check`, required tables, append-only triggers, and schema version after completion;
- be covered by fresh-install and representative upgrade tests.

The destructive-operations application flag does not authorize schema migration data loss. Migration safety is a separate contract.

## Failure behavior

On validation or migration failure, the sidecar fails closed before readiness and preserves the original database and every created backup. It must not delete, recreate, truncate, silently replace, or fall back to another database. It must not automatically restore a backup without explicit recovery authorization and a recorded diagnostic, because automatic restore can hide the original failure and discard newer data.

For a transactionally failed additive migration, roll back that transaction and keep the prior database. For a failed rebuild/non-transactional sequence, preserve the failed working state and verified pre-migration backup for controlled recovery; never guess which copy is authoritative.

Corrupt databases are preserved read-only for diagnosis. Recovery options are Retry after the external cause is fixed, Open Logs, an authenticated/explicit verified backup restore workflow, or Exit.

## Downgrade and rollback policy

Automatic schema downgrade is forbidden. Installing an older OperatorOS binary against a newer schema must fail with an explicit incompatible-version error. Application rollback is permitted only when that binary declares compatibility with the current schema or the user performs a separately authorized restore of a verified pre-upgrade backup. A backup is mandatory before any such restore.

## Backup policy

Purely additive, transactional migrations may be classified as backup-optional only after architecture review and upgrade-test evidence. All destructive, rebuild, data-transforming, or uncertain migrations require a verified backup under `Backups` before mutation. The backup metadata includes source schema version, target version, application version, timestamp, size, and SHA-256 checksum without credentials or user-record contents.

## Acceptance matrix

Phase 11.1D must cover an empty data root, current schema, every supported historical schema, partially applied/unknown versions, altered migration checksum, insufficient disk, corrupt database, locked database, migration exception, post-check failure, newer-than-supported schema, restart after success/failure, and preservation of audit triggers and data. Each failure must prove no silent deletion or alternate database creation occurred.
