# WSL2 DevOps Guide

This guide covers the WSL2 development workflow for this repository.

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
./start-dev.sh
```

`start-dev.sh` starts both the FastAPI backend and the Vite frontend concurrently:

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
docker compose config
docker compose up --build
```

Ports and services:
- Frontend: `http://localhost`
- Backend: `http://localhost:8000`
- Database service: `db` on PostgreSQL 16
- Containerized browser requests use `/api/*`; Nginx forwards them to `http://backend:8000/*`

Compose uses a named volume, `db_data`, for database persistence.

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
- The frontend Docker image includes an Nginx config that proxies `/api/` to the backend.

## File Permission and Line Ending Issues
- Use LF line endings for shell scripts and config files.
- Keep executable bits on `start-dev.sh` and `scripts/verify-browser.sh`.
- If a shell script fails with `^M` or permission errors, re-check the file mode and line endings before editing the script logic.

## Backup and Restore
- Back up the named Docker volume before running resets if the data matters.
- For SQLite development, back up `attendance.db` before running repair scripts or schema experiments.
- Treat imported spreadsheets, generated Excel exports, and browser artifacts as operational data.

## Production Guidance
- Replace the development PostgreSQL password before any real deployment and supply non-default credentials externally.
- Do not use the destructive reset endpoint in production.
- Prefer a managed PostgreSQL instance over local SQLite for multi-user or long-lived deployments.
- Confirm CORS origins and frontend API URLs before exposing the app externally.
- Set `VITE_API_BASE_URL` to the public backend URL if the frontend is served separately from the backend.

## Troubleshooting
- If the Vite dev server fails to start, confirm `frontend/node_modules/` exists. Run `cd frontend && npm install` if needed.
- If file watching is unreliable, confirm the repo is not mounted from the Windows filesystem.
- If Docker port bindings conflict, stop the offending process before relaunching the stack.
- If a frontend request returns a 404, verify the backend route is registered under `/api/<domain>/...` in `backend/src/main.py`.
- If `VITE_API_BASE_URL` is set, confirm it points to the running backend and does not end with a trailing slash.
