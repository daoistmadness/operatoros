---
status: current
last_reviewed: 2026-10-26
---

# Frontend architecture

The browser application lives in apps/web and uses React, Vite, React Router,
TanStack Query, and the shared OperatorOS UI package. Package versions are
recorded in the web manifest and root Bun lockfile.

## Routing

React Router 8.5.0 is used in declarative mode. App.tsx mounts BrowserRouter,
Routes, and Route from react-router; route definitions and route guards stay in
the web application. The app does not use React Router Framework Mode, route
modules, SSR, or a server entry point.

Pages are lazy-loaded through the current route definitions. Authentication
and role/capability guards control the browser experience; API authorization
remains the security boundary.

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
