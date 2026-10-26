---
status: current
last_reviewed: 2026-10-26
---

# SQLite-only local runtime

## Decision

OperatorOS supports one local Elysia API process, a React frontend in a browser,
and file-backed SQLite. PostgreSQL is unsupported. A container runtime and a
Tauri desktop shell are not required or part of the current application.

The public runtime labels are SQLITE_ONLY_SUPPORTED,
LOCAL_BROWSER_RUNTIME, POSTGRESQL_NOT_SUPPORTED, and
CONTAINER_RUNTIME_NOT_REQUIRED.

## Rationale

The supported product is an offline-first local system. SQLite keeps the
application data in one locally managed database and avoids introducing a
network database service as a runtime prerequisite. The browser communicates
with the local API; it does not connect to SQLite directly.

## Consequences

- The database package owns schema, SQLite lifecycle, and canonical data paths.
- Existing databases are validated at startup and are never migrated by
  ordinary application startup.
- Fresh bootstrap uses the S4.7 base and applies the S4.8 employee extension.
- PostgreSQL support requires a new architecture decision and operational
  evidence; old PostgreSQL migration files do not establish support.
- The API and CLI backup/restore paths retain their documented single-process
  restrictions.

The current runtime contract and startup details are in
[runtime support](../reference/runtime-support.md) and the
[database operations runbook](../runbooks/database-operations.md).
