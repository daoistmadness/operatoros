# Backup Scheme Reference

The supported Phase 6/7 authenticated SQLite backup and restore architecture is documented in [Backup and Restore Security](security/backup-restore.md).

OperatorOS also contains operator shell scripts under `scripts/`. Those
scripts use the same versioned encrypted SQLite envelope but are not equivalent
to the authenticated `/api/admin/backups` workflow. `scripts/restore.sh` wraps
the local CLI restore path, which verifies encrypted artifact metadata and
authentication, SQLite integrity, foreign keys, schema, and administrator
eligibility; it revokes restored sessions and uses a safety snapshot and
rollback when an active database exists. The CLI does not use API session
authorization or browser cookie-clearing. Its concurrency and audit limits are
documented in [Backup and Restore Security](security/backup-restore.md).

Application scheduled backups use the same encrypted SQLite path as manual API
backups. The shell scripts are manual operator tools. Operators using them must
protect credentials, stop writers when required, verify output, restrict backup
filesystem access, and follow the reviewed recovery procedure.

Current application backup facts:

- Local API backup supports file-backed SQLite.
- API snapshots checkpoint any WAL and serialize the open SQLite database. The
  connection layer does not configure WAL, so freshly bootstrapped databases use
  SQLite's default rollback journal; an existing database may still be in WAL mode.
- Published backups have SHA-256 metadata and integrity/table verification.
- Retention is count-based: the newest 10 complete generations are kept after a
  successful backup, not a seven-day application policy.
- New application backup files use AES-256-GCM. The live database remains
  unencrypted.
- API restore requires an authenticated administrator and is supported only for
  one API process. The documented single-worker requirement is not enforced by
  the `BACKEND_WORKERS` or `RESTORE_SINGLE_WORKER_REQUIRED` variables; see
  [Backup and Restore Security](security/backup-restore.md).
- Successful API restore and CLI restore revoke restored sessions and require
  sign-in again. The CLI requires all API writers to be stopped.
