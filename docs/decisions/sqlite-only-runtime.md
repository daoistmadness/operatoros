---
status: current
last_reviewed: 2026-11-28
---

# SQLite-only local runtime

## Decision

OperatorOS uses file-backed SQLite and one Elysia API process per data root.
PostgreSQL is unsupported. Local development runs the API and React browser
app natively with Bun. Production uses the accepted Docker Compose architecture
and its canonical deployment runbook. Podman and Quadlet are not supported
development or production runtimes.

## Rationale

SQLite keeps application data in one locally managed database and avoids a
network database service as a runtime prerequisite. The browser communicates
with the API; it never connects to SQLite directly.

## Consequences

- `packages/db` owns the SQLite schema, lifecycle, and canonical data paths.
- Existing databases are validated at startup and are never migrated by
  ordinary application startup.
- Fresh bootstrap installs the S4.7 base and sequential migrations through
  S5.7 (`20261127_s57`), the current application schema head.
- The latest documented production acceptance is S5.6
  (`20261126_s56`). Production schema state is established by its deployment
  receipt; migration requires separate authorization and the canonical Docker
  deployment procedure.
- The API and CLI backup and restore paths retain their single-process
  restrictions.
- PostgreSQL support requires a new architecture decision and operational
  evidence. Old PostgreSQL migration files do not establish support.

See [runtime support](../reference/runtime-support.md),
[database operations](../runbooks/database-operations.md), and the accepted
[Docker Compose deployment decision](docker-compose-deployment.md).
