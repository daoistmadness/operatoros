# Commands

Verified from `README.md`, `backend/requirements.txt`, `apps/api/package.json`, `apps/web/package.json`, `start-dev.sh`, `scripts/verify-browser.sh`, and `.github/workflows/ci.yml`.

## Install
- `mise install`  # install Bun 1.4.0 and Python 3.12.3 from mise.lock
- `mise run doctor`  # verify toolchain
- `cd backend && python -m venv .venv && .venv/bin/python -m pip install -r requirements.txt`
- `cd apps/web && bun install`
- `npm install -g agent-browser && agent-browser install`  # browser tooling
- `agent-browser install --with-deps`  # Linux / WSL2 browser dependencies

## Development
- `./start-dev.sh`  # default Elysia + Vite launcher
- `./start-dev.sh --check`  # validate prerequisites and ports without starting services
- `cd apps/api && bun run src/server.ts`  # standalone Elysia backend
- `cd apps/web && bun run dev`
- `cd apps/web && DEV_API_PROXY_TARGET=http://localhost:8000 bun run dev`

## Build
- `cd apps/web && bun run build`

## Test / Validation
- `cd apps/api && bun test`
- `cd apps/web && bun test`  # frontend unit tests
- `./scripts/verify-browser.sh http://127.0.0.1:5173`
- `python3 .github/scripts/check_markdown_links.py`
- `curl http://localhost:8000/openapi`
- `PYTHONPATH=backend:backend/src backend/.venv/bin/python -m core.performance_benchmark all --scale SCHOOL_CURRENT --runs 7 --json`  # retained tooling; never point output at a database

## Formatting / Lint / Typecheck
- Not declared in the repository root, backend, or frontend scripts.
- TODO: add repo-specific lint/typecheck/formatting commands if they are introduced later.

## Database Migration / Generation
- No manual migration tool (like Alembic) is configured.
- The Elysia runtime validates the accepted Drizzle schema and migration manifest at startup.
- Schema updates/patches are programmatically run on startup via database patches (e.g. `run_grade_ledger_patches` in `backend/src/core/database.py`).
- Raw SQL files in `backend/migrations/` represent the repository's migration history.

## Database / Ops
- `./scripts/backup.sh`  # SQLite backup
- `./scripts/restore.sh <backup-file>`  # guarded SQLite restore
