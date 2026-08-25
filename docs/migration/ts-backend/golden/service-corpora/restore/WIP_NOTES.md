# Restore success-path corpus — WIP / BLOCKED notes

Status: INCOMPLETE. success-path.json contains failing evidence (restore
409 SCHEMA_INCOMPATIBLE). Do not treat as parity evidence yet.

## Verified working
- POST /api/admin/backups → 200, checksum, execution-history row
  (status SUCCESS, checksum matches), newest-first ordering.
- GET history/recovery-history/status shapes.
- Two-phase contract confirmed from source: restore requires
  expected_source_sha256 + expected_active_sha256 (from restore-preflight)
  plus four acknowledge_* booleans and phrase RESTORE_DATABASE.

## Exact blocker (proven by direct file inspection)
- Backup .sqlite3 contains EMPTY users/sessions while active DB has
  3 users / sessions. Preflight therefore reports no_active_admin +
  schema_incompatible → restore fails closed 409.
- Active DB retains users=3 through login/checkpoint/backup stages
  (stage-by-stage probe verified).
- Suspected cause: execute_backup/create_backup reads source via
  sqlite3.connect("file:{source}?mode=ro") + .backup() while the app
  engine pool holds WAL-mode connections; suspected unflushed WAL or
  connection-snapshot mismatch. Next step: call
  PRAGMA wal_checkpoint(TRUNCATE) via the APP ENGINE (not a fresh
  connection) before POST backup, or open the backup source through
  the same pooled engine, then re-test.

## Environment seam (working)
- BACKUP_DIR env + ENABLE_DESTRUCTIVE_OPERATIONS=true set before first
  backend import; settings picks both up. Bootstrap active DB via
  core.schema_migrations.bootstrap_fresh_sqlite_database (produces
  ledger head 20260724_s42; identity migration included).
- Rebind core_database engine BEFORE first `import main`.
