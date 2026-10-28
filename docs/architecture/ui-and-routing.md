---
status: current
last_reviewed: 2026-10-28
---

# UI and routing

The browser shell is implemented in `apps/web/src/App.tsx`. The Vite SPA uses
TanStack Router file-based routes under `apps/web/src/routes/`; Vite generates
`src/routeTree.gen.ts`. `src/router.ts` creates the router, and `src/index.tsx`
provides auth state through router context. Authenticated routes are children of
`_authenticated.tsx`, which renders `AppShell` and enforces route authorization
in `beforeLoad`.

## Route conventions

Use file-based route modules and `$param` filenames for dynamic segments. Keep
page components lazy-loaded, and use route `beforeLoad` redirects for aliases.
The shared authorization map in `src/lib/router/access.ts` also drives sidebar
visibility. Search validation belongs on the authenticated route tree and uses
TypeBox; preserve URL query values as strings, including repeated keys.

The app remains a browser-rendered Vite SPA. It does not use TanStack Start, SSR,
or a hydration entry.

## Authorization and page state

Router `beforeLoad` checks keep unauthorized users out of the corresponding
browser workflows. `AccessDenied` presents authorization feedback; the API
independently authorizes every protected request.

TanStack Query owns server data and mutation state. Pages call feature APIs
through the shared client. Analytics formulas and export generation stay in the
API. UI code formats and presents server results.

## UI components

The web application owns product routes, page layouts, and domain forms.
packages/ui owns domain-neutral primitives. It uses Base UI for new primitives;
existing web Radix components may remain.

The canonical product styling and accessibility conventions are in
apps/web/DESIGN.md. This page records the shell and routing architecture only.
