---
status: current
last_reviewed: 2026-10-31
---

# Architecture overview

OperatorOS is an offline-first school attendance and academic analytics system.
Its supported runtime is a local Elysia API, a React application in the browser,
and SQLite. PostgreSQL is unsupported; containers are not required.

## Workspace ownership

| Workspace | Owns |
| --- | --- |
| apps/api | HTTP transport, authorization, domain services, backup policy, and scheduling |
| apps/web | Browser routes, feature APIs, business forms, and presentation |
| packages/db | Drizzle schema, SQLite lifecycle, schema manifest, and data paths |
| packages/contracts | Framework-neutral TypeBox DTOs shared across workspace boundaries |
| packages/ui | Domain-neutral UI primitives and source-owned shadcn components |
| packages/excel | Excel infrastructure used by the API |

The browser application uses React 19, Vite 8.3.4, and TanStack Start in SPA
mode. The Start Vite plugin builds the route tree from `apps/web/src/routes/`;
`apps/web/src/router.ts` creates a router instance per Start client and
`apps/web/src/routes/__root.tsx` owns the document shell and browser providers.
The app remains client-rendered and proxies same-origin API calls to the
separately supervised Elysia process. See the
[TanStack Start SPA decision](../decisions/tanstack-start-spa.md) for the
hosting and ownership boundaries.

## Request and data flow

The browser calls canonical `/api/` domain paths through the shared web API
client. Elysia routes validate requests, authorize the actor, call domain
services, and map internal rows to DTOs. The database package owns SQLite
persistence; the browser does not import database rows or compute canonical
analytics metrics.

## Related architecture

- [Workspace boundaries](module-boundaries.md) defines package ownership and
  allowed dependency directions.
- [Change safety golden path](change-safety-golden-path.md) describes the
  checks required for cross-layer feature changes.
- [Frontend architecture](frontend.md) describes routing, server state, and API
  contracts.
- [Database schema](database-schema.md) describes the schema authority and
  startup contract.
- [Runtime support](../reference/runtime-support.md) records supported and
  unsupported deployment modes.
