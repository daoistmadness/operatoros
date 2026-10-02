# Database schema architecture

OperatorOS supports SQLite only. Drizzle is the application persistence layer;
PostgreSQL contracts are not maintained. S4.2 is the fresh-bootstrap baseline
and S4.8 is the current application head. Existing outdated databases are
rejected rather than silently migrated.

`20260724_s42` remains historical migration evidence. The TypeScript fresh
bootstrap installs the approved S4.7 base from `packages/db/src/s47-schema.sql`
and applies the S4.8 employee extension from
`packages/db/src/s48-migration.sql`. An explicit TypeScript runner upgrades
recognized S4.6 and S4.7 databases to that same S4.8 target. The protected
operational database remains separately governed.

Existing current-schema databases are validated at startup. Older databases
are not upgraded automatically and require the controlled migration path. Tests use
disposable databases; protected operational data is never copied into fixtures.
See [database operations](../operations/DATABASE_OPERATIONS.md) and the
historical schema-head records retained in Git history.
