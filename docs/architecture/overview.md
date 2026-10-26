---
status: current
last_reviewed: 2026-10-26
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

The application uses React 19, Vite 8.3.4, and React Router 8.5.0. Routing stays
in declarative mode: apps/web/src/App.tsx mounts BrowserRouter, Routes, and
Route from react-router. React Router Framework Mode and server-side rendering
are not configured.

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
