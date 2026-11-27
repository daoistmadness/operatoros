---
status: current
last_reviewed: 2026-11-28
---

# Platform portability

## Runtime support

`SQLITE_ONLY_SUPPORTED` remains the application data contract. OperatorOS uses
file-backed SQLite; PostgreSQL is unsupported. A non-SQLite `DATABASE_URL`
fails configuration or database validation. The application does not read
legacy `POSTGRES_*` variables. The Python/FastAPI backend is not a runtime
dependency, and the Tauri desktop shell has been removed.

Local development runs the Elysia API and React browser app natively with Bun.
Container-based development is discontinued. Production uses the accepted
Docker Engine and Docker Compose architecture in
[the deployment decision](../decisions/docker-compose-deployment.md), with
operations governed by the [Ubuntu server deployment runbook](../runbooks/ubuntu-server-deployment.md).

Current application labels:

- `SQLITE_ONLY_SUPPORTED`
- `LOCAL_BROWSER_RUNTIME`
- `POSTGRESQL_NOT_SUPPORTED`
- `CONTAINER_RUNTIME_NOT_REQUIRED` for current local development

## Database contract

Fresh bootstrap installs the S4.7 base and sequential migrations through S5.7.
The current schema head is `20261127_s57`, defined by
`packages/db/src/manifest.ts`.

The connection layer enables `PRAGMA foreign_keys = ON` and uses `BEGIN
IMMEDIATE` for write transactions. It does not configure WAL. Fresh databases
use SQLite's default rollback journal; an existing database may use WAL.
Drizzle is the application data layer.

Ordinary startup validates existing databases and never migrates them. The
latest documented production acceptance records S5.6
(`20261126_s56`); verify the exact deployment receipt before an operational
migration. Production data is never a test target.

Historical PostgreSQL migrations and the PR #35 evaluation documents are audit
evidence only. They do not establish current deployment or compatibility
support.
