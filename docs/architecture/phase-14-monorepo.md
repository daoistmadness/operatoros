# Phase 14 monorepo architecture

Status: `Phase 14.6` complete after merge. Phase 14.7 has not started.

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

The API application lives in `apps/api/`. The web application lives in
`apps/web/`. Both application workspaces are authoritative.

Phase 14.1 creates no active future application package. `packages/config`
contains configuration skeletons. Phase 14.4 makes `packages/db` active.
Phase 14.5 makes `packages/contracts` active. Phase 14.6 makes `packages/ui`
active. `packages/excel` remains deferred.

## Workspace ownership

- Bun owns the runtime, package manager, workspaces, catalog, and root `bun.lock`.
- `apps/api/` is the `@operatoros/api` workspace.
- `apps/web/` is the `@operatoros/web` workspace.
- `packages/db/` is the `@operatoros/db` workspace.
- `packages/contracts/` is the `@operatoros/contracts` workspace.
- `packages/ui/` is the `@operatoros/ui` workspace.
- The application packages remain private and keep their existing `0.1.0`
  metadata. The database package is private and versionless.
- The repository has no single release-version authority.

The root package is private and versionless. The root `bun.lock` is the only
dependency lockfile. Nested application lockfiles are not authoritative.

## TypeBox and contracts

`@sinclair/typebox` is owned by the root Bun catalog. Workspace packages use
`catalog:` and do not pin another TypeBox version.

Only schemas and types that cross an application or package boundary belong in
`@operatoros/contracts`. The package uses plain TypeBox. It does not import
Elysia, Drizzle, React, `@operatoros/db`, or an application.

Database representations belong in `@operatoros/db`. HTTP transport details,
including query coercion, cookies, multipart parsing, file parsing, headers,
and Elysia-only refinements, remain in `apps/api`. The web application does
not consume database representations.

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
- `packages/ui` must not import `@operatoros/contracts`, `@operatoros/api`,
  Elysia, or Drizzle.
- `apps/api`, `packages/db`, and `packages/contracts` must not import
  `@operatoros/ui`.
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
4. 14.4: `packages/db` extraction. The package owns the Drizzle schema, the
SQLite client lifecycle, the schema manifest, and transaction primitives.
5. 14.5: `packages/contracts` extraction.
6. 14.6: `packages/ui` and shadcn/Base UI foundation. Complete after merge.
7. 14.7: Architecture boundary enforcement. Pending.
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

Phase 14.3 moved the authoritative React/Vite application from `frontend/` to
`apps/web/`. It updated active workspace, launcher, CI, E2E, test-scope, and
documentation paths. It did not restructure the API or extract a package.

## Phase 14.4 database boundary

The persistence source now lives in `packages/db/src/`. Its public exports
provide the database handle, transaction primitive, schema manifest, and
Drizzle schema. `apps/api` supplies the path and uses these exports. It keeps
business services, route handlers, auth transport, report calculations,
attendance rules, import orchestration, backup and restore policy, and
scheduler orchestration.

This repository has no TypeScript migration directory or migration runner.
Python schema and fixture tooling remains retained tooling. It is not part of
the Elysia runtime package. The accepted schema fingerprint and migration
manifest remain unchanged.

## Phase 14.5 contracts boundary

`packages/contracts/` owns the shared auth, student/enrollment, attendance
import, grade/academic, and report query schemas extracted in Phase 14.5. It
exports runtime TypeBox schemas and their derived static types.

`apps/api/` consumes shared request schemas. It keeps query coercion, cookies,
multipart parsing, file handling, headers, and other Elysia transport details.
`apps/web/` consumes shared types with type-only imports where possible.

Database rows and persistence types remain in `packages/db`. Business mapping,
calculations, authorization, backup policy, scheduler policy, and file parsing
remain in `apps/api`. UI state remains in `apps/web`. The Excel implementation
package and full architecture enforcement remain pending.

Database row types stay in `@operatoros/db`. API business logic and mapping stay
in `apps/api/`. Other report, attendance, import, and safety types remain in
their current owners until an exact cross-boundary shape needs extraction.

## Phase 14.6 UI foundation

`packages/ui/` is the `@operatoros/ui` workspace. It owns source-controlled
shadcn primitives and UI-only utilities. New shadcn primitives use Base UI.
The initial foundation contains `Button`, `Dialog`, and `Input`.

The existing web application keeps its global CSS tokens and existing Radix
components. The web package consumes the new package through workspace exports.
The UI package does not import application code, contracts, database code, or
API code. Domain components and page composition remain in `apps/web/`.

The package uses `base-nova` shadcn configuration with the existing `slate`
base color and `lucide` icon setting. This records Base UI through the
style-specific configuration without replacing the current application theme.
Tailwind v4 scans the UI package source from the web stylesheet. The package
does not introduce a second global stylesheet or a shadcn runtime dependency.
React remains owned by `apps/web/` at runtime. The UI package declares React
compatibility as peer dependencies and uses the accepted React version for
tests.

Phase 14.7 will add repository-wide mechanical architecture enforcement.
Turbo remains deferred to Phase 14.8. Broad UI modernization remains deferred
to Phase 18.
