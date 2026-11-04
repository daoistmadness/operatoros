---
status: current
last_reviewed: 2026-11-01
---

# Database operations

`backend/attendance.db` is the protected operational database and remains S4.3
(`20260725_s43`) until a separately authorized operational migration. Do not use
it in tests, E2E, development startup, fixtures, or deployment rehearsal.

The current application schema is S5.4 (`20261027_s54`). Ordinary startup
validates existing databases and never migrates them automatically.

The schema history adds S4.4 academic timeline, S4.5 attendance calendar, S4.6
submission deadlines, S4.7 attendance consolidation, S4.8 employee history,
S4.9 school units and staff assignments, S5.0 monthly PTK activity, S5.1 UPP
workbook archive, S5.2 student administration, S5.3 student identity
verification, and S5.4 BOSP reminder settings. See [schema architecture](../architecture/database-schema.md)
for current schema details.

Future operational migrations require explicit authorization for the exact
target, a fresh verified encrypted backup outside the repository, no database
handles or sidecars, an exclusive lock, wrapper preflight, and a process-local
access context. Do not put backup locations or live checksums in committed
documentation.

For a disposable migration rehearsal, use a synthetic database and the explicit
`bun run db:migrate-existing --data-dir` command. The runner accepts only known
source fingerprints through S5.3, validates the candidate, and targets the
current S5.4 schema. It reports `NOOP` for S5.4. Never use that command on the
protected S4.3 database.

The `scripts/migrate-dev-db-s47.sh` wrapper belongs to the local development
service and its Podman development volume. It is not a production migration
wrapper. Do not infer that a development wrapper authorizes a server migration.

For an approved development database, stop all writers and make a verified
encrypted backup with `OPERATOROS_DATA_DIR=<absolute-development-data-dir> bun
apps/api/src/backup-cli.ts backup`. Do not print secrets. Restore the artifact
to an empty temporary directory with
`bun apps/api/src/backup-cli.ts restore-disposable <encrypted-backup-file>
<absolute-temporary-data-dir>`, then validate it. Ordinary startup never
migrates. The development launcher uses Bun for session and port management
and never invokes Python during startup.
