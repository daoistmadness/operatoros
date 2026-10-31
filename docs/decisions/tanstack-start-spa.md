---
status: current
last_reviewed: 2026-10-31
---

# TanStack Start SPA migration

## Decision

Migrate the existing TanStack Router web app to TanStack Start in SPA mode.
Keep Vite as the web development and preview host. Keep the Elysia API as a
separately supervised process and preserve same-origin HTTP proxying.

The project operator authorized this scope on 2026-10-31. Architecture,
runtime and data integrity, authentication and security, and web E2E remain
review responsibilities for the implementation review.

## Scope

This decision authorizes changes to the web app bootstrap, Start and Vite
configuration, route generation, static shell handling, affected scripts, tests,
and architecture documentation. It does not authorize changes to database
schema, API ownership, API security, deployment topology, or application route
semantics.

The migration must preserve:

- `LOCAL_BROWSER_RUNTIME` and the current loopback Vite development and preview
  listeners, HMR, Tailnet settings, and environment checks;
- same-origin `/api`, `/health`, `/ready`, and `/openapi` forwarding to the
  selected Elysia API port;
- one Elysia API process per SQLite data root, including startup, shutdown,
  `flock`, and backup and restore busy guards;
- the HttpOnly session cookie, exact-origin CSRF checks, and API authorization;
- the single in-memory Query client and existing auth, setup, route, search,
  error, calendar, sidebar, and focus behavior.

The web app must not import `@operatoros/db`, SQLite drivers, or API
implementation modules. Browser data access stays on the established HTTP
client.

## Excluded work

This decision does not authorize SSR, Start server routes, Start server
functions, a new web server process, or Elysia inside a Start handler. In
particular, the Elysia integration example that calls `app.fetch(request)` from
a Start route would move API execution into the web process and violate the
project's API ownership contract. Keep API requests on the existing HTTP proxy.

Any later SSR or server-function work requires a separate ADR that defines
request-scoped state, authentication and authorization, process ownership,
deployment, and API boundaries.

## Dependency baseline

The migration baseline is `origin/main` commit `3428bcc1` with Bun `1.4.4`, Vite
`8.3.4`, React and React DOM `19.2.7`, and TanStack Router `1.170.46`. The
initial Start pin is `@tanstack/react-start` `1.169.4`, which declares Router
`1.170.46`. Before cutover, verify the frozen lockfile resolves
`@tanstack/start-server-core` at `1.169.39` or newer, the patched version for
[CVE-2026-102989](https://tanstack.com/blog/tanstack-start-security-update-cve-2026-102989).
Do not upgrade unrelated packages to make Start fit.

## Hosting contract

The Start build emits `/_shell.html` and client assets under
`apps/web/build/client/`. The production preview command uses
`vite.preview.config.js` without the Start server plugin, so it serves the
client output as static files. Application HTML paths must load the generated
shell on direct navigation and refresh. Existing static assets must resolve
before the fallback, and `/api`, `/health`, `/ready`, and `/openapi` must reach
Elysia before any SPA fallback. The build also creates `build/server/` to
prerender the shell; preview must not execute that output. Verify the generated
files and actual development and preview requests.

The route generator remains the sole owner of `apps/web/src/routeTree.gen.ts`.
Commit the generated tree, pin its generator through the lockfile, and make CI
fail when regeneration changes the committed file.

## Implementation shape

Operators keep the current development and preview commands:

```sh
./start-dev.sh
bun --filter @operatoros/web build
bun --filter @operatoros/web preview
```

A page continues to declare route policy and consume server data through the
existing browser layers:

```tsx
export const Route = createFileRoute('/students')({
  beforeLoad: authorizeRoute('/students'),
  component: StudentsPage,
})

function StudentsPage() {
  const students = useStudentsQuery()
  return <StudentsTable rows={students.data ?? []} />
}
```

The implementation keeps these owners:

| File or package | Responsibility |
| --- | --- |
| `apps/web/vite.config.js` | Start SPA plugin, loopback and HMR checks, same-origin development proxy, and build settings. |
| `apps/web/vite.preview.config.js` | Static client preview, checked SPA shell fallback, and the same-origin API proxy. |
| `apps/web/src/router.ts` | `getRouter()`, generated route tree, string-preserving search codec, and initial route context. |
| `apps/web/src/routes/__root.tsx` | Start document shell, browser-only providers, setup boundary, router context bridge, route outlet, and route error UI. |
| Start default client entry | `StartClient` hydration in React Strict Mode; no custom client entry is needed. |
| `apps/web/src/routeTree.gen.ts` | Generated output owned by the Start route plugin. |
| `apps/web/src/lib/api/client.ts` | Same-origin browser requests to Elysia through Vite's HTTP proxy. |
| `apps/api/` and `packages/db/` | Existing API, authentication, SQLite, backup, restore, and lock ownership. |

The first route match receives loading auth and setup context. The root route's
`ClientOnly` boundary renders the same loading fallback in the prerendered
shell and the browser's initial hydration; Query, auth, and deployment
providers mount after hydration. A narrow bridge updates the Start router
context and invalidates the route tree when auth or setup state changes. This
prevents shell generation from making API or session requests while preserving
the protected deep-link flow.

The static preview fallback runs only for HTML GET/HEAD requests, leaves
existing client files untouched, and skips the four API and health prefixes.
The E2E readiness probe requests HTML when checking the application root.

## Synthesis

The selected shape follows arena candidate 2. Start owns the router and static
shell. The root route owns the existing provider tree and route-context bridge.
Candidate 1's client-entry bridge depends on reaching a router instance that
Start owns internally, so it is less direct than using the router from its own
root route. A verified `ClientOnly` boundary keeps API-backed providers out of
build-time shell rendering and makes the loading fallback match during browser
hydration.

## Rejected alternatives

- **Start server with an HTTP forwarder to Elysia:** this adds a second web
  server and duplicates proxy, host, and forwarding policy while replacing the
  existing Vite preview contract.
- **Elysia embedded in a Start route:** this violates the separate API process
  and SQLite lock ownership requirements.
- **SSR migration:** this changes request-scoped auth, cache, rendering, and
  deployment behavior beyond the requested framework migration.
- **TanStack Router without Start:** this does not meet the current request.

## Rollback

Keep the known-good baseline commit and its React Router-free TanStack Router
build until route, auth, search, calendar, proxy, and E2E checks pass. Roll back
the web dependency, plugin, bootstrap, and shell configuration as one change.
No database recovery is needed because this decision makes no schema or data
changes.

## History

This decision supersedes the Start prohibition in
[Change safety and feature golden path](../architecture/change-safety-golden-path.md)
and the earlier scope description in [UI and routing](../architecture/ui-and-routing.md).
PRs #335 and #339 record the completed React Router to TanStack Router
migration and the earlier Vite SPA boundary. Their route-behavior and API
ownership constraints remain in force. No tracked No-Migration ADR was present
on the implementation baseline.

## References

- [TanStack Start SPA mode](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode)
- [Elysia integration with TanStack Start](https://elysiajs.com/integrations/tanstack-start)
