# Agent execution contract

This file is the authoritative execution contract. A nested `AGENTS.md` may add
local refinements but cannot weaken it. Product-audit documents are historical
evidence unless they state a current procedure. See [docs/README.md](docs/README.md).

## Overview

OperatorOS is an offline-first school attendance and academic analytics system.
Runtime contract: `SQLITE_ONLY_SUPPORTED`, `LOCAL_BROWSER_RUNTIME`,
`POSTGRESQL_NOT_SUPPORTED`, `CONTAINER_RUNTIME_NOT_REQUIRED`. Supported runtime
is a local Elysia backend (`apps/api/`) with the React frontend (`apps/web/`)
in a browser. The Tauri shell was removed; the FastAPI backend is migration
evidence only. Monorepo: `apps/api/`, `apps/web/`, `packages/db/`,
`packages/contracts/`, `packages/ui/`, `packages/excel/`, `packages/config/`.

## Commands

Authorities: `mise.toml` (Bun 1.4.2, hk 1.56.1, Node 24.19.0, Python 3.12.3),
`package.json`, `Makefile`, [COMMANDS.md](COMMANDS.md); `bun.lock` + `mise.lock`
are the lockfile authorities; CI runs these directly in `.github/workflows/ci.yml`.

- `mise install`; `mise run doctor` — install exact runtimes; verify checkout.
- `bun install --frozen-lockfile` — install workspace dependencies (mandatory).
- `mise run dev` (via `./start-dev.sh`) — canonical dev entrypoint; `./start-dev.sh --check` validates without starting.
- `mise run check:affected` (fetch `origin/main` first) — Turbo typecheck/test/build for affected packages; `bun run turbo:check` — full graph.
- `mise run test:fast` — changed-path-aware tier; `mise run check:full` (`make test-release`) — release gate, never for Markdown-only edits; `mise run db:fresh` (`make fresh-db-parity`) — bootstrap parity.
- `bun run check` — root lint + type + architecture + tests. Also `bun run lint`, `typecheck`, `check:typebox`, `check:architecture`, `test:architecture`, `check:contracts`, `check:ui`.
- `bun run test:security`, `bun run security:audit` — security tests + dependency audit. `bun --filter @operatoros/excel test` — Excel parity.
- `hk check --all` — fast hooks; install with `mise exec -- hk install --mise`.
- `bun .github/scripts/check-markdown-links.ts`, `bun .github/scripts/check-current-developer-docs.ts` — docs validation.
- `make dev-db-status`, `make dev-sessions-status` — inspect managed DB/sessions; `make dev-db-reset` needs the repository confirmation token.
- `make e2e-validate`; local blocking smoke `timeout 300 make e2e-smoke`; `make e2e-full` is GitHub-Actions-only without explicit owner approval; `./scripts/verify-browser.sh` — browser smoke on a live stack.

Use only the native Linux Bun resolved by mise. Before running Bun, inspect
`command -v`, `type -P`, `readlink -f`; reject `/mnt/c`, `/mnt/<drive>`,
`WindowsApps`, `Program Files`, `.exe`, `.cmd`, `.bat`, UNC-like paths and
never execute them. `validate-wsl-bun.sh` / `operatoros_wsl_prepare_bun` are
legacy compatibility identifiers, not onboarding requirements.

## Structure

- `@operatoros/db` (`packages/db/`) owns Drizzle schema, SQLite lifecycle, and canonical data-path resolution (`packages/db/src/data-dir.ts`). Business services, HTTP, backup/scheduler policy stay in `apps/api/`.
- `@operatoros/contracts` owns only cross-boundary TypeBox schemas/types; HTTP transport stays in `apps/api/`, DB rows in `@operatoros/db`.
- `@operatoros/ui` owns reusable domain-neutral primitives and source-owned shadcn (new ones on Base UI). No routes, fetching, business forms, or domain rules. Existing Radix components may remain in `apps/web/`.
- `@operatoros/excel` (`packages/excel/`) owns Excel infrastructure only. `backend/` is retained migration/fixture/operations tooling, not production runtime; `backend/attendance.db` is never the developer authority.
- Generated/untouchable: `apps/web/build/`, `node_modules/`, `e2e-results/`, `.runtime/`, local `*.sqlite`, backups, logs, generated Excel/PDF outputs. See [CONVENTIONS.md](CONVENTIONS.md) and [phase-14 architecture](docs/architecture/phase-14-monorepo.md).

## Conventions

- Never pin `@sinclair/typebox` per-package; use the root `catalog:` entry.
- Enforced by `bun run check:architecture` (`scripts/check-architecture.ts`): `packages/*` must not import `apps/*`; cross-workspace imports use package exports only; deep `@operatoros/*/src` and relative cross-workspace source imports are forbidden; `packages/contracts` must not import `elysia`, `drizzle-orm`, `react`, or `apps/*`; `packages/ui` must not import `apps/*`, `packages/db`, `@operatoros/contracts`, `@operatoros/api`, `elysia`, or `drizzle-orm`; `apps/api` must not import `@operatoros/ui`; `packages/db`/`packages/contracts` must not import `@operatoros/ui`; `apps/web` must not import `packages/db`, `packages/excel`, or API internals.
- API: canonical `/api/<domain>/...` through the shared client (`apps/web/src/lib/api/client.ts`); no hardcoded backend domains or double-prefix. Pages consume feature APIs, not generated OpenAPI code directly; OpenAPI contracts are version-controlled and drift-checked. Follow `apps/web/DESIGN.md`; reuse shared primitives; lazy-load routes.
- Web state: one in-memory TanStack Query client; never persist authenticated query/analytics data to `localStorage`. Query keys include every data filter; mutations use targeted invalidation; logout clears protected data. Use the sanitized API-error foundation; preserve loading, empty, error, conflict, and authorization distinctions.
- Cross-layer features follow the [Change Safety & Feature Golden Path](docs/architecture/change-safety-golden-path.md): name canonical authority, domain owner, shared TypeBox DTO, explicit internal-to-DTO mapper, authorization scope, query-key owner, and mutation invalidations first. Do not move stable features to satisfy folder conventions.
- Metrics are server-computed with canonical SQL; definitions live in [docs/analytics/METRICS.md](docs/analytics/METRICS.md). Browser code formats and adapts for Chart.js only. No recomputed business metrics, no persisted rollups without benchmark evidence and review. TanStack Table only for a bounded, justified table. Do not add TanStack Router/Form, Zod, or a new chart library. ExcelJS `4.4.0` is the `.xlsx` authority (`@e965/xlsx` for legacy `.xls`); Excel gets metrics from server DTOs, never computes attendance/grades/KKM/rankings; keep `.xls`/`.xlsx` parity tested; browser never generates authoritative reports — use the API export flow.
- Auth: `astyx_session` stays an HttpOnly server-side cookie; no JWT or localStorage auth. Forwarded-IP headers are untrusted unless the exact direct peer is in `TRUSTED_PROXY_ADDRESSES`. Cookie-authenticated unsafe requests require the configured exact Origin. New backups require AES-256-GCM encryption with `BACKUP_ENCRYPTION_KEY` differing from `AUTH_COOKIE_SECRET`. See [SECURITY_HARDENING.md](docs/security/SECURITY_HARDENING.md) and [ROTATION_RUNBOOK.md](docs/security/ROTATION_RUNBOOK.md).
- Data: `OPERATOROS_DATA_DIR` is the canonical data-root override (derives `operatoros.sqlite`, `backups/`, `logs/`); `OPERATOROS_DEV_DATA_DIR` is a deprecated alias. Startup validates but never migrates databases; never select a dev database from ambient `DATABASE_URL`. Tests/E2E use disposable synthetic roots only. Schema: `20260724_s42` fresh baseline, `20260929_s47` current head; protected operational DB stays S4.3 until a separately authorized migration (see [DATABASE_OPERATIONS.md](docs/operations/DATABASE_OPERATIONS.md)). Rollback pairs a restored S4.2 DB with `c06a6220c2c0c2059521c1a396d1b914635aacff` (`maintenance/s42-rollback`); `b47632c4210720f81804212544452c7c900c928c` is audit-only. New migrations need SQLite compatibility plus current-schema and fresh-parity tests; PostgreSQL reconsideration needs a new ADR.
- Implementation prompts start with `/plan` (not `/goal`); use short active sentences, one instruction per sentence; keep identifiers exact (`mise.toml`, `mise.lock`, `OPERATOROS_PYTHON_VENV`, `DATABASE_URL`, `origin/main`, `PROJECT_CONTEXT.md`, `operatoros_wsl_prepare_bun`, `./start-dev.sh`).

## Workflow

1. Read the relevant code and scoped instructions first.
2. Make the smallest safe change; no unrelated refactors or generated-artifact edits.
3. Update tests when behavior changes; use disposable synthetic data.
4. Run the most relevant verification (`check:affected`/`test:fast` iterative, `check:full` release-sensitive); verify UI in a real browser when available.
5. Report files changed, verification actually run, uncertainty, and preserved worktree entries. Never claim unrun checks passed. See [CONTRIBUTING.md](CONTRIBUTING.md) and [e2e/README.md](e2e/README.md).

## Boundaries — stop and ask

- Baseline `a203617b0a38c57213ceca514581d25bb36f7cf5`: final Phase 14 audit adds only a narrow signed docs/hygiene repair.
- Git: use focused `codex/` branches unless told otherwise; never amend, rebase, squash, force-push, or push to `main`; stage explicit paths only (never `git add .`/`-A`). Preserve user-owned `PROJECT_CONTEXT.md`, `f22`, `docs/student-data/dapodik-roster-import-design.md` when present, and `wip/followups-api-preservation-20260728-013523` at `07b7211b73a59f0032dc33c0c43741d884b38741` (never merge/copy/modify/delete).
- Worktrees: protect `~/code/repos/operatoros`, `~/code/worktrees/operatoros/`, `~/.local/share/operatoros/development/`; fetch `origin` and verify merged-main before pruning; prune only clean integrated worktrees (`wt step prune --dry-run --min-age=0s`, verify, then `--foreground`); never force-delete, `wt merge`, or clean before verification.
- Data/safety: never use, modify, or migrate the protected operational DB or rollback backups without explicit authorization for that exact operation; never commit backup paths, checksums, rows, names, secrets, or personal data. Operational migrations need wrapper preflight, lock, verified fresh backup, and process-local context. Never kill unknown port owners, `kill -9` unknown listeners, or remove unverified stale processes; E2E uses isolated temp data/ports and removes only its artifacts.
- Stop for unclear/conflicting requirements, missing credentials/data, unrelated failing tests, destructive/broad changes, public API or schema/migration changes, dependency upgrades, file deletes/renames, generated-file edits, security/auth/authz/payment-adjacent changes, or anything weakening database, authorization, audit, or Git safeguards.

## Decisions and known issues

- [Development index](docs/development/README.md) and [test strategy](docs/testing/TEST_STRATEGY.md) — current workflow tiers.
- [Frontend architecture](docs/architecture/FRONTEND_ARCHITECTURE.md), [database schema](docs/architecture/DATABASE_SCHEMA_ARCHITECTURE.md), [platform portability](docs/architecture/PLATFORM_PORTABILITY.md) — ownership and runtime limits.
- [Database operations](docs/operations/DATABASE_OPERATIONS.md) and [data reset](docs/operations/DATA_RESET.md) — protected-DB and reset gates.
- [Identity/authentication](docs/security/identity-authentication.md), [backup/restore security](docs/security/backup-restore.md) — active model.
- Historical milestone notes remain in Git history; do not treat them as current procedure.
