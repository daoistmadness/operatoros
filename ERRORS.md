# Errors

This file records recurring failures, fragile areas, and debugging notes.

## Resolved
- The frontend build warning from `frontend/src/tailwind.css` involving `infinity * 1px` was caused by Tailwind emitting `.rounded-full` as `border-radius: calc(infinity * 1px)` in the checked-in stylesheet. It was fixed by replacing that generated value with a finite radius.
- The `POST /system/clear-data` route is now guarded by `ENABLE_DESTRUCTIVE_OPERATIONS` and an explicit confirmation token. Keep treating it as high risk, but do not assume it is freely callable anymore.
- Portless development depends on first-time certificate trust. If `./start-dev.sh` cannot reach an HTTPS Portless URL, the next check is `portless trust`, not a TLS bypass.
- If `portless get` returns no URL or a stale route, inspect `portless list` and prune manually with `portless prune`.
- If the browser smoke test fails to start, run `agent-browser doctor --offline --quick` and then install binaries with `agent-browser install` or `agent-browser install --with-deps` on Linux/WSL2.
- **Premature silent exit during startup**: The `start-dev.sh` script previously exited without warning if port assignment detection (`extract_assigned_port`) timed out. This was caused by an unhandled exit code from command substitution inside a global variable assignment under `set -e`. Fixed by adding `|| echo 'unknown'` and using explicit child failure loops.
- **Portless startup failure (proxy TCP refused & route 404)**: 
  - `portless doctor` does not exist in Portless v0.14.0 — use `portless service status` for diagnosis.
  - Proxy TCP probe was previously hardcoded to port 9999 and referenced `PORTLESS_PROXY_PORT` — actual proxy defaults to port 443 (HTTPS) and uses `PORTLESS_PORT` env var. Fixed by dynamically parsing proxy port and status from `portless service status` and falling back to 443.
  - Root vs. User state mismatch: when the Portless proxy runs as root (via sudo), it historically read routes from `/root/.portless/routes.json`. Fixed by migrating to a unified shared state directory (`PORTLESS_STATE_DIR`) so both CLI and proxy use the exact same directory natively.
  - Double-quoted child process environment variables caused PID and log message capture corruption in `start_background()`. Fixed by redirecting launcher log messages to `stderr`.
  - PYTHONPATH was previously set to `$PWD` which caused `ModuleNotFoundError: No module named 'api'` on hot-reload. Fixed by setting it to `$PWD/src`.
  - React dev proxy (`http-proxy-middleware`) historically failed with `SELF_SIGNED_CERT_IN_CHAIN` when proxying to HTTPS Portless backend. Fixed by relying on the native Portless CA injection (`NODE_EXTRA_CA_CERTS`), removing the insecure `secure: false` bypass.

## Known Fragile Areas
- Excel uploads require the expected columns on the first worksheet; missing columns fail the upload.
- Uploads only accept `.xlsx` files.
- `frontend/src/lib/api/client.js` checks browser local storage for bearer tokens, but the backend does not currently provide a matching auth flow.
- The frontend Docker image proxies `/api/*`, while Portless and browser-smoke development also use `/api` with a dev proxy. Keep those paths aligned when changing API calls.
- **Audit Table Write Abort**: The table `attendance_override_history` is strictly append-only. Any manual `UPDATE` or `DELETE` SQL operations on this table will abort with a database trigger exception (`trg_history_no_update`, `trg_history_no_delete`). To run resets or purges, triggers must be dropped and re-established programmatically (as in `backend/src/api/system.py`).

## Debugging Notes
- If uploads fail, inspect the sample template and compare its column names to the source workbook.
- If reports look incomplete, check class mapping and HEB configuration before changing analytics code.
- If the frontend cannot reach the backend, verify CORS origins and `REACT_APP_API_URL`.
- If WSL2 file watching is unreliable, move the repo off `/mnt/c` and onto the Linux filesystem.

## TODO
- Add repo-specific lint, test, or typecheck failure patterns if those workflows are introduced later.
