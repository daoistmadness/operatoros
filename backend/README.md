# Retained Python Tooling

The production backend is `apps/api`, built with Bun, TypeScript, Elysia,
Drizzle, and SQLite.

This directory retains Python tools for disposable database bootstrapping,
schema inspection, migration evidence, synthetic fixtures, and operations
checks. These tools do not serve HTTP requests.

## Setup

```bash
mise install
mise run python:bootstrap
```

The tooling environment is external to every worktree. Set
`OPERATOROS_PYTHON_VENV` to use a disposable or CI-owned location. Existing
`backend/.venv` directories are not removed, but they are not authoritative.

The requirements file contains only dependencies used by retained tooling.
It does not install the retired Python HTTP application.

## Database safety

Use explicit disposable SQLite paths for tooling and tests. Never use
`backend/attendance.db`. Do not change the database schema from this tooling
without the controlled migration procedure.

Raw SQL files under `migrations/` and the migration documents under
`docs/migration/ts-backend/` remain historical evidence.
