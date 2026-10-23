# Frontend architecture

Frontend source is TypeScript with a route-level lazy-loading foundation. The
authenticated route table currently defines 58 entries, including the wildcard
not-found entry and 12 entries with an explicit `redirectTo` target, and its 43
lazy declarations cover 41 distinct modules; `App.tsx` adds one lazy `/login`
route outside that table. These counts are observations rather than compatibility
contracts. Features retain ownership boundaries and are migrated incrementally,
not through a big-bang reorganization.

TanStack Query owns server state and the sanitized API-error foundation handles
client-facing failures. Generated OpenAPI contracts are version-controlled and
drift-checked, but pages consume feature APIs rather than generated code
directly. Canonical browser routes are `/api/<domain>/...` through the shared
client. Historical frontend-boundary and OpenAPI-foundation audit records remain in Git history.
