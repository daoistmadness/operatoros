# Phase 14 monorepo architecture

Status: `Phase 14.2` complete. Phase 14.3 has not started.

This document defines the locked modernization boundary. Phase 14.1 changes
workspace and tooling structure. It does not move application source or change
product behavior.

## Target layout

```text
operatoros/
  apps/
    api/
    web/
  packages/
    contracts/
    db/
    ui/
    config/
    excel/
```

The API application now lives in `apps/api/`. The web application remains in
`frontend/`. `apps/web/` is still a non-authoritative placeholder.

Phase 14.1 creates no active future application package. `packages/config`
contains configuration skeletons. `packages/contracts`, `packages/db`,
`packages/ui`, and `packages/excel` remain deferred to later subphases.

## Workspace ownership

- Bun owns the runtime, package manager, workspaces, catalog, and root `bun.lock`.
- `apps/api/` is the `@operatoros/api` workspace.
- `frontend/` is the `@operatoros/web` workspace.
- Both packages remain private and keep their existing `0.1.0` metadata.
- The repository has no single release-version authority.

The root package is private and versionless. The root `bun.lock` is the only
dependency lockfile. Nested application lockfiles are not authoritative.

## TypeBox and contracts

`@sinclair/typebox` is owned by the root Bun catalog. Workspace packages use
`catalog:` and do not pin another TypeBox version.

Only schemas and types that cross an application or package boundary belong in
`@operatoros/contracts`. Phase 14.1 does not extract real contracts.

Database representations belong in `@operatoros/db`. HTTP transport details,
including query coercion, cookies, multipart parsing, file parsing, headers,
and Elysia-only refinements, remain in `apps/api`.

UI state belongs in `apps/web` or `@operatoros/ui`. Excel implementation state
belongs in `@operatoros/excel`.

Elysia consumes shared TypeBox schemas. Elysia does not own the shared
contracts layer. Drizzle owns persistence representation. React consumes
boundary contracts.

## Dependency directions

The binding rules are:

- `packages/contracts` must not import Elysia, Drizzle, React, or `apps/*`.
- `packages/db` must not import `apps/*`.
- `packages/ui` must not import `apps/*` or `packages/db`.
- `apps/web` must not import `packages/db`, `packages/excel`, or API internals.
- `packages/*` must not import `apps/*`.

The intended application edges are:

- `apps/api` may depend on `@operatoros/contracts`, `@operatoros/db`, and `@operatoros/excel`.
- `apps/web` may depend on `@operatoros/contracts` and `@operatoros/ui`.
- `@operatoros/excel` may depend on `@operatoros/contracts`.
- `@operatoros/excel` should not depend directly on `@operatoros/db`.

Mechanical boundary enforcement lands in Phase 14.7.

## Subphase sequence

Each subphase merges to `main` before the next begins. Each subphase uses one
focused PR.

1. 14.1: Bun workspace foundation.
2. 14.2: API move.
3. 14.3: Web move.
4. 14.4: `packages/db` extraction.
5. 14.5: `packages/contracts` extraction.
6. 14.6: `packages/ui` and shadcn/Base UI foundation.
7. 14.7: Architecture boundary enforcement.
8. 14.8: Turborepo.

Turbo is deferred to Phase 14.8. Excel consolidation is deferred to Phase 17.
Zod is not part of this architecture.

## Phase 14.1 and 14.2 scope

Phase 14.1 provided:

- root Bun workspaces for the two existing applications;
- one root lockfile;
- one exact TypeBox catalog entry;
- TypeBox and Elysia interoperability checks;
- shared TypeScript and ESLint configuration locations;
- package and dependency-boundary documentation.

It did not provide real shared contracts, move source files, extract Drizzle,
add UI libraries, add Turbo, add Zod, or change application behavior.

Phase 14.2 moved the authoritative Elysia application from `backend-ts/` to
`apps/api/`. It updated active workspace, launcher, CI, E2E, test-scope, and
documentation paths. It did not move `frontend/` or extract a package.
