# Database schema architecture

OperatorOS supports SQLite only. Drizzle is the application persistence layer;
PostgreSQL contracts are not maintained. S4.2 is the fresh-bootstrap baseline
and S4.7 is the current application head. Existing outdated databases are
rejected rather than silently migrated.

`20260724_s42` is the immutable fresh-bootstrap baseline. Fresh bootstrap
creates and records S4.2, then applies each registered migration through
`20260929_s47`. The protected operational database remains S4.3 until a
separate controlled migration is explicitly authorized. Full current metadata
is not used to silently add migration-owned objects to an older baseline.

Existing current-schema databases are validated at startup. Older databases
are not upgraded automatically and require the controlled migration path. Tests use
disposable databases; protected operational data is never copied into fixtures.
See [database operations](../operations/DATABASE_OPERATIONS.md) and the
historical schema-head records retained in Git history.
