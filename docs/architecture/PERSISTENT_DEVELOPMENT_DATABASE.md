# Persistent development database

Development uses one persistent local S4.3 SQLite database per Git common
directory. Its default location is under `XDG_DATA_HOME` (or
`~/.local/share`) and it is never located in a runtime session directory.

`./start-dev.sh` creates an ephemeral owned process session for logs, ports,
PIDs, locks, and generated configuration. Normal shutdown removes that session
and retains the development database. First-admin setup remains an explicit
authorized operation; it is shown only until the persistent database has an
administrator.

Use `make dev-db-path`, `make dev-db-status`, and
`make dev-sessions-status`,
`make dev-db-reset CONFIRM=RESET` to manage the database. Reset is destructive
and refuses a verified active development session. `make dev-db-candidates` and
`make dev-db-adopt SESSION=<id>` support explicit adoption only; old session
databases are never selected or merged automatically.

The protected `backend/attendance.db` is never a development or test runtime
database. Packaged desktop user-data storage remains a separate future scope.

## If the setup/admin-creation screen reappears unexpectedly

1. Run `env | grep DATABASE_URL` and check for a stale shell override.
2. Check `backend/.env` for a stale `DATABASE_URL`.
3. Run `make dev-db-path` and `make dev-db-status`; confirm the path is the expected persistent path and `administrator_configured` is `true`.
