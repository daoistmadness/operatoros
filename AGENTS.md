# Agent execution contract

## Purpose and precedence

OperatorOS is an offline-first school attendance and academic analytics system.
Its active runtime contract is `SQLITE_ONLY_SUPPORTED`,
`LOCAL_BROWSER_RUNTIME`, `POSTGRESQL_NOT_SUPPORTED`, and
`CONTAINER_RUNTIME_NOT_REQUIRED`. The experimental Tauri desktop shell was
removed; the supported normal runtime is a local Elysia backend with the React
frontend in a browser. FastAPI remains available as the documented rollback
and reference backend.
This file is the authoritative execution contract for coding agents. A nested
`AGENTS.md` may add local refinements but cannot weaken this contract. Current
detail lives in [docs/README.md](docs/README.md); product-audit documents are
historical evidence unless they explicitly identify a current procedure.

## Environment and dependencies

- Work in Ubuntu WSL. Use `backend/.venv/bin/python` for Python commands.
- Use `mise` as runtime-version authority. `mise.toml` pins Bun 1.4.0 and Python 3.12.3. `frontend/bun.lock` remains the package-manager lockfile authority. Bun remains the package manager; mise only installs the runtime.
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
- Verified primary baseline: `main` at
  `1e891674d133f29a7c6b027fb42fce0dfd96dc50`, matching `origin/main`. PR #48
  runtime hardening is merged.
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
- Set `OPERATOROS_BACKEND=fastapi` for the documented FastAPI fallback.
- The launcher expects `backend/.venv` to exist. Ordinary startup does not
  create the virtual environment or install dependencies. GitHub CI may create
  its own virtual environment as defined by CI.
- `backend/.env` or the current shell can define `DATABASE_URL`. Managed
  development warns about that value and uses the canonical persistent
  development database instead. Do not select a development database from
  ambient `DATABASE_URL` or automatically adopt an old database.
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
- Verify UI work in a real browser when available. E2E uses isolated temporary
  data and ports; never kill unknown port owners. Remove temporary artifacts.
- Final reports state files changed, verification actually run, uncertainty,
  and any preserved worktree entries. Do not claim unrun checks passed.

## Frontend and API boundaries

- Use TypeScript and the existing feature ownership boundaries; do not perform
  a big-bang feature reorganization. Route modules are lazy-loaded where
  established. Reuse shared primitives and follow `frontend/DESIGN.md`.
- Use TanStack Query and the sanitized API-error foundation. Pages consume
  feature APIs, not generated OpenAPI code directly.
- Browser-visible APIs use canonical `/api/<domain>/...` paths through the
  shared API abstraction; do not hardcode backend domains or double-prefix.
- Generated OpenAPI contracts are version-controlled and drift-checked. Run
  the documented generation/check workflow for API changes.

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
