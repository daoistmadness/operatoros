# Backup Scheme Reference

The supported Phase 6/7 authenticated SQLite backup and restore architecture is documented in [Backup and Restore Security](security/backup-restore.md).

Astryx also contains legacy operator shell scripts under `scripts/`. Those scripts use different archive formats and may support PostgreSQL tooling, but they are not equivalent to the authenticated `/api/admin/backups` workflow. In particular, they do not provide the complete database-user attribution, identity-schema viability validation, restored-session revocation, cookie clearing, or browser reauthentication lifecycle.

Do not describe cron or scheduled backup execution as a completed application feature. Scheduled backup operations belong to a later phase. Operators using legacy scripts must independently protect credentials, stop writers when required, verify output, restrict backup filesystem access, and follow the reviewed recovery procedure for the target database.

Current application backup facts:

- Local API backup supports file-backed SQLite.
- SQLite snapshots use the online backup API and include WAL state safely.
- Published backups have SHA-256 metadata and integrity/table verification.
- Retention is count-based, not a documented seven-day application policy.
- Backup files are access-controlled but not encrypted by Astryx.
- Restore requires an authenticated administrator and a single-worker runtime.
- Successful restore revokes restored sessions and requires sign-in again.
