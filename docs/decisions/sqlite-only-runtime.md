---
status: current
last_reviewed: 2026-11-01
---

# SQLite-only local runtime

## Decision

OperatorOS uses file-backed SQLite and one Elysia API process per data root.
PostgreSQL is unsupported. The local development workflow runs the API and a
React browser app. Rootless Podman is also available for local development.

A Podman-based Ubuntu server deployment is proposed separately. It is not a
supported deployment until the proposal is accepted and an authorized host
rehearsal passes.

## Rationale

SQLite keeps application data in one locally managed database and avoids a
network database service as a runtime prerequisite. The browser communicates
with the API; it never connects to SQLite directly.

## Consequences

- `packages/db` owns the SQLite schema, lifecycle, and canonical data paths.
- Existing databases are validated at startup and are never migrated by
  ordinary application startup.
- Fresh bootstrap installs the S4.7 base, then S4.8 employee, S4.9 school-unit,
  S5.0 monthly PTK, S5.1 UPP archive, S5.2 student administration, S5.3 student
  identity verification, and S5.4 BOSP reminder extensions.
- The current schema head is `20261027_s54`. The protected operational database
  remains S4.3 until a separately authorized migration.
- The API and CLI backup and restore paths retain their single-process
  restrictions.
- PostgreSQL support requires a new architecture decision and operational
  evidence. Old PostgreSQL migration files do not establish support.

See [runtime support](../reference/runtime-support.md),
[database operations](../runbooks/database-operations.md), and the draft
[Podman deployment proposal](podman-deployment.md).
