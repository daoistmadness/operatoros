# Backup Scheduler Architecture

Status: current implementation in `apps/api/src/domains/safety.ts`. This document
describes the supported single-host, single-process SQLite runtime.

## Backup creation path

Manual `POST /api/admin/backups` and a due scheduled run both call the same
`createBackup` function. Under the process-local `backupBusy` guard it:

1. checks free space against twice the active database size (with a small floor);
2. writes a consistent SQLite snapshot;
3. runs `PRAGMA integrity_check` and verifies required operational tables;
4. encrypts the snapshot and writes the metadata pair atomically;
5. appends `backup_succeeded` to `backup_operations_audit.jsonl`; and
6. applies count-based retention.

A concurrent backup attempt is rejected with `409`; the scheduler catches the
rejection so its timer keeps running. Restore uses a separate process-local
`restoreBusy` guard and creates a pre-restore safety snapshot through the same
creator.

## Scheduler configuration

`backup_scheduler_config` is a singleton row containing `enabled`, `schedule_type`
(`daily`, `weekly`, or `interval`), `interval_minutes`, UTC time/day fields, and
`next_run_at`. The scheduler is **disabled by default**; administrators enable it
through `/api/admin/backups/scheduler`.

The in-process timer polls every 30 seconds, computes the next UTC run when a run
is due, persists `next_run_at`, and calls the backup creator. `next_run_at` survives
an application restart. This is an offline, single-process scheduler; it is not a
distributed lock or queue, and multiple API processes would each run their own
timer.

`keep_daily`, `keep_weekly`, and `keep_monthly` are persisted configuration fields
reserved for planned tiered retention. They are not used by the current count-based
eviction policy.

## Retention

After a successful backup is published, the runtime keeps the newest 10 complete
artifact/metadata pairs (`BACKUP_RETENTION_LIMIT`). The count covers every trigger
(manual, scheduled, pre-restore). The newest backup and a backup selected as the
restore source are never eviction candidates. Incomplete pairs are ignored, and a
file that cannot be removed is skipped. Each removal appends a `backup_evicted`
line to the operations audit; a retention failure never invalidates the newly
published backup. Operators can still remove a specific backup through
`DELETE /api/admin/backups/:filename`.

A protected restore source can leave 11 visible generations until the next
successful backup re-applies the limit.

## History and audit

`backup_operations_audit.jsonl` is the authoritative append-only operational audit
for the current path (`backup_succeeded`, `backup_failed`, `backup_deleted`,
`backup_evicted`, `backup_eviction_skipped`, `backup_retention_failed`). The
`backup_execution_history` table and its read API exist for compatibility, but the
current Elysia creation path does not insert execution rows, so its
`removed_backups_json` column is not populated by retention. Do not use it as the
primary operational record.

Restore events are recorded separately in `backup_restore_audit.jsonl` and the
restore-history API. Audit append failures never turn a verified backup into an
invalid snapshot.

## Deployment restriction

The supported runtime is one local API process against one SQLite data root.
PostgreSQL and Docker/Compose are not supported runtimes. Backup, restore, and
scheduler guards are process-local module state; no component coordinates multiple
processes or claims multi-worker restore safety.
