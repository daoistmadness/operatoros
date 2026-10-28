---
status: current
last_reviewed: 2026-10-26
---

# UI and routing

The browser shell is implemented in apps/web/src/App.tsx. The React Router
provider wraps the application, and authenticated routes render through the
authentication and role/capability guards before AppShell renders its navigation
and page outlet.

## Router mode

The project uses react-router 8.5.0 in declarative mode with BrowserRouter,
Routes, and Route imported from react-router. Route paths are declared in App.tsx
and the shared route definitions. BrowserRouter uses the root path.

React Router Framework Mode is not configured. There is no routes.ts manifest,
framework Vite plugin, route-module convention, SSR server, or hydration entry.
The application remains a browser-rendered Vite SPA.

## Authorization and page state

RequireAuth, RequireRole, and RequireCapability keep unauthorized users out of
the corresponding browser workflows. They support navigation and user feedback;
the API independently authorizes every protected request.

TanStack Query owns server data and mutation state. Pages call feature APIs
through the shared client. Analytics formulas and export generation stay in the
API. UI code formats and presents server results.

## UI components

The web application owns product routes, page layouts, and domain forms.
packages/ui owns domain-neutral primitives. It uses Base UI for new primitives;
existing web Radix components may remain.

The canonical product styling and accessibility conventions are in
apps/web/DESIGN.md. This page records the shell and routing architecture only.
