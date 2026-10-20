# Durable project context

Use this file as a navigation aid. Execution rules belong to
[AGENTS.md](AGENTS.md), commands to [COMMANDS.md](COMMANDS.md), and the current
operational procedures to the documents below. Historical phase inventories,
test counts, and retired implementations remain in Git history.

## Current authorities

- Runtime: local Bun/Elysia API in `apps/api/`, React browser frontend in `apps/web/`, and SQLite/Drizzle in `packages/db/`. [Platform portability](docs/architecture/PLATFORM_PORTABILITY.md) defines the supported deployment boundary.
- Persistence: `packages/db/src/manifest.ts` owns schema order/head; `packages/db/src/data-dir.ts` owns data-root resolution. Startup validates existing data without migration. [Database operations](docs/operations/DATABASE_OPERATIONS.md) owns approved migration and rollback procedures.
- Architecture: [monorepo ownership](docs/architecture/phase-14-monorepo.md), [frontend architecture](docs/architecture/FRONTEND_ARCHITECTURE.md), and the [feature golden path](docs/architecture/change-safety-golden-path.md) define boundaries. Canonical API routes register in `apps/api/src/app.ts`.
- Backend skills: use `elysiajs` as required by AGENTS. Check the installed Elysia major before applying examples; the locally installed skill targets v2 while the current API uses v1.
- Existing management forecasts and intervention risk scoring must remain deterministic, explainable, and explicit about confidence, history, and insufficient data; do not introduce opaque AI/ML. Preserve domain behavior in `apps/api/src/domains/reports.ts` and `report-builder.ts`.
- Analytics and exports: [metric definitions](docs/analytics/METRICS.md) are server-owned. Cross-boundary TypeBox schemas belong to contracts; Excel infrastructure belongs to `@operatoros/excel`.
- Identity and recovery: [authentication](docs/security/identity-authentication.md), [backup/restore](docs/security/backup-restore.md), and [data reset](docs/operations/DATA_RESET.md) own security-sensitive procedures. Never use real school data to validate changes.
- Development: `mise run dev` delegates to `./start-dev.sh`. [Development guidance](docs/development/README.md) explains checkout identity, session ownership, shared development data, and safe alternate ports.
- Verification: [test strategy](docs/testing/TEST_STRATEGY.md), [E2E guidance](e2e/README.md), and [CI operations](.github/CI.md) define local tiers and protected PR gates.
