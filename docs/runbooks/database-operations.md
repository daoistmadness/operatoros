---
status: current
last_reviewed: 2026-11-26
---

# Database operations

`backend/attendance.db` is the protected historical operational database and remains S4.3
(`20260725_s43`) until a separately authorized operational migration. Do not use
it in tests, E2E, development startup, fixtures, or deployment rehearsal.

The current application schema is S5.6 (`20261126_s56`). Ordinary startup
validates existing databases and never migrates them automatically.

The schema history builds sequentially from S4.4–S5.4 (academic timeline, attendance calendar, submission deadlines, attendance consolidation, employee history, school units and staff assignments, monthly PTK activity, UPP workbook archive, student administration, student identity verification, BOSP reminder settings) through S5.5 (Inventory & Asset Management and Extensible Label Printing) and S5.6 (Administrasi PTK V1). The upgrade runner (`packages/db/src/migrate-existing.ts`) supports direct non-destructive upgrades from recognized S4.6 variants and S4.7–S5.5 databases to `20261126_s56`; intermediate release deployments are unnecessary. See [schema architecture](../architecture/database-schema.md) for current schema details.

## Production operational migration

Production schema migrations MUST use the canonical artifact-bound deployment wrapper `scripts/docker-deploy.sh migrate` (with `OPERATOROS_DEPLOY_DIR=/var/lib/operatoros/deploy` and `OPERATOROS_DATA_DIR=/var/lib/operatoros/data`):

1. **Explicit target authorization & lock:** Requires `.deploy.lock` and `.maintenance_lock`, verifies candidate integrity, and sets `OPERATOROS_OPERATIONAL_MIGRATION_WRAPPER=docker-deploy-v1` when invoking `packages/db/src/db-cli.ts migrate-operational --authorize-target <schema>`. Direct manual execution of `migrate-operational` outside the wrapper is rejected.
2. **Writer exclusion & quiescence:** Stops `operatoros-api`, sets `--restart=no`, checks zero container mounts on the data root, and runs `scripts/verify-writer-quiescence.py` (`lsof`, `/proc/*/fd`, `-wal`/`-shm`/`-journal` checks, and `BEGIN EXCLUSIVE` lock probe). Mere absence of `-wal`/`-shm` files is never sufficient proof of quiescence.
3. **Mandatory pre-migration backup & disposable restore:** Runs `apps/api/src/backup-cli.ts backup` (including attached UPP/student/PTK document contents), verifies `0600` file modes, and verifies `apps/api/src/backup-cli.ts restore-disposable` into a `0700` container temp directory before touching the live database.
4. **Migration, validation & preservation:** Executes `migrate-operational`, runs `db-cli.ts validate`, re-checks writer quiescence, activates the matching candidate release, clears `.maintenance_lock`, and verifies integrity, foreign keys, and existing record/attachment preservation.

## Rollback and recovery boundaries

Application rollback (`scripts/docker-deploy.sh rollback`) uses `scripts/verify-rollback-schema.py` and is permitted only when the live database schema matches or remains compatible with the previous release. Never automatically restore an older production database over committed data, discard committed records, revert schema destructively, delete attachments, or restart an incompatible prior release against a migrated database. Do not put backup locations or live secret/credential values in committed documentation.

## Disposable synthetic migration rehearsal and development backup

For a disposable migration rehearsal, use a synthetic database under the OS temporary root and:
`bun run db:migrate-existing --data-dir <absolute-tmpdir-path>`
(which validates source fingerprints against [schema manifest](../../packages/db/src/manifest.ts) and targets `CURRENT_SCHEMA_VERSION`, reporting `NOOP` when already current). Never use that command on `backend/attendance.db` or live production storage.

The historical Podman-era `scripts/migrate-dev-db-s47.sh` wrapper is discontinued and unsupported.

For an approved development database, stop all writers and make a verified
encrypted backup with `OPERATOROS_DATA_DIR=<absolute-development-data-dir> bun
apps/api/src/backup-cli.ts backup`. Do not print secrets. Restore the artifact
to an empty temporary directory with
`bun apps/api/src/backup-cli.ts restore-disposable <encrypted-backup-file>
<absolute-temporary-data-dir>`, then validate it with `bun packages/db/src/db-cli.ts validate --data-dir <absolute-temporary-data-dir>`. Ordinary startup never migrates. The development launcher uses Bun for session and port management and never invokes Python during startup.
