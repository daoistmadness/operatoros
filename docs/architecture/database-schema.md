---
status: current
last_reviewed: 2026-10-30
---

# Database schema architecture

OperatorOS supports SQLite only. Drizzle is the application persistence layer;
PostgreSQL contracts are not maintained. The S4.7 schema is the fresh-bootstrap
base and S5.4 (`20261027_s54`) is the current application head. Existing
outdated databases are rejected rather than silently migrated.

`20260724_s42` remains historical migration evidence. The TypeScript fresh
bootstrap installs the approved S4.7 base from `packages/db/src/s47-schema.sql`
and applies the employee, school-unit, monthly PTK, UPP archive, student
administration, student identity verification, and BOSP reminder extensions
from `packages/db/src/s48-migration.sql` through
`packages/db/src/s54-migration.sql`.
School-unit catalog updates use an integer compare-and-set version, and dated
staff assignments preserve closed and cancelled history with database guards.
The ledger records `20261027_s54` for the current schema. An explicit TypeScript
runner upgrades recognized S4.6 source variants, S4.7, S4.8, S4.9, and S5.0
through S5.3 databases to the S5.4 target.
The protected operational database remains separately
governed.

Existing current-schema databases are validated at startup. Older databases
are not upgraded automatically and require the controlled migration path. Tests use
disposable databases; protected operational data is never copied into fixtures.
See [database operations](../runbooks/database-operations.md) and the
historical schema-head records retained in Git history.
