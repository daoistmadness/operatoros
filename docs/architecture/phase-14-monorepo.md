# Phase 14 monorepo architecture

Status: `Phase 14.8` complete after merge. The post-14.7 data directory
insertion and architecture revalidation are complete.

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

Phase 14.7 adds mechanical boundary enforcement through shared ESLint rules and
the semantic `scripts/check-architecture.ts` checker. The checker validates
source imports, type-only imports, re-exports, static dynamic imports, literal
`require()` calls, package manifests, package exports, deep source imports, and
cross-workspace relative imports. It uses the TypeScript compiler API. The real
tree has zero exceptions.

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
7. 14.7: Architecture boundary enforcement. Complete after merge.
8. Post-14.7 insertion: canonical local data directory. Complete after merge.
9. 14.8: Turborepo, mise, and hk. Complete after merge.

Turbo is deferred to Phase 14.8. Excel consolidation is deferred to Phase 17.
Zod is not part of this architecture.

## Phase 15 security ownership

Phase 15 keeps the Phase 14 package graph unchanged. Login rate limiting,
proxy trust, Origin validation, CORS, and backup encryption remain in
`apps/api/`. The DB package only owns persistence and the canonical local data
paths. Contracts and UI do not import security, filesystem, or cryptography
code.

New application backups use version 1 AES-256-GCM envelopes. The live SQLite
database stays unencrypted. `BACKUP_ENCRYPTION_KEY` is a separate 32-byte
Base64 key with a stable key ID. Existing plaintext backups are not rewritten.
Legacy restore requires explicit opt-in.

The API trusts the direct socket peer by default. Forwarded headers require
exact `TRUSTED_PROXY_ADDRESSES` entries. Cookie-authenticated unsafe requests
require an exact configured Origin. The same list drives credentialed CORS.

The repository runs `bun run security:audit` in required CI and on a weekly
schedule. Two temporary transitive advisories are listed with owners and
review dates in `docs/security/dependency-audit-exceptions.md`.

Phase 14 remains the accepted monorepo foundation. Phase 15 does not change
package ownership, API semantics, or database schema semantics. Provider
history cleanup remains pending and unverified.

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
provide the database handle, transaction primitive, schema manifest, Drizzle
schema, and canonical local data paths. `apps/api` consumes these exports. It keeps
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

The Phase 14.7 enforcement uses `bun run lint`, `bun run check:architecture`,
and `bun run test:architecture`. Shared ESLint restrictions live in
`packages/config/eslint/`. The root `check` command and required CI run the
architecture checks and fixture tests. The repository has no architecture
exceptions.

## Canonical local data directory

The post-14.7 data-directory insertion keeps Phase 14.7 boundaries unchanged.
`packages/db/src/data-dir.ts` is the single TypeScript resolver. It returns
absolute normalized paths for:

```text
OPERATOROS_DATA_DIR/
  operatoros.sqlite
  backups/
  logs/
```

The precedence is `OPERATOROS_DATA_DIR`, then deprecated
`OPERATOROS_DEV_DATA_DIR`, then the platform/XDG data directory. The default
keeps repository identity so separate checkouts do not share one development
database. Normal data stays outside Git.

`start-dev.sh` resolves and exports `OPERATOROS_DATA_DIR`. `apps/api` consumes
the exported paths. It uses `DATABASE_URL` only for disposable or externally
managed runs when no explicit data root is selected. An explicit data root and
a conflicting database URL fail fast. An existing
`operatoros-development.db` without `operatoros.sqlite` fails safe and needs
manual migration. No operator data moves automatically.

The API backup and restore services consume the canonical backup directory.
The API logger consumes the canonical log directory. Python lifecycle tooling
accepts the resolved root for compatibility. Tests create disposable roots and
never use the protected operational database. Startup diagnostics report paths
only and do not report secrets.

History remediation removed confirmed runtime database artifacts before this
insertion. Normal retained refs are clean. GitHub-managed pull refs remain a
separate `PROVIDER_HISTORY_CLEANUP_PENDING` risk. Provider-side garbage
collection is unverified.

## Phase 14.8 tooling

Phase 14.8 keeps four tooling authorities separate:

- `mise 2026.8.14` is the validated Mise CLI. The committed `mise.toml` and
  `mise.lock` manage Bun `1.4.0`, hk `1.56.1`, and Python `3.12.3`.
- hk `1.56.1` owns the committed `hk.pkl` Git lifecycle hooks. `HK_MISE=1`
  runs hook steps through the Mise environment. Hooks are optional early
  feedback. CI does not depend on installed hooks.
- Bun remains the JavaScript runtime, package manager, workspace authority,
  and root `bun.lock` authority.
- Turbo `2.10.12` is a root-only Bun development dependency. `turbo.json`
  orchestrates workspace `typecheck`, `test`, and `build` tasks.

Turbo uses `^typecheck`, `^test`, and `^build` dependency edges. The web build
  caches `apps/web/build/**`. Typecheck and unit-test tasks cache logs only.
  E2E, development servers, API generation, data-directory resolution, and
  other side-effecting tasks are uncached. Pure API, boundary, dependency, and
  Node-regression checks use the default cache policy. Operator data under
  `OPERATOROS_DATA_DIR` is outside Turbo's output set.

`bun run test:turbo` proves contracts invalidate API and web, DB invalidates
API but not web, UI invalidates web but not API, and shared architecture
configuration and `bun.lock` invalidate all cached tasks. CI uses
`jdx/mise-action@v4`, installs from the repository Mise configuration, runs
`hk check --all`, and runs Turbo without a required remote cache.

The provider-managed history cleanup remains `PROVIDER_HISTORY_CLEANUP_PENDING`
for 72 pull references. Provider garbage collection is unverified. Broad UI
modernization remains deferred to Phase 18. Excel consolidation remains
deferred to Phase 17. Phase 15 has not started.
