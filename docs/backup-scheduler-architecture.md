# Backup Scheduler Architecture

## Existing lifecycle

Manual `POST /api/admin/backups` calls `services.backup_service.create_backup()`. Under the shared backup lock, the service resolves the file-backed SQLite database and protected backup directory, checks free space, uses SQLite's online backup API to write a temporary snapshot, runs `PRAGMA integrity_check`, verifies required operational tables, calculates SHA-256, writes metadata, atomically publishes the database/metadata pair, and applies retention. Restore reuses the same lock and independently validates filename, metadata, checksum, schema, identity tables, active administrator, required table counts, and post-replacement database access. It creates a pre-restore safety snapshot, revokes restored sessions, rolls back on failure, and appends restore audit events.

Backups are currently discovered from `backup_*.sqlite3.meta.json`; there is no backup ORM record. Phase 9 keeps this artifact format so all existing restore targets remain compatible.

## Scheduler design

`BackupSchedulerConfig` is a singleton persistent row containing enabled state, schedule type (`daily`, `weekly`, or `interval`), interval value, UTC execution time/day, and daily/weekly/monthly retention counts. `BackupExecutionHistory` is append-only operational history with trigger, lifecycle status, timestamps, duration, filename, size, verification state, removed filenames, and a bounded error message.

The FastAPI startup hook loads the row and starts one in-process scheduler loop only when the configured backend worker count is one. Shutdown signals the loop, waits for an active execution, and releases its task. The persisted `next_run_at` survives application restart. This is intentionally an offline, single-process scheduler; it is not a distributed lock or queue.

The supported Compose backend intentionally runs one worker and stores scheduler configuration/history in the persistent PostgreSQL volume. Application-created backup and audit artifacts use the separate persistent `backend_data` volume. Scheduled snapshot creation remains restricted to file-backed SQLite, so a PostgreSQL Compose deployment records scheduler state but does not claim PostgreSQL scheduled snapshots; `scripts/backup.sh` and `scripts/restore.sh` remain the separate PostgreSQL operational path.

## Lifecycle states

An execution is inserted as `PENDING`, transitions to `RUNNING`, and finishes as `SUCCESS` or `FAILED`. Shutdown before work begins may mark a pending execution `CANCELLED`. A non-blocking scheduler execution lock prevents overlapping manual/scheduled engine runs; a rejected overlap is recorded as failed rather than starting a second snapshot.

Scheduled and manual jobs both call the existing backup creator. Successful history is written only after snapshot validation, checksum calculation, metadata publication, and automatic retention. Failed jobs retain their history row and audit event but never advertise a partial backup because the existing temporary-file cleanup remains authoritative.

## Retention

Scheduled artifacts are classified in UTC buckets. The newest configured number of daily, weekly (ISO week), and monthly buckets are retained; an artifact kept by any tier survives. Manual backups continue to use the existing count policy, the newest pre-restore safety snapshot is preserved, the active filename is excluded, and incomplete/invalid artifacts are never selected for tier deletion. Every scheduled cleanup records removed filenames in execution history and the append-only operations audit.

## Failure and audit handling

Execution failures store a sanitized error class/message, completion time, and duration. `backup_operations_audit.jsonl` receives start, success, failure, lock-rejection, configuration-change, and retention events. Audit append failures do not turn a verified backup into an invalid snapshot, but are surfaced in server logs/history where possible. Integrity failures remain `FAILED`, and no metadata pair is published.

Scheduler configuration and history APIs require the existing administrator role. Restore endpoints, destructive-operation flags, exact confirmation, compatibility checks, and session revocation are unchanged.
