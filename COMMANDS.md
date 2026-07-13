# Commands

Verified from `README.md`, `backend/requirements.txt`, `frontend/package.json`, `docker-compose.yml`, `start-dev.sh`, `scripts/verify-browser.sh`, and `.github/workflows/ci.yml`.

## Install
- `cd backend && python3.12 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`
- `cd frontend && npm ci`
- `portless trust`  # one-time local TLS trust setup for Portless
- `npm install -g agent-browser && agent-browser install`  # browser tooling
- `agent-browser install --with-deps`  # Linux / WSL2 browser dependencies

## Development
- `./start-dev.sh`  # Portless-first launcher
- `./start-dev.sh --verify-browser`
- `./start-dev.sh --no-portless`
- `./start-dev.sh --doctor`  # environment preflight without starting services
- `./start-dev.sh --refresh-deps`  # force reinstall of backend and frontend dependencies
- `cd backend && uvicorn src.main:app --reload --host 0.0.0.0 --port 8000`
- `cd frontend && npm start`
- `cd frontend && REACT_APP_API_URL=http://localhost:8000 npm start`

## Build
- `cd frontend && npm run build`
- `docker compose up --build`

## Test / Validation
- `cd backend && python3 -m pytest -q` (or with venv-backed execution: `DATABASE_URL=sqlite:///./attendance.db PYTHONPATH=backend backend/.venv/bin/pytest backend/tests/ -q`)
- `cd backend && python3 -c "from src.main import app; assert app is not None"`
- `cd frontend && npm test`  # CRA test runner for frontend unit tests
- `./scripts/verify-browser.sh https://school-attendance.localhost`
- `python3 .github/scripts/check_markdown_links.py`
- `docker compose config`
- `curl http://localhost:8000/docs`
- `portless list`
- `portless get school-attendance`

## Formatting / Lint / Typecheck
- Not declared in the repository root, backend, or frontend scripts.
- TODO: add repo-specific lint/typecheck commands if they are introduced later.

## Database / Ops
- `docker compose logs -f backend`
- `docker compose logs -f frontend`
- `docker compose logs -f db`
- `docker compose down`
- `docker compose down -v`  # destructive: removes the PostgreSQL volume

