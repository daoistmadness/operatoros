# Database Migrations

## Phase 9.3 first administrator setup

Apply `20260714_first_admin_setup_sqlite.sql` or `20260714_first_admin_setup_postgresql.sql` after the identity migration. The additive singleton table permanently closes first-run setup and stores the safe atomic provisioning audit fields. Existing users close setup even before this row is reconciled. Fresh Compose PostgreSQL volumes apply this migration automatically; existing volumes retain the explicit backup-and-migrate procedure below.

## Phase 9 backup scheduler

Apply `20260714_backup_scheduler_sqlite.sql` or `20260714_backup_scheduler_postgresql.sql` after the identity migration. These additive migrations create the singleton scheduler configuration and append-only execution history tables. They do not modify backup artifacts or restore tables. PostgreSQL can store operational history/configuration, while the existing local snapshot engine remains intentionally restricted to file-backed SQLite deployments.

## Phase 7.1 identity schema history

Phase 7.1 introduced the migration-owned `users` and `sessions` tables for SQLite and PostgreSQL 16. `users` holds unique usernames, Argon2id password hashes, the constrained `admin`/`staff` role, active state, timestamps, and lockout state. `sessions` holds only a digest of the opaque token together with user ownership, idle/absolute expiry, revocation, and request context. The foreign key uses `ON DELETE RESTRICT`, and session lookup/user/expiry indexes are created explicitly.

Application startup intentionally excludes these identity tables from `Base.metadata.create_all()`. A verified backup before migration and dialect-specific forward SQL are mandatory.

Migrations are date-prefixed raw SQL and are applied explicitly; application startup is not a migration runner. Authentication tables in particular must never rely on `Base.metadata.create_all()` for production deployment.

## Execution order

Apply historical migrations required by the target installation in filename/date order, then apply exactly one Phase 7.1 dialect file:

- SQLite: `20260713_identity_schema_sqlite.sql`
- PostgreSQL 16: `20260713_identity_schema_postgresql.sql`

The identity migration depends only on an operational database. It creates `users` before `sessions` because `sessions.user_id` references `users.id`. Files containing `_rollback_` are recovery scripts and must not be included in normal forward execution.

## Operational procedure

1. Stop application writers and identify the configured database.
2. Create and verify a database backup. For supported local SQLite installations, use the Phase 6 backup API or backup service before continuing.
3. Run the forward migration for the active database dialect.
4. Verify database integrity, both tables, constraints, and the three session indexes.
5. Start the application.
6. Run health and schema smoke tests before account provisioning.

Example SQLite execution using the standard library (avoids requiring the `sqlite3` CLI):

```bash
DATABASE_PATH=/protected/path/attendance.db backend/.venv/bin/python - <<'PY'
import os, sqlite3
from pathlib import Path
sql = Path("backend/migrations/20260713_identity_schema_sqlite.sql").read_text()
connection = sqlite3.connect(os.environ["DATABASE_PATH"])
connection.execute("PRAGMA foreign_keys=ON")
connection.executescript(sql)
connection.close()
PY
```

For PostgreSQL, execute `20260713_identity_schema_postgresql.sql` with the deployment's normal protected administrative connection. Do not place credentials in shell history.

## Rollback procedure

Rollback deletes all users and sessions. Stop the application first and take another backup of the failed/partial state for diagnosis. Run the matching rollback file:

- SQLite: `20260713_identity_schema_rollback_sqlite.sql`
- PostgreSQL: `20260713_identity_schema_rollback_postgresql.sql`

After rollback, run the dialect's integrity checks and confirm the pre-existing operational tables remain. If verification fails, restore the pre-migration backup using the approved database recovery procedure rather than continuing with a partially migrated database.

Rollback removes all identity and session records and makes authenticated application use unavailable until the forward migration and controlled account provisioning are completed again. It is a recovery action, not an account-reset mechanism.

## Platform notes

### SQLite

- Enable `PRAGMA foreign_keys=ON` on every connection; the application already does this.
- The migration uses `BEGIN IMMEDIATE` to prevent concurrent writers.
- SQLite DDL and rollback are tested on a disposable database.
- Run the migration while application writers are stopped.

### PostgreSQL

- The migration targets PostgreSQL 16 and is enclosed in one transaction.
- `TIMESTAMPTZ`, `BOOLEAN`, and `BIGSERIAL` preserve the intended production types.
- Apply using a role allowed to create tables and indexes.
- The shared database and one persistent `AUTH_COOKIE_SECRET` must be available to every application worker.

Phase 7.1 does not solve the separate multi-worker restore-locking limitation.

## Secret configuration

`AUTH_COOKIE_SECRET` belongs only in `backend/.env`, a protected local configuration file, or the deployment environment. It must persist across restarts, be shared across workers, and must never be auto-generated, committed, exposed to the frontend, or logged. Use `COOKIE_SECURE=false` for the offline localhost HTTP profile and explicitly configure `COOKIE_SECURE=true` for HTTPS; do not auto-detect this setting.

Authenticated restore rejects pre-identity backups and identity schemas missing required user/session columns or an active administrator. After replacement, all restored session rows are revoked and the operator must authenticate again. Restore is restricted to a configured single-worker runtime; safety snapshots and rollback remain mandatory.
