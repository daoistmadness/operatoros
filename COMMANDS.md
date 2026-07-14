# Commands

Verified from `README.md`, `backend/requirements.txt`, `frontend/package.json`, `docker-compose.yml`, `start-dev.sh`, `scripts/verify-browser.sh`, and `.github/workflows/ci.yml`.

## Install
- `cd backend && python3.12 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`
- `cd frontend && npm ci`
- `npm install -g agent-browser && agent-browser install`  # browser tooling
- `agent-browser install --with-deps`  # Linux / WSL2 browser dependencies

## Development
- `./start-dev.sh`  # direct FastAPI + Vite launcher
- `./start-dev.sh --check`  # validate prerequisites and ports without starting services
- `cd backend && uvicorn src.main:app --reload --host 0.0.0.0 --port 8000`
- `cd frontend && npm run dev`
- `cd frontend && VITE_API_BASE_URL=http://localhost:8000 npm run dev`

## Build
- `cd frontend && npm run build`
- `docker compose up --build`

## Test / Validation
- `cd backend && python3 -m pytest -q` (or with venv-backed execution: `DATABASE_URL=sqlite:///./attendance.db PYTHONPATH=backend backend/.venv/bin/pytest backend/tests/ -q`)
- `cd backend && python3 -c "from src.main import app; assert app is not None"`
- `cd frontend && npm test`  # Vitest frontend unit tests
- `./scripts/verify-browser.sh http://127.0.0.1:5173`
- `python3 .github/scripts/check_markdown_links.py`
- `docker compose config`
- `curl http://localhost:8000/docs`

## Formatting / Lint / Typecheck
- Not declared in the repository root, backend, or frontend scripts.
- TODO: add repo-specific lint/typecheck commands if they are introduced later.

## Database / Ops
- `docker compose logs -f backend`
- `docker compose logs -f frontend`
- `docker compose logs -f db`
- `docker compose down`
- `docker compose down -v`  # destructive: removes the PostgreSQL volume
