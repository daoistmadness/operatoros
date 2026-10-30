# AGENTS.md — AI Coding Agent Guidelines

## Core Instructions

You are a senior software engineer. Deliver simple, maintainable, reliable solutions that satisfy the user's requirements without unnecessary complexity.

Before making changes:

1. Read the project's `AGENTS.md` and any applicable nested `AGENTS.md` files.
2. Understand the existing architecture, conventions, and dependencies.
3. Reuse existing utilities, components, and patterns wherever practical.
4. Make the smallest safe change that fully solves the problem.
5. Follow **KISS, YAGNI, and DRY** throughout implementation.

## Engineering Principles

### 1. KISS — Keep It Simple, Stupid

Prefer the simplest solution that correctly meets the requirements.

- Favor readable, straightforward code over clever implementations.
- Avoid unnecessary layers, abstractions, patterns, and dependencies.
- Keep functions and components focused on a clear responsibility.
- Use descriptive, consistent naming.
- Prefer established project conventions over introducing new approaches.
- Do not compromise correctness, security, or maintainability for brevity.

**Rule:** If two solutions work equally well, choose the simpler one.

### 2. YAGNI — You Aren't Gonna Need It

Implement only what is required for the current task.

- Do not build speculative features or future-proofing infrastructure.
- Avoid unnecessary configuration, extension points, and generic frameworks.
- Do not introduce dependencies without a demonstrated need.
- Avoid unrelated refactoring or expanding the task's scope.
- Implement additional flexibility only when current requirements justify it.

**Rule:** Do not build something merely because it might be useful later.

### 3. DRY — Don't Repeat Yourself

Maintain a single authoritative representation of shared knowledge and business logic.

- Reuse existing functions, utilities, and components.
- Consolidate duplicated business rules and validation logic.
- Keep constants and configuration centralized when appropriate.
- Avoid copying logic across files when a clear shared solution exists.
- Do not create abstractions solely because two small pieces of code look similar.
- Prefer a little harmless duplication over a complex or misleading abstraction.

**Rule:** Abstract repeated knowledge, not every repeated line.

## Implementation Workflow

1. **Understand:** Identify the requested outcome and inspect relevant code.
2. **Plan:** Choose the smallest viable implementation.
3. **Reuse:** Check for existing solutions before writing new ones.
4. **Implement:** Make focused changes consistent with the codebase.
5. **Verify:** Run relevant tests, linting, and type checks when available.
6. **Review:** Remove unnecessary complexity, duplication, and unrelated changes.
7. **Report:** Summarize what changed and note any verification limitations.

## Decision Priorities

When making technical decisions, prioritize:

1. Correctness and security
2. Existing project requirements and conventions
3. Simplicity (KISS)
4. Current needs over hypothetical needs (YAGNI)
5. Meaningful reuse without over-abstraction (DRY)
6. Maintainability and testability

If principles conflict, favor clarity and correctness over rigid adherence.

## Avoid

- Overengineering simple requirements
- Premature optimization
- Unnecessary design patterns
- Speculative abstractions
- Unrequested features
- New dependencies without clear justification
- Duplicate business logic
- Unrelated refactoring
- Excessive boilerplate
- Changing working code without a concrete reason

## Definition of Done

A task is complete when:

- The requested functionality works.
- Existing behavior remains intact unless explicitly changed.
- The implementation follows project conventions.
- Relevant tests pass, or limitations are clearly reported.
- No unnecessary features or abstractions were added.
- Duplicated knowledge is minimized.
- The final result is easy to understand and maintain.

**Guiding philosophy: Build only what is needed, keep it simple, and avoid repeating knowledge.**

<!-- intent-skills:start -->
## Skill Loading

Use the repository’s installed Intent. If it is unavailable, report the missing dependency instead of downloading a replacement.
Before editing files for a substantial task:
- Run `bunx --no-install --package @tanstack/intent intent list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `bunx --no-install --package @tanstack/intent intent load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

<!-- intent-maintainer:start -->
## Library Skill Maintenance

Use the repository’s installed Intent. If it is unavailable, report the missing dependency instead of downloading a replacement.
Before substantial library source, documentation, examples, tests, or skill work, run `bunx --no-install --package @tanstack/intent intent meta generate-skill` and follow the packaged maintainer procedure.
Use the current request and repository evidence. For initial skills, propose a useful batch and reuse any scope already agreed with the maintainer.
Before handing off a skill batch or library change, run `bunx --no-install --package @tanstack/intent intent maintainer review --json`. Follow the maintainer procedure to update affected guidance, run task checks, and record completed review outcomes. Report an evidence-backed no-op or missing evidence explicitly.
Create and incrementally maintain domain_map.yaml, skill_spec.md, and skill_tree.yaml in the established artifact location for every skill batch. Preserve prior tasks, maintainer decisions, and remaining work.
Keep maintainer decisions and changes in the repository; do not require the user to repeat the procedure in later sessions.
Use intent maintainer setup to initialize missing records, maintainer add to register skills, maintainer status to identify work, and maintainer sync to update generated metadata. Finish with intent maintainer check.
<!-- intent-maintainer:end -->

## Repository execution contract

This file owns execution rules. Nested `AGENTS.md` files may add local rules
but cannot weaken safeguards. Follow the user's authorized scope; do not ask
again for routine work already authorized. Source, lockfiles, and live GitHub
settings establish current facts. Historical audits are evidence, not procedure.
Start with [docs/README.md](docs/README.md).

## Documentation rules

Follow [the documentation system](docs/decisions/documentation-system.md).
Keep maintained project docs in the architecture, guides, reference, decisions,
runbooks, or session areas. docs/README.md is the only loose Markdown file in
docs/. Use one topic per kebab-case page, add status and last_reviewed front
matter, and link every maintained page from the index. The protected Dapodik
design is the explicit content and front-matter exception. Keep package-owned,
generated, release, and contributor docs with their existing owners.

Session logs belong only in docs/session/; they are non-authoritative.
Promote durable facts into their canonical page. Add one user-facing
CHANGELOG.md bullet under [Unreleased] for every PR. Add the PR number after
GitHub assigns it. Use the skip-changelog label only when the change has no
release-history impact. The repository CI checks the docs layout, front
matter, index, links, and changelog bullet.

## Runtime and ownership

OperatorOS is an offline-first school attendance and academic analytics system.
Runtime contract: `SQLITE_ONLY_SUPPORTED`, `LOCAL_BROWSER_RUNTIME`,
`POSTGRESQL_NOT_SUPPORTED`, `CONTAINER_RUNTIME_NOT_REQUIRED`.
Run the local Elysia backend (`apps/api/`) and React browser frontend
(`apps/web/`). Tauri is removed. `backend/` holds migration, fixture, and
operations tooling; it is not the production backend.

- `@operatoros/db` owns Drizzle schema, SQLite lifecycle, and `packages/db/src/data-dir.ts`. Business services, HTTP, backup policy, and scheduling belong in `apps/api/`.
- `@operatoros/contracts` owns cross-boundary TypeBox DTO schemas/types. Keep HTTP transport in API and database rows in DB. Use explicit internal-to-DTO mappers.
- `@operatoros/ui` owns domain-neutral primitives and source-owned shadcn components; use Base UI for new primitives. Keep routes, fetching, business forms, and domain rules in web. Existing web Radix components may remain.
- `@operatoros/excel` owns Excel infrastructure. Server DTOs supply attendance, grades, KKM, and rankings. ExcelJS `4.4.0` owns `.xlsx`; `@e965/xlsx` handles legacy `.xls`. Preserve format parity. Authoritative exports use the API.
- Cross-workspace imports use package exports. No deep `@operatoros/*/src`, relative cross-workspace source imports, or `packages/*` imports of `apps/*`. Contracts must not import Elysia, Drizzle, or React. UI must not import DB, contracts, API, Elysia, or Drizzle. API, DB, and contracts must not import UI. Web must not import DB, Excel, or API internals. Run `bun run check:architecture`.

## Backend skills and conventions

For Elysia backend implementation, debugging, review, or explicit migration,
load `@operatoros/agent-skills#elysiajs` with
`bun run skills:load @operatoros/agent-skills#elysiajs`. Read only the
references needed for the task. The package is explicitly allowlisted in the
workspace Intent config.

Check `apps/api/package.json`, `bun.lock`, and existing code. The backend uses
Elysia 1.4.29; the installed skill describes v2. Use installed types
and [v1 documentation](https://elysiajs.com/llms.txt) for v1 code. Do not copy
v2 route signatures or TypeBox APIs, upgrade dependencies, add Eden, replace
authentication, or change deployment merely because a skill example does so.
Keep TypeBox on the root `catalog:` entry; never pin it per package.

Follow the [feature golden path](docs/architecture/change-safety-golden-path.md):
identify canonical authority, domain owner, shared DTO, mapper, authorization
scope, query-key owner, and mutation invalidations before cross-layer changes.
Keep explicit route registration in `apps/api/src/app.ts`. Test affected routes,
including rejection paths, and run API typechecking. Preserve stable ownership.

## Frontend and domain rules

- Use canonical `/api/<domain>/...` paths through `apps/web/src/lib/api/client.ts`. Pages consume feature APIs. Keep OpenAPI contracts versioned and drift-checked. Follow [web design](apps/web/DESIGN.md), reuse primitives, and lazy-load routes.
- Keep one in-memory TanStack Query client. Never persist authenticated queries or analytics in `localStorage`. Include every filter in query keys, invalidate targeted data after mutations, and clear protected data on logout.
- Use sanitized API errors. Preserve loading, empty, error, conflict, and authorization states.
- Compute metrics on the server using canonical SQL and [metric definitions](docs/reference/metrics.md). Browser code formats/adapts for Chart.js. No client recomputation or persisted rollups without benchmark evidence and review. Use TanStack Table only for a bounded justified table. Do not add TanStack Form, Zod, or another chart library without explicit architecture approval. The approved frontend optimization rollout includes the scoped TanStack Form staff pilot and Management Overview Unovis chart documented in [frontend architecture](docs/architecture/frontend.md); do not expand those integrations into wholesale migrations. TanStack Router is permitted as the routing solution (migration from React Router is authorized).

## Verification workflow

Read scoped instructions and callers before editing. Make the smallest complete
change, reuse existing patterns, and update affected tests with synthetic data.
Implementation prompts start with `/plan`; keep code identifiers exact.

Toolchain authorities: `mise.toml`, `mise.lock`, `package.json`, `bun.lock`,
`Makefile`, and [COMMANDS.md](COMMANDS.md). Native workflows use Linux Bun
resolved by mise. The optional `scripts/podman-dev.sh` workflow pins Bun 1.4.4
in its local development image and does not change the supported runtime.
The active CLI typechecker is TypeScript 7.0.2 through the root
`@typescript/native` alias; Bun 1.4.4's `bun check` also runs in CI. TypeScript
5.9.3 remains for compiler-API and TypeScript 5 peer consumers, not workspace
CLI typechecks.
HK 2.8.1 is pinned in `mise.toml` and uses the matching versioned Pkl schema in
`hk.pkl`. Keep its hook-local configuration when preserving current behavior:
top-level `steps` materializes implicit `check`, `fix`, and `pre-commit` hooks.
This repository does not define a `fix` hook.
Before running Bun, inspect `command -v`, `type -P` (in Bash), and `readlink -f`.
Reject `/mnt/<drive>`, WindowsApps, Program Files, `.exe`, `.cmd`, `.bat`, and
UNC-like paths. `operatoros_wsl_prepare_bun` and `validate-wsl-bun.sh` are legacy
compatibility identifiers, not WSL onboarding requirements.

1. Install locked tools with `mise install` and dependencies with `bun install --frozen-lockfile`. `mise run doctor` checks the checkout, prerequisites, and configured development DB; use an approved disposable data root for agent validation.
2. Use `mise run dev` through `./start-dev.sh`; `./start-dev.sh --check` validates startup. Inspect managed sessions before starting services.
3. Use `mise run test:fast` for iteration. Fetch `origin/main` before `mise run check:affected`. `bun run turbo:check` runs the complete package graph. See [test strategy](docs/guides/testing.md).
4. For Markdown-only changes, run `mise run test:fast`, `bun .github/scripts/check-markdown-links.ts`, `bun .github/scripts/check-markdown-organization.ts`, and `bun .github/scripts/check-current-developer-docs.ts`. Do not run the local full release gate for documentation-only edits.
5. Run `mise run check:full` for release-sensitive changes and `mise run db:fresh` for schema/bootstrap work. Use relevant security and Excel parity checks. `hk check --all` runs lint and architecture checks.
6. Validate E2E tooling with `make e2e-validate`. Local smoke: `timeout 300 make e2e-smoke`. `make e2e-full` is CI-only without explicit owner approval. Verify user-visible UI in a real browser; `./scripts/verify-browser.sh` is the repository's live-stack smoke workflow.

CI uses one repository-owned workflow, `.github/workflows/ci.yml`, with parallel
package and complete browser/API smoke checks. GitHub-managed security workflows
remain separate. Required checks and schedules are documented in
[CI operations](.github/CI.md). No path exclusions satisfy a mandatory PR gate.
Report files, checks actually run, uncertainty, and preserved worktree entries. Never claim pending checks, queued auto-merge, or unrun tests succeeded.

## Git and worktree safeguards

Fetch `origin`, inspect the latest green `origin/main`, and use a focused
`codex/` branch. Use a separate worktree when the shared checkout is dirty.
Stage explicit paths only. Never amend, rebase, squash locally, force-push,
push directly to `main`, use `--admin`/`--no-verify`, or bypass a failing check.
`rebase.autoStash=true` does not authorize rebasing dirty branches; stop on an
autostash conflict.

Authorized PRs use GitHub squash merge with `--match-head-commit`; auto-merge may
wait for checks. Zero human approvals does not remove technical gates. Preserve
strict up-to-date validation, no administrator bypass, and force-push/deletion
protection. Follow [CONTRIBUTING.md](CONTRIBUTING.md) for merge verification,
post-merge checks, two focused correction attempts, and protected revert PRs.

Preserve all user work, especially `PROJECT_CONTEXT.md`, `f22`, and
`docs/student-data/dapodik-roster-import-design.md` when present. Never merge,
copy, modify, or delete `wip/followups-api-preservation-20260728-013523` at
`07b7211b73a59f0032dc33c0c43741d884b38741`.

WIP reference clarification (2026-10-24): Read-only checks found both the
local branch and `origin` tracking ref for
`wip/followups-api-preservation-20260728-013523` at
`0763b624c5d2f08a6e4c590d4d5e867bf07fe777`. These SHAs identify distinct
commits and are not interchangeable. The provenance of the discrepancy and
authorization for any ref movement are unknown. This note preserves the
historical pin above and does not authorize changing either ref.

Protect `~/code/repos/operatoros`, `~/code/worktrees/operatoros/`, and
`~/.local/share/operatoros/development/`. Prune only clean integrated worktrees
after fetching and verifying merged-main: inspect
`wt step prune --dry-run --min-age=0s` before `--foreground`. Never force-delete,
use `wt merge`, or clean before verification.

## Data and security safeguards

- `OPERATOROS_DATA_DIR` owns the data root and derives `operatoros.sqlite`, backups, and logs. `OPERATOROS_DEV_DATA_DIR` is deprecated. Never select a development database from ambient `DATABASE_URL`. Alternate ports do not isolate shared development data.
- Startup validates existing DBs; it never migrates them. Schema authority is
  `packages/db/src/manifest.ts`; fresh bootstrap installs the S4.7 base plus
  S4.8 employee, S4.9 school-unit, S5.0 monthly PTK, S5.1 UPP archive, S5.2
  student administration, S5.3 student identity verification, and S5.4 BOSP
  reminder extensions. The current schema head is `20261027_s54`. The protected
  operational DB stays S4.3 until separately authorized migration. Never
  read/use/modify it or rollback backups for agent validation.
- New migrations need synthetic current-schema, fresh-parity, failure, and recovery tests. Operational migration needs exact authorization, wrapper preflight, exclusive lock, fresh verified backup, and process-local context. Follow [database operations](docs/runbooks/database-operations.md) and [data reset](docs/runbooks/data-reset.md). A Git revert is not database recovery. PostgreSQL reconsideration needs a new ADR.
- Keep `astyx_session` an HttpOnly server-side cookie; no JWT/localStorage auth. Unsafe cookie-authenticated requests require the configured exact Origin. Trust forwarded IPs only from exact direct peers in `TRUSTED_PROXY_ADDRESSES`. Backups require AES-256-GCM and a `BACKUP_ENCRYPTION_KEY` different from `AUTH_COOKIE_SECRET`. Follow [security hardening](docs/reference/security-model.md) and [rotation](docs/runbooks/secret-rotation.md).
- Never commit personal data, credentials, backup paths, live checksums, or records. Do not hand-edit generated builds, dependencies, runtime state, local SQLite files, backups, logs, or generated Excel/PDF outputs. See [CONVENTIONS.md](CONVENTIONS.md).
- Never kill unknown port owners or remove unverifiable processes. E2E owns temporary roots/ports and removes only its artifacts.

Stop for genuinely ambiguous domain rules, conflicting requirements, missing
access/data, unrelated failing tests, unapproved destructive/broad changes,
dependency upgrades, API/schema changes, file deletes/renames, generated-file
edits, or security/auth changes outside the authorized task. Never weaken DB,
authorization, audit, or Git safeguards. Sensitive authorized changes require
positive/negative tests, authorization and transaction checks, and relevant
collision, retry, idempotency, failure, and recovery coverage.
