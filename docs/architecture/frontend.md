---
status: current
last_reviewed: 2026-10-29
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

## UI preferences

`UiPreferencesProvider` restores the versioned allowlist in
`apps/web/src/lib/ui-preferences.ts`. The current schema stores only the
sidebar's collapsed state. It contains no identity, role, session, or school
data. Unsupported or malformed values fall back to defaults, and the Settings
page can remove the stored preference. If browser storage is unavailable, the
control still works for the current session and reports that it was not saved.
The collapsed state applies to wide-screen navigation; an opened mobile drawer
always uses its full width.

## Forms

The staff profile form is the first TanStack Form pilot. It uses a small
TypeBox `Value.Check` / `Value.Errors` adapter and shared field controls built
on the existing UI primitives. API errors pass through the sanitized API error
layer before field paths are mapped to the currently visible fields.

Forms submit through existing feature APIs and TanStack Query mutations. Failed
submissions retain entered values; a successful API response resets the form
before navigation. Dirty forms use TanStack Router blockers, with a history blocker for
hash-only transitions and Router's before-unload integration. Protected staff
form values remain in memory and are not persisted in browser storage.

## Tables

The attendance follow-up queue uses TanStack Table for stable row identity and
column visibility. Its tab and enum filters use allowlisted URL values through
the shared router search layer. Free-text search can contain student details,
so it stays in memory and is not added to the URL or browser history. Table
column visibility is also in memory.

The queue receives complete candidate and case arrays from the existing API.
`VirtualizedDataTable` virtualizes these two lists at 100 or more filtered rows,
with stable row IDs, semantic table markup, row counts and indices, and keyboard
focus movement across virtual windows. The API payload and server-side
authorization remain unchanged. Student Management continues to use server
pagination; virtualization is not applied to its bounded page of results.

Tables retain their page-specific filtering and pagination behavior. The
follow-up queue has no export action; any future export must use the full
filtered dataset rather than the currently mounted virtual rows.

## Presentation

Route and business behavior belong in apps/web. Domain-neutral UI primitives
belong in packages/ui. Server responses own analytics calculations and Excel
exports; the browser formats values and adapts chart data for display. The
Management Overview attendance distribution uses the shared Unovis chart
surface, typed DTO adapter, tooltip, and status legend. Its adjacent semantic
table remains the exact-value alternative. Other production charts continue
to use Chart.js, including student-specific, report, and print/export charts;
keep Chart.js until Unovis parity is demonstrated for each required feature.
Unovis charts do not calculate metrics or persist chart data.
Shared loading, empty, error, and restricted states use semantic color tokens.
Loading animation runs only when the user has not requested reduced motion.

See [UI and routing](ui-and-routing.md) for the current router and shell
structure, and [frontend data flow](frontend-data.md) for query ownership.
