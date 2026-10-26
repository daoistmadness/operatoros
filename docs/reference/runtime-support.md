---
status: current
last_reviewed: 2026-10-26
---

# Platform portability

## Decision

`SQLITE_ONLY_SUPPORTED`. OperatorOS is a local SQLite application.
PostgreSQL is not a supported runtime. A non-SQLite `DATABASE_URL` fails at
database open or configuration validation; the application does not read legacy
`POSTGRES_*` variables. Configuration errors can include the configured database
string, so never embed credentials in `DATABASE_URL`. The supported runtime is a
local Elysia backend with the React frontend in a browser. The Python/FastAPI
backend is not a runtime dependency. The Tauri desktop shell is removed. A container runtime is not
required. The repository includes an optional rootless Podman launcher for
local development; it does not provide a Docker/Compose or hosted container
deployment.

The current deployment labels are:

- `SQLITE_ONLY_SUPPORTED`
- `LOCAL_BROWSER_RUNTIME`
- `POSTGRESQL_NOT_SUPPORTED`
- `CONTAINER_RUNTIME_NOT_REQUIRED`

## Database contract

SQLite must preserve the established business outcomes: fresh bootstrap
installs the S4.7 base and applies the S4.8 extension; migration-ledger ordering
is idempotent; constraints and append-only audit behavior hold; duplicate
attendance/upload handling rolls back atomically; and analytics remain
deterministic.

The connection layer enables foreign keys (`PRAGMA foreign_keys = ON`) and uses
`BEGIN IMMEDIATE` for write transactions. It does not configure WAL; freshly
bootstrapped databases use SQLite's default rollback journal, while an existing
database may still be in WAL mode. Drizzle is the application data layer.

Existing databases are never migrated by ordinary startup. The current
application schema head is S4.8 (`20261002_s48`); the protected operational
database remains S4.3 (`20260725_s43`) until a separately authorized migration,
and it is never a test target.

Historical PostgreSQL migrations and the PR #35 evaluation documents remain
audit evidence only. They do not establish current deployment or compatibility
support.
