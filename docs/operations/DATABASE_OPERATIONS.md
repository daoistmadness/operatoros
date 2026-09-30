# Database operations

`backend/attendance.db` is the protected operational database and remains
S4.3 (`20260725_s43`) until a separately authorized operational migration.
Do not use it in tests, E2E, development startup, or fixtures. The current
application schema is S4.7 (`20260929_s47`) and ordinary startup validates
existing databases and never migrates them automatically.

The S4.3 operational event is complete. The isolated S4.4 academic timeline
migration preserves existing grade values and leaves historical period
attribution unknown. The isolated S4.5 attendance calendar adds only local
calendar authority tables. The isolated S4.6 attendance submission deadline
adds only explicit academic-year and jenjang cutoff configuration. The
isolated S4.7 attendance consolidation migration adds an append-only monthly
ledger, explicit assumed lateness cutoffs, and preserves existing attendance
classifications. Future
operational migrations require
explicit user authorization, an exact target, no handles or sidecars, a fresh
verified backup outside the repository, exclusive lock, wrapper preflight, and
its process-local access context. Do not place local backup locations or live
checksums in committed documentation.

Normal operation pairs current main with an S4.7 database. The protected
database remains unavailable to the current application until it is separately
migrated under the controlled procedure. Rollback pairs a restored S4.2
database with application `c06a6220c2c0c2059521c1a396d1b914635aacff` on
`maintenance/s42-rollback`; `b47632c4210720f81804212544452c7c900c928c` is a
historical, unusable rollback base. See the completed migration record in
root execution contract ([AGENTS.md](../../AGENTS.md)).

For an approved existing development database, stop all writers and create a
verified encrypted backup with `OPERATOROS_DATA_DIR=<absolute-development-data-dir>
bun apps/api/src/backup-cli.ts backup`. Provide the existing backup encryption
environment without printing its secrets. Restore the artifact to a new empty
temporary directory with `bun apps/api/src/backup-cli.ts restore-disposable
<encrypted-backup-file> <absolute-temporary-data-dir>`. Run `bun run
db:migrate-existing --data-dir <absolute-temporary-data-dir>`, then `bun run
db:validate --data-dir <absolute-temporary-data-dir>` for rehearsal.

After rehearsal passes, use `scripts/migrate-dev-db-s47.sh --data-dir
<absolute-development-data-dir> --backup <encrypted-backup-file>`. That
wrapper verifies the development service identity and stopped state, holds a
lock, and invokes the TypeScript migration with a fresh matching encrypted
backup. The runner accepts the recognized S4.6 source, rejects unknown
schemas, and reports `NOOP` for the approved S4.7 target. Verify with `bun run
db:validate --data-dir <absolute-development-data-dir>`. Ordinary startup
never migrates. The development launcher uses Bun for session and port
management and never invokes Python during startup.
