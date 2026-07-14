# WSL2 DevOps Guide

This guide covers the WSL2 development workflow for this repository.

Direct Node.js/Vite and Python/FastAPI processes are the primary local-development workflow. Docker Compose is a supported secondary workflow for containerized deployment, PostgreSQL provisioning, Nginx routing, and operational verification.

## Prerequisites
- WSL2 with a Linux distribution installed
- Docker Desktop with WSL integration enabled
- Python 3.12+
- Node.js 20+
- npm
- Agent Browser on the PATH if you want browser smoke testing

## Repository Location
- Keep the repo on the Linux filesystem, for example `~/projects/absensi/school-attendance-analytics`.
- Avoid working from `/mnt/c/...` if you want reliable file watching and faster I/O.
- Keep browser artifacts, logs, and other generated files out of the repo root except for ignored paths such as `.artifacts/`.

## Start the Local Dev Stack
```bash
cd ~/projects/absensi/school-attendance-analytics
./start-dev.sh --check
./start-dev.sh
```

`--check` validates commands, the Python environment, local Vite installation, and both ports without starting services. Normal startup checks the same prerequisites, starts FastAPI and Vite in separate process groups, waits for both URLs, and only then displays the ready banner. Full service logs are stored in `.dev-logs/`.

With a fresh local database, the frontend displays the one-time administrator setup before it mounts normal authentication. Create the account, then sign in normally. Headless local operators can instead run `cd backend && PYTHONPATH=src .venv/bin/python -m cli create-admin`; the CLI requires a terminal and hidden password confirmation.

| Service | URL |
| :--- | :--- |
| Frontend | `http://127.0.0.1:5173` |
| Backend | `http://127.0.0.1:8000` |
| API docs | `http://127.0.0.1:8000/docs` |
| Health | `http://127.0.0.1:8000/health` |

Press `Ctrl+C` to stop both processes.

Optional port overrides:
```bash
BACKEND_PORT=9000 FRONTEND_PORT=5174 ./start-dev.sh
FRONTEND_HOST=0.0.0.0 ./start-dev.sh   # expose frontend to LAN
```

You can also start services individually:
```bash
./scripts/start-backend.sh
./scripts/start-frontend.sh
```

## How the API Proxy Works

In development, the Vite dev server at `http://127.0.0.1:5173` proxies all `/api/*` requests to `http://127.0.0.1:8000`. This means:

- The browser always calls `http://127.0.0.1:5173/api/...`
- The Vite proxy forwards them to `http://127.0.0.1:8000/api/...`
- No CORS, no TLS, no Portless needed

All backend canonical routes begin with `/api/<domain>/...`. Do not use bare paths like `/analytics/...` in new frontend code.

## Browser Verification
```bash
./scripts/verify-browser.sh
# or with explicit URL:
./scripts/verify-browser.sh http://127.0.0.1:5173
```

- Install Agent Browser with `npm install -g agent-browser`.
- Install browser binaries with `agent-browser install`, or `agent-browser install --with-deps` on Linux/WSL2.
- Browser artifacts are written under `.artifacts/browser/`.

## Docker Compose
```bash
cp .env.example .env
# Set a non-example POSTGRES_PASSWORD and generate AUTH_COOKIE_SECRET
# plus a separate ASTRYX_SETUP_TOKEN
# with: python -c "import secrets; print(secrets.token_urlsafe(48))"
docker compose config
docker compose up --build
```

All three values are required by Compose. Keep `.env` outside version control, reuse the same authentication secret across restarts, and remove `ASTRYX_SETUP_TOKEN` from deployed secrets after first-admin provisioning succeeds.

Ports and services:
- Frontend: `http://localhost`
- Backend: `http://localhost:8000`
- Database service: `db` on PostgreSQL 16
- Containerized browser requests use `/api/*`; Nginx forwards them to `http://backend:8000/*`

Compose uses a named volume, `db_data`, for database persistence.
The `backend_data` volume persists application-created backup and audit artifacts under `/app/data/backups`.

On a brand-new `db_data` volume, PostgreSQL runs the read-only identity, backup-scheduler, and first-admin setup initialization migrations before becoming healthy. Existing volumes are not automatically altered; back them up and follow `backend/migrations/README.md` when a new migration must be applied.

## Logs, Rebuilds, and Health Checks
```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f db
docker compose build backend
docker compose build frontend
```

- Backend health is available at `GET /health` and `GET /api/system/health`.
- Frontend Docker builds use empty `VITE_API_BASE_URL`; the Nginx proxy handles `/api/` forwarding.
- Compose waits for PostgreSQL readiness, then backend health, before declaring the Nginx frontend ready.

## Resetting State
> Warning: the following commands can destroy data.

```bash
docker compose down
docker compose down -v
```

- `down` stops containers but keeps the volume.
- `down -v` also removes the PostgreSQL volume and erases database contents.
- The app also exposes a destructive reset action at `POST /api/system/clear-data`, but it stays disabled unless `ENABLE_DESTRUCTIVE_OPERATIONS=true` and the confirmation token is supplied.

## Networking Notes
- In direct local development, the Vite proxy forwards `/api/*` to `http://127.0.0.1:8000`. No separate CORS configuration is needed.
- In Docker, the browser uses same-origin `/api` requests and Nginx forwards them to the backend container.
- The frontend Docker image includes an Nginx config that preserves canonical `/api/` paths while proxying them to the backend.

## File Permission and Line Ending Issues
- Use LF line endings for shell scripts and config files.
- Keep executable bits on `start-dev.sh` and `scripts/verify-browser.sh`.
- If a shell script fails with `^M` or permission errors, re-check the file mode and line endings before editing the script logic.

## Backup and Restore
- Back up the named Docker volume before running resets if the data matters.
- `scripts/backup.sh` and `scripts/restore.sh` provide a separate PostgreSQL operational path through the `attendance_db` container. Phase 9 scheduled application snapshots remain limited to file-backed SQLite.
- For SQLite development, back up `attendance.db` before running repair scripts or schema experiments.
- Treat imported spreadsheets, generated Excel exports, and browser artifacts as operational data.

## Production Guidance
- Replace the development PostgreSQL password before any real deployment and supply non-default credentials externally.
- Do not use the destructive reset endpoint in production.
- Prefer a managed PostgreSQL instance over local SQLite for multi-user or long-lived deployments.
- Confirm CORS origins and frontend API URLs before exposing the app externally.
- Set `VITE_API_BASE_URL` to the public backend URL if the frontend is served separately from the backend.

## Troubleshooting
- If `vite: not found` appears, do not install Vite globally. The locked installation is missing or incomplete; run `cd frontend && rm -rf node_modules && npm ci`.
- If `npm ci` reports a registry/network failure, restore connectivity and rerun the same npm command. The launcher intentionally does not install dependencies automatically.
- If a port is occupied, `./start-dev.sh --check` reports the affected service and process information when `lsof` or `ss` can provide it. Stop that process or select a different `BACKEND_PORT`/`FRONTEND_PORT`.
- If the Python environment is missing, create `backend/.venv` with Python 3.12 and install `backend/requirements.txt` as shown in the README.
- If backend or frontend readiness times out, inspect `.dev-logs/backend.log` or `.dev-logs/frontend.log`; the launcher also prints the latest lines before shutting down both services.
- If file watching is unreliable, confirm the repo is not mounted from the Windows filesystem.
- If Docker port bindings conflict, stop the offending process before relaunching the stack.
- If a frontend request returns a 404, verify the backend route is registered under `/api/<domain>/...` in `backend/src/main.py`.
- If `VITE_API_BASE_URL` is set, confirm it points to the running backend and does not end with a trailing slash.
