# Phase 18 dashboard UI evidence

Base: `1d4047b491f22735e10d86a6ba7a76fb4fc5563d`

This evidence records the UI workstream and the CI performance workstream.
The final merge SHA is updated after delivery.

## UI workstream

- The primary dashboard now uses one TanStack Query snapshot hook.
- Month and year changes use filter-complete dashboard query keys.
- Class mapping targets the active dashboard query for invalidation.
- The inert export control now opens the existing server-side report route.
- The dashboard uses the shared `@operatoros/ui` Card primitive.
- Dashboard KPI and chart values remain server-produced.
- Browser authoritative metric calculations: `0`.
- Chart.js remains the chart library.
- Loading, empty, error, and stale-refresh states remain explicit.
- The existing responsive and accessibility E2E coverage remains active.

TanStack Table decision: `RETAIN_EXISTING_8.21.3_FOR_STUDENT_MANAGEMENT`.
Phase 18 adds no dashboard grid because the current dashboard lists are
small, bounded, and already use accessible table primitives.

Focused browser coverage verifies dashboard login, period filtering, report
navigation, and responsive layout. Existing browser coverage verifies mobile
navigation, keyboard focus, and overflow behavior.

## CI workstream

The current CI graph was measured before changes. The accepted main CI run
completed these jobs in parallel:

| Job | Measured duration | Main work |
| --- | ---: | --- |
| `api` | 184 s | setup, security, serial Turbo, runtime checks, direct package repeats |
| `frontend` | 39 s | setup, web checks, web typecheck, test, build |
| `docs` | 6 s | Markdown link checks |

The API job's local forced serial Turbo baseline was `164.82 s`. The final
local forced concurrency-4 run was `118.21 s`. The repeat run was `84.35 s`
with `10/13` eligible tasks cached. These are local measurements.

The final graph keeps required security, architecture, contract, OpenAPI,
database, test, typecheck, build, analytics, Excel, and documentation checks.
The API job owns one Turbo invocation. The frontend job keeps web-specific
boundary, dependency, and OpenAPI checks. It no longer repeats web package
typecheck, test, or build already covered by Turbo.

The final Turbo concurrency is `4`. Package tests for the API, DB, and Excel
workspaces are uncached because they create or mutate disposable state.
Deterministic typechecks, UI and contract tests, web tests, and builds remain
eligible for local and GitHub Actions Turbo caching. E2E remains uncached.

GitHub Actions caches Bun package downloads, pip downloads, and `.turbo`
results. Cache keys include the runner platform and relevant lock or
configuration hashes. Cache misses do not affect correctness.

## Scope

This phase does not add TanStack Router, TanStack Form, or Zod. It does not
change analytics semantics, database semantics, authentication, backup
encryption, Excel architecture, or provider-managed history state. Phase 19
has not started. The protected database and operator-owned backups were not
used.
