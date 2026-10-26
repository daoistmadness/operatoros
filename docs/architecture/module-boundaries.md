---
status: current
last_reviewed: 2026-10-26
---

# Workspace boundaries

OperatorOS is a Bun monorepo with two applications and shared packages. The
applications own runtime behavior; packages own reusable boundaries and
infrastructure.

## Owners

- apps/api owns Elysia HTTP routes, authorization, domain services, backup and
  restore policy, and scheduling.
- apps/web owns browser routes, feature API calls, business forms, and
  presentation.
- packages/db owns Drizzle schema, SQLite lifecycle, the schema manifest, and
  canonical data paths.
- packages/contracts owns cross-boundary TypeBox DTO schemas and types.
- packages/ui owns domain-neutral primitives and source-owned shadcn
  components. New primitives use Base UI.
- packages/excel owns Excel infrastructure. Authoritative exports are built
  by the API.

## Dependency directions

Cross-workspace imports use package exports. Do not import package source
internals, use relative source imports across workspaces, or make a package
depend on an application.

- Contracts must not import Elysia, Drizzle, or React.
- Database code must not import application code.
- UI must not import database, contracts, API, Elysia, or Drizzle.
- API, database, and contracts must not import UI.
- Web must not import database, Excel, or API internals.
- Excel may depend on contracts, but not on database internals.

The repository checker enforces these directions, including imports,
re-exports, package exports, and dependency manifests. Run bun run
check:architecture after changing workspace boundaries.

## Data and transport

Database rows stay inside packages/db and apps/api. The API maps internal
records to explicit contracts DTOs. The web app consumes feature APIs through
its shared client; it does not consume generated OpenAPI types directly.
Analytics formulas and Excel generation stay server-side.
