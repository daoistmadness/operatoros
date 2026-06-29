# Memory

This file records durable project decisions and stable context for future agent runs.

## Stable Decisions
- The repository is a full-stack school attendance analytics system, not a generic dashboard starter.
- The backend is FastAPI + SQLAlchemy, and the frontend is React with CRA-style scripts.
- `backend/src/main.py` is the authoritative router registration point.
- `backend/src/core/database.py` creates tables on startup and applies compatibility fixes for older local databases.
- Raw SQL files in `backend/migrations/` are the repo’s visible migration history.
- The frontend client uses `http://localhost:8000` for local development and `/api` in the Docker bundle.
- `frontend/nginx.conf` strips `/api/` and forwards requests to the backend service.
- Portless is the preferred local launcher, with default logical route names `school-attendance` and `api.school-attendance`.
- Portless mode uses same-origin `/api` browser requests and worktree-prefixed `.localhost` URLs.
- Portless proxy defaults to port 443 (HTTPS) and relies on a unified shared state directory (`PORTLESS_STATE_DIR`) instead of privilege-boundary file links.
- React dev server proxy (`setupProxy.js`) verifies Portless development TLS natively using `NODE_EXTRA_CA_CERTS`.
- `scripts/verify-browser.sh` is the repo-owned Agent Browser smoke test and writes artifacts under `.artifacts/browser/`.
- The backend currently has no explicit auth/authorization system in server code.
- `POST /system/clear-data` is guarded by `ENABLE_DESTRUCTIVE_OPERATIONS=false` by default and requires the `CLEAR_ALL_ATTENDANCE_DATA` confirmation token.
- The backend can construct a PostgreSQL SQLAlchemy URL from `POSTGRES_*` fields; Compose supplies `db` as the service host.
- Backend behavioral tests now live under `backend/tests/` and are run with `pytest`.
- On developer machines where Windows Dapodik Apache owns port 443, the WSL Portless proxy uses a documented non-conflicting public port. The project never stops or reconfigures Dapodik automatically.

## Operational Notes
- Keep SQLite database files and generated Excel outputs out of version control unless a task explicitly requires them.
- Keep `frontend/node_modules/`, `frontend/build/`, and other generated assets unedited.
- `start-dev.sh` is the preferred local launcher for WSL2 development and defaults to Portless.
- `start-dev.sh --no-portless` is the safe direct-port fallback; it fails on occupied ports instead of killing them.
- `portless trust` is a required first-time setup step for the default local launcher.
- `docker compose down -v` is destructive because it removes the PostgreSQL volume.

## Links
- See [AGENTS.md](AGENTS.md) for current operating rules.
- See [COMMANDS.md](COMMANDS.md) for verified commands.
- See [ERRORS.md](ERRORS.md) for fragile areas and recurring issues.
- See [CONVENTIONS.md](CONVENTIONS.md) for observed code conventions.
