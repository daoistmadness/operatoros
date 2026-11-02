---
status: current
last_reviewed: 2026-11-01
---

# Platform portability

## Runtime support

`SQLITE_ONLY_SUPPORTED` remains the application data contract. OperatorOS uses
file-backed SQLite; PostgreSQL is unsupported. A non-SQLite `DATABASE_URL`
fails configuration or database validation. The application does not read
legacy `POSTGRES_*` variables. The Python/FastAPI backend is not a runtime
dependency, and the Tauri desktop shell has been removed.

Local development runs the Elysia API and React browser app on native Linux.
The repository also has an optional rootless Podman development launcher. Neither
workflow establishes production container support.

A single-host Podman deployment is proposed in
[the Podman deployment decision](../decisions/podman-deployment.md). It remains
unsupported. A draft production image and service configuration exist locally,
but they are uncommitted and unreviewed. Deployment requires architecture
acceptance and a successful authorized Ubuntu rehearsal.

Current application labels:

- `SQLITE_ONLY_SUPPORTED`
- `LOCAL_BROWSER_RUNTIME`
- `POSTGRESQL_NOT_SUPPORTED`
- `CONTAINER_RUNTIME_NOT_REQUIRED` for current local development

## Database contract

Fresh bootstrap installs the S4.7 base, then applies S4.8 employee, S4.9
school-unit, S5.0 monthly PTK, S5.1 UPP archive, S5.2 student administration,
S5.3 student identity verification, and S5.4 BOSP reminder extensions. The
current schema head is `20261027_s54`, defined by
`packages/db/src/manifest.ts`.

The connection layer enables `PRAGMA foreign_keys = ON` and uses `BEGIN
IMMEDIATE` for write transactions. It does not configure WAL. Fresh databases
use SQLite's default rollback journal; an existing database may use WAL.
Drizzle is the application data layer.

Ordinary startup validates existing databases and never migrates them. The
protected operational database remains S4.3 (`20260725_s43`) until a separately
authorized migration. It is never a test target.

Historical PostgreSQL migrations and the PR #35 evaluation documents are audit
evidence only. They do not establish current deployment or compatibility
support.
