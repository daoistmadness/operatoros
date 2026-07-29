# Agent execution contract

## Purpose and precedence

OperatorOS is an offline-first school attendance and academic analytics system.
This file is the authoritative execution contract for coding agents. A nested
`AGENTS.md` may add local refinements but cannot weaken this contract. Current
detail lives in [docs/README.md](docs/README.md); product-audit documents are
historical evidence unless they explicitly identify a current procedure.

## Environment and dependencies

- Work in Ubuntu WSL. Use `backend/.venv/bin/python` for Python commands.
- `npm` and `frontend/package-lock.json` are authoritative for frontend
  installation. Bun may test/build but must not install dependencies.
- Read relevant code and documentation before editing. Prefer the smallest safe
  change; do not refactor unrelated code or generated artifacts.

## Git and worktree safety

- Use focused `codex/` branches unless the task specifies another name. Do not
  amend, rebase, squash, force-push, or push directly to `main`.
- Stage explicit paths only; never use `git add .` or `git add -A`.
- Preserve user-owned `PROJECT_CONTEXT.md`, `f22`, and, when present,
  `docs/student-data/dapodik-roster-import-design.md`.
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

## Schema and rollback

- `20260724_s42` is the fresh-bootstrap baseline; `20260725_s43` is the
  current runtime and operational head. Existing S4.2 databases require an
  explicit controlled migration.
- Current normal application pairs with S4.3. Rollback pairs a restored S4.2
  database with `c06a6220c2c0c2059521c1a396d1b914635aacff` from
  `maintenance/s42-rollback`. The historical
  `b47632c4210720f81804212544452c7c900c928c` is audit-only and must not run.
- New migrations require SQLite/PostgreSQL compatibility, current-schema and
  fresh-parity tests, and must not bypass schema guards or audit triggers.

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
