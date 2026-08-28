# Agent execution contract

## Purpose and precedence

OperatorOS is an offline-first school attendance and academic analytics system.
Its active runtime contract is `SQLITE_ONLY_SUPPORTED`,
`LOCAL_BROWSER_RUNTIME`, `POSTGRESQL_NOT_SUPPORTED`, and
`CONTAINER_RUNTIME_NOT_REQUIRED`. The experimental Tauri desktop shell was
removed; the supported normal runtime is a local Elysia backend with the React
frontend in a browser. The former FastAPI backend is retained only in
historical migration evidence.
This file is the authoritative execution contract for coding agents. A nested
`AGENTS.md` may add local refinements but cannot weaken this contract. Current
detail lives in [docs/README.md](docs/README.md); product-audit documents are
historical evidence unless they explicitly identify a current procedure.

## Environment and dependencies

- Work in Ubuntu WSL. Use `backend/.venv/bin/python` for Python commands.
- Use `mise` as toolchain-version authority. `mise.toml` pins Bun 1.4.0, hk 1.56.1, and Python 3.12.3. The root `bun.lock` is the package-manager lockfile authority. Bun remains the package manager; mise installs tools.
- Run `mise install` to install exact runtimes from `mise.lock`. Run `mise run doctor` to verify.
- Read relevant code and documentation before editing. Prefer the smallest safe
  change; do not refactor unrelated code or generated artifacts.

### WSL Bun runtime

- Use only the native Linux Bun installation via mise.
- Before executing Bun commands, inspect `command -v`, `type -P`, and `readlink -f`. Reject candidates that
  resolve to `/mnt/c`, another `/mnt/<drive>`, `WindowsApps`, `Program Files`,
  `.exe`, `.cmd`, `.bat`, or UNC-like Windows paths. Never execute a
  rejected Windows binary.
- `./scripts/validate-wsl-bun.sh --probe .` is validation-only.
- Normal launchers use `operatoros_wsl_prepare_bun` to validate the environment and prepend the Bun bin directory to `PATH`.

## Git and worktree safety

- Use focused `codex/` branches unless the task specifies another name. Do not
  amend, rebase, squash, force-push, or push directly to `main`.
- Accepted Phase 14.8 implementation baseline: `a203617b0a38c57213ceca514581d25bb36f7cf5`.
  The final Phase 14 audit may add only a narrow signed documentation or hygiene repair.
- Stage explicit paths only; never use `git add .` or `git add -A`.
- Preserve user-owned `PROJECT_CONTEXT.md`, `f22`, and, when present,
  `docs/student-data/dapodik-roster-import-design.md`.
- In the primary checkout, `PROJECT_CONTEXT.md` is modified and unstaged, and
  `f22` is untracked. Do not stage or discard either file.
- Preserve `wip/followups-api-preservation-20260728-013523` at
  `07b7211b73a59f0032dc33c0c43741d884b38741`: never merge, copy, modify, or
  delete it.

## Protected operational data

- `backend/attendance.db` is the protected operational database. Its expected
  current schema is S4.3 (`20260725_s43`), not a test fixture.
- Tests, E2E, development startup, and committed fixtures must never use it.
  Use explicit disposable databases instead.
- Ordinary startup validates existing databases; it never migrates them.
- Do not modify the operational database or rollback backups unless the user
  explicitly authorizes that exact operation. Do not commit local backup paths,
  checksums, rows, names, credentials, tokens, or personal data.
- Controlled operational migrations require the wrapper's explicit preflight,
  lock, verified fresh backup, and process-local operational context. See
  [database operations](docs/operations/DATABASE_OPERATIONS.md).

## Development startup and database

- `./start-dev.sh` is the canonical normal development entrypoint. It defaults
  to Elysia and reports
  `DATABASE_URL` configuration drift, validates and recovers the WSL Bun
  runtime, uses the canonical persistent development database, enforces one
  managed session, starts the backend first, waits for backend and frontend
  readiness, and performs managed shutdown.
- Python remains available for disposable schema, fixture, and operations tools.
- The launcher expects `backend/.venv` to exist. Ordinary startup does not
  create the virtual environment or install dependencies. GitHub CI may create
  its own virtual environment as defined by CI.
- `backend/.env` or the current shell can define `DATABASE_URL`. Managed
  development warns about that value and uses the canonical persistent
  development database instead. Do not select a development database from
  ambient `DATABASE_URL` or automatically adopt an old database.
- `OPERATOROS_DATA_DIR` is the canonical local data-root override. It derives
  `operatoros.sqlite`, `backups/`, and `logs/`. Normal operator data stays
  outside Git.
- `OPERATOROS_DEV_DATA_DIR` is a deprecated compatibility alias. The canonical
  variable takes precedence. Existing legacy data is never moved automatically.
- An existing legacy development database without the new database fails safe
  and requires manual operator migration.
- Use `make dev-db-status`, `make dev-db-reset`, and
  `make dev-sessions-status` for the existing managed workflows. Use the
  repository-defined confirmation token for reset operations.
- Agents must use verified session ownership, PID/process-group ownership,
  stale-session checks, bounded shutdown, and backend readiness before frontend
  startup. Do not kill arbitrary port occupants, use `kill -9` on unknown
  listeners, or remove an unverified stale process automatically.
- A real primary-checkout launcher smoke recovered through Linux NVM, reached
  backend and frontend readiness, completed managed shutdown, and left zero
  launcher-owned processes. This smoke did not run the full test suites.
- The same smoke accessed or modified the protected operational database: no.

## Schema and rollback

- `20260724_s42` is the fresh-bootstrap baseline; `20260725_s43` is the
  current runtime and operational head. Existing S4.2 databases require an
  explicit controlled migration.
- Current normal application pairs with S4.3. Rollback pairs a restored S4.2
  database with `c06a6220c2c0c2059521c1a396d1b914635aacff` from
  `maintenance/s42-rollback`. The historical
  `b47632c4210720f81804212544452c7c900c928c` is audit-only and must not run.
- New migrations require SQLite compatibility, current-schema and fresh-parity
  tests, and must not bypass schema guards or audit triggers. PostgreSQL
  reconsideration requires a new ADR and separate authorization.

## Testing and reporting

- `make test-fast` is focused and changed-path-aware; use it for docs-only and
  iterative work. `make test-pr` is the ordinary PR gate. `make test-release`
  is for release/schema/startup-sensitive work. `make fresh-db-parity` checks
  fresh bootstrap parity. The classifier decides when duplicate backend runs
  are required; do not run the release suite for Markdown-only edits.
- Workspace checks use `bun --filter @operatoros/api test`,
  `bun --filter @operatoros/web test`, `bun run check:typebox`, and
  `bun run check`.
- Verify UI work in a real browser when available. E2E uses isolated temporary
  data and ports; never kill unknown port owners. Remove temporary artifacts.
- Final reports state files changed, verification actually run, uncertainty,
  and any preserved worktree entries. Do not claim unrun checks passed.

## Frontend and API boundaries

- Use TypeScript and the existing feature ownership boundaries; do not perform
  a big-bang feature reorganization. Route modules are lazy-loaded where
  established. Reuse shared primitives and follow `apps/web/DESIGN.md`.
- Use TanStack Query and the sanitized API-error foundation. Pages consume
  feature APIs, not generated OpenAPI code directly.
- Browser-visible APIs use canonical `/api/<domain>/...` paths through the
  shared API abstraction; do not hardcode backend domains or double-prefix.
- Generated OpenAPI contracts are version-controlled and drift-checked. Run
  the documented generation/check workflow for API changes.

## Phase 14 monorepo modernization

Phase 14.1 established workspace tooling. Phase 14.2 moved the authoritative
API to `apps/api/`. Phase 14.3 moved the authoritative web application to
`apps/web/`. Phase 14.4 extracted persistence to `packages/db/`. Phase 14.5
extracted shared TypeBox contracts to `packages/contracts/`. Phase 14.6
established the reusable Base UI foundation in `packages/ui/`. Phase 14.7
mechanically enforces the package boundaries. The post-14.7 data-directory
insertion keeps that gate valid.

Current physical structure:

- `apps/api/`
- `apps/web/`
- `packages/db/`
- `packages/contracts/`
- `packages/ui/`
- `packages/config/`

Read [the Phase 14 architecture](docs/architecture/phase-14-monorepo.md) for
package ownership and dependency directions.

Never pin `@sinclair/typebox` independently in a workspace package. Use
`catalog:`. Change the root catalog entry when the OperatorOS TypeBox version
changes.

Binding dependency rules start in Phase 14.1. Phase 14.7 mechanically enforces
them:

- `packages/contracts` must not import `elysia`, `drizzle-orm`, `react`, or `apps/*`.
- `packages/db` must not import `apps/*`.
- `packages/ui` must not import `apps/*` or `packages/db`.
- `packages/ui` must not import `@operatoros/contracts`, `@operatoros/api`, `elysia`, or `drizzle-orm`.
- `apps/api` must not import `@operatoros/ui`.
- `packages/db` and `packages/contracts` must not import `@operatoros/ui`.
- `apps/web` must not import `packages/db`, `packages/excel`, or API internals.
- `packages/*` must not import `apps/*`.
- Cross-workspace imports must use package exports.
- Deep `@operatoros/*/src` imports are forbidden.
- Cross-workspace relative source imports are forbidden.

`@operatoros/contracts` owns only schemas and types that cross an application
or package boundary. It uses plain `@sinclair/typebox` through `catalog:`.
It must not import Elysia, Drizzle, React, `@operatoros/db`, or `apps/*`.
HTTP transport details remain in `apps/api/`. Database rows remain in
`@operatoros/db`.

`@operatoros/db` owns the Drizzle schema, migrations when present, low-level
SQLite client lifecycle, persistence representation, and canonical local data
path resolution. Business services,
HTTP behavior, and backup or scheduler policy remain in `apps/api/`.
`apps/web/` must not import `@operatoros/db` or persistence dependencies.

`@operatoros/ui` owns reusable presentation primitives and source-owned shadcn
components. New shadcn components use Base UI. The package uses package
exports. It does not own routes, data fetching, business forms, or domain
components. Existing Radix components may remain in `apps/web/`. Broad UI
modernization is deferred to Phase 18.

Phase 14.1 through 14.7 validation commands remain available. Use these
workspace commands for current application checks:

- `bun --filter @operatoros/contracts test`
- `bun --filter @operatoros/contracts typecheck`
- `bun --filter @operatoros/db test`
- `bun --filter @operatoros/db typecheck`
- `bun --filter @operatoros/ui test`
- `bun --filter @operatoros/ui typecheck`
- `bun --filter @operatoros/api test`
- `bun --filter @operatoros/web test`
- `bun run check:typebox`
- `bun run check:contracts`
- `bun run check:ui`
- `bun run lint`
- `bun run check:architecture`
- `bun run test:architecture`
- `bun run check`

The semantic architecture checker uses the TypeScript compiler API. It scans
source imports, type-only imports, re-exports, static dynamic imports, literal
`require()` calls, package manifests, package exports, cross-workspace relative
imports, and deep source imports. It reports zero real-tree exceptions. Phase
14.8 establishes the tooling split. `mise` manages CLI versions. `hk`
manages Git lifecycle hooks. Bun remains the JavaScript runtime, package
manager, workspace resolver, and lockfile authority. Turbo 2.10.12 manages the
dependency-aware task graph and local cache. Turbo is a root-only dependency.

Use `bun run turbo:check` for cached typecheck, unit-test, and web-build tasks.
Use `bun run test:turbo` for invalidation proofs. Do not cache E2E, database
mutation, backup, restore, scheduler, runtime, or development-server tasks.
Operator data never enters the Turbo or mise caches. Hooks provide early local
feedback. CI runs the checks directly and does not require installed hooks.

Run `hk check --all` for the configured fast checks. Developers may install
repository hooks with `mise exec -- hk install --mise`. Repository setup does
not change global Git configuration automatically. Phase 15 has not started.

The canonical local data resolver is `packages/db/src/data-dir.ts`. It returns
absolute normalized paths for the data root, database, backups, and logs.
`OPERATOROS_DATA_DIR` takes precedence over deprecated
`OPERATOROS_DEV_DATA_DIR`, then the platform/XDG default with repository
identity. Startup forwards this root and does not migrate an existing database
automatically. Tests use disposable roots. Provider-managed history cleanup
remains separately documented as pending.

## Stop and escalate

Stop for unclear or conflicting requirements, missing credentials/data,
unrelated failing tests, destructive/broad changes, or any request that weakens
database, authorization, audit, or Git safeguards. See
[CONTRIBUTING.md](CONTRIBUTING.md) for workflow and
[docs/README.md](docs/README.md) for detailed current guidance.

## Prompt Writing Standard

- All future repository implementation prompts must start with `/plan`. Do not
  use `/goal`.
- Use Simplified Technical English style. Use clear, specific, active-voice
  instructions. Use short sentences, one instruction per sentence, and one
  topic per paragraph. Use vertical lists for complex information. Use the
  same technical term for the same thing. Keep conditions, safety rules, and
  expected results explicit. Avoid ambiguous or unnecessary words.
- Prefer 20 words or fewer for procedure sentences and 25 words or fewer for
  descriptive sentences. Do not remove necessary subjects, verbs, or articles
  only to shorten a sentence. Do not claim strict ASD-STE100 compliance unless
  the text was checked against the official controlled vocabulary.
- Prefer this structure when it fits the task: `/plan`, Purpose, Current State,
  Required Changes, Safety Rules, Validation, Git Rules, Acceptance Criteria,
  and Final Report. Use only the sections that the task needs. Do not repeat
  the same rule in multiple sections.
- Keep technical identifiers exact, including `mise.toml`, `mise.lock`, `backend/.venv`,
  `DATABASE_URL`, `origin/main`, `PROJECT_CONTEXT.md`,
  `operatoros_wsl_prepare_bun`, and `./start-dev.sh`.
