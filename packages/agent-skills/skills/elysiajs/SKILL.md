---
name: elysiajs
description: >
  Use when implementing or debugging Elysia v2 TypeScript backends, designing or
  reviewing routes, plugins, validation, errors, lifecycle, or typed clients,
  or planning an explicitly requested Elysia migration. For OperatorOS, first
  check the installed Elysia version and follow its package source notes.
metadata:
  purpose: Build, debug, or migrate Elysia v2 TypeScript backends with validation, plugins, typed clients, and deployment.
  type: framework
  domain: backend
  framework: elysia
  library: "@operatoros/agent-skills"
  library_version: "0.1.0"
requires: []
sources:
  - README.md
  - package.json
  - docs/elysiajs.md
  - docs/elysiajs/references/ai-sdk.md
  - docs/elysiajs/references/api.md
  - docs/elysiajs/references/better-auth.md
  - docs/elysiajs/references/cheat-sheet.md
  - docs/elysiajs/references/composition.md
  - docs/elysiajs/references/cookie.md
  - docs/elysiajs/references/deploy.md
  - docs/elysiajs/references/drizzle.md
  - docs/elysiajs/references/eden.md
  - docs/elysiajs/references/errors.md
  - docs/elysiajs/references/lifecycle.md
  - docs/elysiajs/references/migration.md
  - docs/elysiajs/references/observability.md
  - docs/elysiajs/references/openapi.md
  - docs/elysiajs/references/plugins.md
  - docs/elysiajs/references/prisma.md
  - docs/elysiajs/references/project-structure.md
  - docs/elysiajs/references/react-email.md
  - docs/elysiajs/references/runtimes.md
  - docs/elysiajs/references/testing.md
  - docs/elysiajs/references/validation.md
  - docs/elysiajs/references/versions.md
  - docs/elysiajs/references/websocket.md
  - daoistmadness/operatoros:AGENTS.md
  - daoistmadness/operatoros:CONTRIBUTING.md
  - daoistmadness/operatoros:docs/guides/development.md
  - daoistmadness/operatoros:apps/api/package.json
  - daoistmadness/operatoros:bun.lock
  - daoistmadness/operatoros:package.json
  - daoistmadness/operatoros:.github/CI.md
  - daoistmadness/operatoros:.github/workflows/ci.yml
  - daoistmadness/operatoros:docs/architecture/change-safety-golden-path.md
  - daoistmadness/operatoros:docs/reference/security-model.md
  - daoistmadness/operatoros:docs/guides/testing.md
---

# Elysia v2

## Dependency note

This framework skill has no prerequisite skill. For OperatorOS work, first read
the [project-specific Elysia source notes](../../docs/elysiajs.md) and check the
installed Elysia major version.

## Start here

For OperatorOS backend work, read the package-specific [Elysia source notes](../../docs/elysiajs.md) first.

1. Inspect `package.json`, the lockfile, runtime, and app structure. Keep existing versions and conventions unless the user requests a migration.
2. This skill describes **2.0.0-rc.0** or newer. For v1, use [migration](../../docs/elysiajs/references/migration.md) to recognize differences, not as permission to upgrade. Check installed types when a different beta disagrees.
3. Read only the references the task needs. [Versions](../../docs/elysiajs/references/versions.md) lists the source revision, package baselines, and verification limits.
4. Check types and exercise the affected route, including its rejection path. See [testing](../../docs/elysiajs/references/testing.md).

## Essential rules

- **Options precede the handler.** `.get(path, options, handler)`, `.get(path, handler)`, and `.get(path, staticValue)` are valid.
- **Keep the returned type.** Chain calls or bind the result to a new variable. Reassigning `let app = new Elysia()` does not widen its inferred type.
- **Order hooks before routes.** Parent hooks before `.use(child)` reach the child's routes. `onRequest` runs before routing and is the exception to registration order. See [lifecycle](../../docs/elysiajs/references/lifecycle.md).
- **Declare typed dependencies.** Each independently defined instance should `.use()` its providers. Parent runtime inheritance does not give a child those static types. See [composition](../../docs/elysiajs/references/composition.md).
- **Name shared plugins.** `name` and `seed` deduplicate hooks. Plugin factories still execute on each call.
- **Return expected failures.** `status()` and `problem()` send ordinary responses. A returned `Error` enters error hooks and contributes to the route's return type. Thrown errors are absent from that inferred type. Explicit error details can remain public in production. See [errors](../../docs/elysiajs/references/errors.md).
- **Infer types from schemas.** Use `UnwrapSchema` or `UnwrapModels`. TypeBox 1.x has no schema `.static`. Keep handlers inline and pass plain values to services.
- **Choose context lifetime.** `decorate` and `state` are shared. `derive` runs per request after validation, in the `beforeHandle` queue.
- **Guard schemas override by default.** A route replaces the corresponding inherited schema. Use `schema: 'merge'` on the guard when both must apply.
- **Register optional capabilities.** File MIME validation needs a detector. WebSockets need `elysia/websocket`. Node needs `@elysia/node` and Node 22.18 or newer.
- **Always consult with an actual documentation** for the latest features, examples, and references. The skill is a guide to the documentation, not a replacement.

For Elysia 1 use: https://elysiajs.com/llms.txt
For Elysia 2 use: https://next.elysiajs.com/llms.txt

## Minimal app and test

Use the project's test runner. This Bun example opens no port.

```ts
// src/app.ts
import { Elysia, t } from 'elysia'

export const app = new Elysia()
	.get('/users/:id', {
		params: t.Object({ id: t.Number() })
	}, ({ params }) => ({ id: params.id }))

export type App = typeof app
```

```ts
// test/app.test.ts
import { expect, test } from 'bun:test'
import { app } from '../src/app'

test('coerces the id and rejects nonnumeric input', async () => {
	const response = await app.handle('/users/42')
	expect(response.status).toBe(200)
	expect(await response.json()).toEqual({ id: 42 })
	expect((await app.handle('/users/nope')).status).toBe(422)
})
```

Run `bun test` and the project's type check. For new projects, see [runtime setup](../../docs/elysiajs/references/runtimes.md). Keep `.listen()` in the process entry. See [project structure](../../docs/elysiajs/references/project-structure.md).

## Choose a reference

| Task | Read |
| --- | --- |
| Versions, peer dependencies, source versus docs | [Versions](../../docs/elysiajs/references/versions.md) |
| Configuration, routing, context, files, streams | [Core API](../../docs/elysiajs/references/api.md) |
| Hooks, parsing, derived context, disposal | [Lifecycle](../../docs/elysiajs/references/lifecycle.md) |
| Plugins, hook scope, guards, macros | [Composition](../../docs/elysiajs/references/composition.md) |
| Schemas, coercion, uploads, inferred types | [Validation](../../docs/elysiajs/references/validation.md) |
| Expected errors, exception mapping, production responses | [Errors](../../docs/elysiajs/references/errors.md) |
| Folders, services, models, dependency injection | [Project structure](../../docs/elysiajs/references/project-structure.md) |
| Cookie values, validation, signing | [Cookies](../../docs/elysiajs/references/cookie.md) |
| WebSocket routes | [WebSockets](../../docs/elysiajs/references/websocket.md) |
| Route tests, type checks, lazy plugins | [Testing](../../docs/elysiajs/references/testing.md) |
| Typed client calls | [Eden](../../docs/elysiajs/references/eden.md) |
| OpenAPI schemas and documentation | [OpenAPI](../../docs/elysiajs/references/openapi.md) |
| Bun, Node, Deno, Workers, frontend framework integration | [Runtimes](../../docs/elysiajs/references/runtimes.md) |
| Bundles, AOT, binaries, Docker, deployment | [Deployment](../../docs/elysiajs/references/deploy.md) |
| Traces, spans, request timing | [Observability](../../docs/elysiajs/references/observability.md) |
| CORS, JWT, static files, cron, HTML, GraphQL | [Official plugins](../../docs/elysiajs/references/plugins.md) |
| Databases and external libraries | [Drizzle](../../docs/elysiajs/references/drizzle.md), [Prisma](../../docs/elysiajs/references/prisma.md), [Better Auth](../../docs/elysiajs/references/better-auth.md), [AI SDK](../../docs/elysiajs/references/ai-sdk.md), [React Email](../../docs/elysiajs/references/react-email.md) |
| v1 syntax and migration | [Migration](../../docs/elysiajs/references/migration.md) |
| Find an example by pattern | [Pattern index](../../docs/elysiajs/references/cheat-sheet.md) |

## Defaults for a new project

Default to Bun and `t` schemas. Keep small apps in one file; split by feature as needed. Add Eden for typed clients and OpenAPI for API documentation.
