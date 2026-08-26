# Commands

Verified from `README.md`, `backend/requirements.txt`, `frontend/package.json`, `start-dev.sh`, `scripts/verify-browser.sh`, and `.github/workflows/ci.yml`.

## Install
- `mise install`  # install Bun 1.4.0 and Python 3.12.3 from mise.lock
- `mise run doctor`  # verify toolchain
- `cd backend && python -m venv .venv && .venv/bin/python -m pip install -r requirements.txt`
- `cd frontend && bun install`
- `npm install -g agent-browser && agent-browser install`  # browser tooling
- `agent-browser install --with-deps`  # Linux / WSL2 browser dependencies

## Development
- `./start-dev.sh`  # direct FastAPI + Vite launcher
- `./start-dev.sh --check`  # validate prerequisites and ports without starting services
- `cd backend && uvicorn src.main:app --reload --host 0.0.0.0 --port 8000`
- `cd frontend && bun run dev`
- `cd frontend && VITE_API_BASE_URL=http://localhost:8000 bun run dev`

## Build
- `cd frontend && bun run build`

## Test / Validation
- `cd backend && python3 -m pytest -q` (or with venv-backed execution: `DATABASE_URL=sqlite:///./attendance.db PYTHONPATH=backend backend/.venv/bin/pytest backend/tests/ -q`)
- `cd backend && python3 -c "from src.main import app; assert app is not None"`
- `cd frontend && bun test`  # frontend unit tests
- `./scripts/verify-browser.sh http://127.0.0.1:5173`
- `python3 .github/scripts/check_markdown_links.py`
- `curl http://localhost:8000/docs`
- `PYTHONPATH=backend:backend/src python -m core.performance_benchmark all --scale SCHOOL_CURRENT --runs 7 --json`  # deterministic optional-engine pilot; never point output at a database

## Formatting / Lint / Typecheck
- Not declared in the repository root, backend, or frontend scripts.
- TODO: add repo-specific lint/typecheck/formatting commands if they are introduced later.

## Database Migration / Generation
- No manual migration tool (like Alembic) is configured.
- Database tables are automatically generated on startup via SQLAlchemy (`Base.metadata.create_all` in `backend/src/core/database.py`).
- Schema updates/patches are programmatically run on startup via database patches (e.g. `run_grade_ledger_patches` in `backend/src/core/database.py`).
- Raw SQL files in `backend/migrations/` represent the repository's migration history.

## Database / Ops
- `./scripts/backup.sh`  # SQLite backup
- `./scripts/restore.sh <backup-file>`  # guarded SQLite restore
