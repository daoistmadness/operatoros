# WSL2 DevOps Guide

This guide covers the WSL2 development workflow for this repository.

Direct Bun/Elysia and Bun/Vite processes are the supported local-development workflow. Docker Compose is a supported secondary workflow for historical operational verification only.

## Prerequisites
- WSL2 with a Linux distribution installed
- Docker Desktop with WSL integration enabled
- Python 3.12+
- Node.js 24.13.0
- npm 11.x
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

`--check` validates commands, the managed database/session environment, local Vite installation, and both ports without starting services. Normal startup starts Elysia with Vite in separate process groups. The launcher waits for both URLs before displaying the ready banner. Full service logs are stored in `.runtime/operatoros-dev/`.

With a fresh local database, the frontend displays the one-time administrator setup before it mounts normal authentication. Create the account, then sign in normally.

| Service | URL |
| :--- | :--- |
| Frontend | `http://127.0.0.1:5173` |
| Backend | `http://127.0.0.1:8000` |
| API docs | `http://127.0.0.1:8000/openapi` |
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

## Runtime model

OperatorOS uses direct Elysia/Vite processes during WSL2 development. SQLite is the only supported
database. Docker, Compose, Nginx, and PostgreSQL are not required runtime
dependencies.

Backend health is available at `GET /health` and `GET /api/system/health`.
The destructive reset action remains disabled unless
`ENABLE_DESTRUCTIVE_OPERATIONS=true` and the confirmation token is supplied.

## Networking Notes
- In direct local development, the Vite proxy forwards `/api/*` to Elysia at `http://127.0.0.1:8000`. No separate CORS configuration is needed.

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

### WSL Node/npm drift

Check the active WSL toolchain with the repository validator. It resolves the
executable paths first and only runs version checks after those paths pass the
WSL safety checks:

```bash
bash scripts/validate-wsl-node-npm.sh --probe "$PWD"
```

Expected executable paths are under `~/.nvm/versions/node/<version>/bin/`.
Recover the pinned version in the current shell with:

```bash
. ~/.nvm/nvm.sh
nvm use 24.13.0
hash -r
```

Do not use `node.exe` or `npm.cmd` from `/mnt/c` for OperatorOS development.

- If `vite: not found` appears, do not install Vite globally. The locked installation is missing or incomplete; run `bun install --frozen-lockfile` from the repository root.
- If Bun reports a registry/network failure, restore connectivity and rerun the same Bun command. The launcher intentionally does not install dependencies automatically.
- If a port is occupied, `./start-dev.sh --check` reports the affected service and process information when `lsof` or `ss` can provide it. Stop that process or select a different `BACKEND_PORT`/`FRONTEND_PORT`.
- If the Python tooling environment is missing or stale, run `mise run python:bootstrap`. It uses the external default or the path in `OPERATOROS_PYTHON_VENV`; it does not require `backend/.venv`.
- If backend or frontend readiness times out, inspect `.dev-logs/backend.log` or `.dev-logs/frontend.log`; the launcher also prints the latest lines before shutting down both services.
- If file watching is unreliable, confirm the repo is not mounted from the Windows filesystem.
- If Docker port bindings conflict, stop the offending process before relaunching the stack.
- If a frontend request returns a 404, verify the backend route is registered under `/api/<domain>/...` in the active backend source.
- If `VITE_API_BASE_URL` is set, confirm it points to the running backend and does not end with a trailing slash.
