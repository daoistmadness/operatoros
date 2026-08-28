# Backup Scheme Reference

The supported Phase 6/7 authenticated SQLite backup and restore architecture is documented in [Backup and Restore Security](security/backup-restore.md).

OperatorOS also contains operator shell scripts under `scripts/`. Those
scripts use the same versioned encrypted SQLite envelope but are not equivalent
to the authenticated `/api/admin/backups` workflow. They do not provide the
complete database-user attribution, identity-schema viability validation,
restored-session revocation, cookie clearing, or browser reauthentication
lifecycle.

Application scheduled backups use the same encrypted SQLite path as manual API
backups. The shell scripts are manual operator tools. Operators using them must
protect credentials, stop writers when required, verify output, restrict backup
filesystem access, and follow the reviewed recovery procedure.

Current application backup facts:

- Local API backup supports file-backed SQLite.
- SQLite snapshots use the online backup API and include WAL state safely.
- Published backups have SHA-256 metadata and integrity/table verification.
- Retention is count-based, not a documented seven-day application policy.
- New application backup files use AES-256-GCM. The live database remains
  unencrypted.
- Restore requires an authenticated administrator and a single-worker runtime.
- Successful restore revokes restored sessions and requires sign-in again.
