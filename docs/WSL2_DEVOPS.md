# WSL2 DevOps Guide

This guide covers the WSL2 development workflow for this repository. It keeps development instructions separate from production advice.

## Prerequisites
- WSL2 with a Linux distribution installed
- Docker Desktop with WSL integration enabled
- Python 3.12+
- Node.js 24+ for Portless mode
- npm
- Portless on the PATH
- Agent Browser on the PATH if you want browser verification

## Repository Location
- Keep the repo on the Linux filesystem, for example `~/projects/absensi/school-attendance-analytics`.
- Avoid working from `/mnt/c/...` if you want reliable file watching and faster I/O.
- Keep browser artifacts, logs, and other generated files out of the repo root except for ignored paths such as `.artifacts/`.

## Portless Setup
Portless is the preferred local workflow because it avoids port conflicts and gives each worktree stable URLs.

```bash
portless trust
```

- Run `portless trust` once so the local TLS certificate is trusted.
- Use `portless list` to inspect active routes and `portless get <name>` to retrieve a URL.
- In linked worktrees, Portless prefixes the route automatically.
- Use `portless prune` manually if you need to remove stale local routes.
- Do not use `portless clean` as part of normal project startup or cleanup.

## Start the Local Dev Stack
```bash
cd ~/projects/absensi/school-attendance-analytics
./start-dev.sh
```

`start-dev.sh`:
- A successful startup prints a green `✅ SCHOOL ATTENDANCE ANALYTICS IS READY` banner and remains active. If it exits to the prompt before printing this banner, startup has failed.
- You can add `--open` to automatically open the frontend URL (safely invokes `powershell.exe Start-Process` on WSL2).
- You can add `--status` to view health status of routes and services without starting anything.
- prepares `backend/.venv` when needed
- installs frontend dependencies if `node_modules/` is missing
- runs Tailwind watch mode against `frontend/src/index.css`
- starts the backend and frontend through Portless by default
- prints stable URLs such as `https://school-attendance.localhost`
- can run `./scripts/verify-browser.sh` when invoked with `--verify-browser`
- never kills a process just because it owns a desired port

For the direct-port fallback:
```bash
./start-dev.sh --no-portless
```

This mode respects `DEV_BACKEND_PORT` and `DEV_FRONTEND_PORT` and fails if either port is already in use.

## Browser Verification
```bash
./start-dev.sh --verify-browser
```

or:

```bash
./scripts/verify-browser.sh https://school-attendance.localhost
```

- Browser smoke testing is local-only in this repository.
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

- Local launcher logs are written under `.artifacts/dev-logs/`.
- Backend health is available at `GET /system/health`.
- Frontend Docker builds must use `/api` in the browser-facing bundle.

## Resetting State
> Warning: the following commands can destroy data.

```bash
docker compose down
docker compose down -v
```

- `down` stops containers but keeps the volume.
- `down -v` also removes the PostgreSQL volume and erases database contents.
- The app also exposes a destructive reset action at `POST /system/clear-data`, but it stays disabled unless `ENABLE_DESTRUCTIVE_OPERATIONS=true` and the confirmation token is supplied.

## Networking Notes
- In direct local development, the React client uses `http://localhost:8000`.
- In Portless and Docker workflows, the browser uses same-origin `/api` requests and the proxy layer forwards them to the backend.
- The frontend Docker image includes an Nginx config that strips `/api/` before forwarding to the backend container.
- On Windows host browsers, `localhost` forwarding usually works through WSL2, but Portless `.localhost` URLs are the preferred workflow.

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
- Keep the `/api` proxy as a development and container routing convention; do not embed the backend service hostname in browser code.

## Troubleshooting
- If Portless URLs do not resolve, run `portless trust`, then check `portless list`.
- If the browser cannot validate TLS, confirm the local Portless certificate trust is installed before reaching for insecure workarounds. The development launcher automatically injects the certificate via `NODE_EXTRA_CA_CERTS`.
- If file watching is unreliable, confirm the repo is not mounted from the Windows filesystem.
- If Docker port bindings conflict, stop the offending process before relaunching the stack.
- If a stale Portless route appears, prune it manually rather than deleting other worktree routes.

### Portless API Path Note

In local Portless/proxy mode, browser-visible requests may include a double API prefix such as `/api/api/grades/...` or `/api/api/analytics/...`.

This can be valid when the frontend API client/proxy normalizes the request to backend `/api/<domain>/...`.

The backend canonical contract remains `/api/<domain>/...`.

A `404` on `/api/api/<domain>/...` usually means one of:

- the backend router is not mounted under `/api/<domain>`
- the frontend wrapper is not following the shared API path convention
- the dev server is serving a stale frontend bundle
