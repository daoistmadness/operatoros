---
status: current
last_reviewed: 2026-10-28
---

# Frontend architecture

The browser application lives in `apps/web` and uses React, Vite, TanStack
Router, TanStack Query, and the shared OperatorOS UI package. Package versions
are recorded in the web manifest and root Bun lockfile.

## Routing

The Vite plugin generates `src/routeTree.gen.ts` from file routes in
`src/routes/`. `src/router.ts` configures TanStack Router and the shared search
parser. `src/App.tsx` provides authentication and setup state through router
context.

Authenticated routes use `beforeLoad` guards and render through `AppShell`.
`AppShell` checks the current path and auth state before it renders protected
content. Elysia remains authoritative for session, capability, and resource
authorization. Pages are lazy-loaded from their file routes.

The route-tree test compares normalized generated paths with the authorization
policy keys. A missing `authorizeRoute` policy denies that route. The generated
`/$` route remains an authenticated fallback for unmatched URLs.

See [UI and routing](ui-and-routing.md) for search-key behavior and URL policy
coverage.

## Data and API

One in-memory TanStack Query client owns server state. Pages call feature APIs
through the shared client, which uses canonical `/api/` domain paths and
sanitized API errors. Query keys include their filters, mutations invalidate
the affected query families, and logout clears protected query data. Authenticated
queries are not persisted to localStorage.

The committed OpenAPI contract is generated from the API and checked for drift.
Pages do not import generated contract code directly. Cross-workspace DTOs use
the TypeBox schemas in packages/contracts.

## Presentation

Route and business behavior belong in apps/web. Domain-neutral UI primitives
belong in packages/ui. Server responses own analytics calculations and Excel
exports; the browser formats values and adapts chart data for display.

See [UI and routing](ui-and-routing.md) for the current router and shell
structure, and [frontend data flow](frontend-data.md) for query ownership.
