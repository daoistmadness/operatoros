---
status: current
last_reviewed: 2026-10-29
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
visibility. The route-tree test normalizes trailing slashes, maps `$param`
segments to `:param`, maps `/$` to `*`, excludes the public `/login` route, and
compares the generated paths with the policy keys. An `authorizeRoute` key with
no policy denies access. The `/$` route remains the authenticated fallback for
unmatched URLs.

Search validation runs on the authenticated route tree and uses TypeBox. The
search record accepts string values and repeated string values. Parsing stores
repeated values as arrays in URL order, and serialization emits them as repeated
query keys in that order. Ordinary unknown keys remain available to routes.
Validation converts number and boolean values to strings before TypeBox checks
the supported search value types.
The parser, validator, and serializer discard `__proto__`, `constructor`, and
`toString` so those names cannot alter the search record's prototype or become
URL state. The shared router schema does not define page ranges, sort allowlists,
or date rules; route components and API/domain validation continue to own those
checks. See [Frontend performance baseline](../reference/frontend-performance-baseline.md)
for the audited consumers and their current limits.

## Shared navigation

The typed grouped navigation registry in `apps/web/src/lib/navigation/registry.ts`
is the presentation source for the sidebar, command search, breadcrumbs, and
browser page titles. It holds route labels, icons, route aliases, search
keywords, and generic presentation labels for protected detail routes; it does
not copy role or capability rules. Visibility and command selection call
`isRouteAuthorized()` from `apps/web/src/lib/router/access.ts`, while file-route
guards and Elysia continue to enforce access independently.

The registry preserves the single-user-mode hiding rule for Teacher
Assignments as a presentation restriction. Protected detail and compatibility
routes without a navigation entry remain protected by their existing route
policies and are not added to command results. The command search uses only
static registry metadata, not student, staff, or other Query data.

The sidebar exposes Search navigation and the shell handles Ctrl+K and Cmd+K.
The dialog focuses its labeled search field, lists eligible destinations as
ordinary links, and restores focus on dismissal. Selecting a destination uses
`AppLink`, so TanStack Router guards and dirty-form blockers still apply. The
dialog stays open when a blocker cancels navigation; after a committed route
change, focus moves to the main content. Search is disabled while session
verification is active.

Breadcrumbs and `document.title` use the active visible registry entry or a
generic detail-route label resolved through the existing route-policy matcher.
Existing page headings remain the only visible `<h1>` and can include
record-specific names. Routes without a registry entry keep the generic
OperatorOS document title and do not gain a synthetic breadcrumb.

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
