# Persistent development database

Development uses one persistent local S4.6 SQLite database per Git common
directory. Its default location is under `XDG_DATA_HOME` (or
`~/.local/share`) and it is never located in a runtime session directory.
The canonical filename is `operatoros.sqlite`.

`./start-dev.sh` creates an ephemeral owned process session for logs, ports,
PIDs, locks, and generated configuration. Normal shutdown removes that session
and retains the development database. First-admin setup remains an explicit
authorized operation; it is shown only until the persistent database has an
administrator.

Use `make dev-db-path`, `make dev-db-status`, and `make dev-sessions-status`,
and `make dev-db-reset CONFIRM=RESET` to manage the database. Reset is destructive
and refuses a verified active development session. `make dev-db-candidates` and
`make dev-db-adopt SESSION=<id>` support explicit adoption only; old session
databases are never selected or merged automatically.

If the canonical directory contains only the legacy
`operatoros-development.db`, `./start-dev.sh` validates it, migrates a copy
through the existing development schema chain, verifies the result, and keeps
the original as a `.migrated` recovery copy. A dual-file, invalid, busy, or
unsupported layout fails closed. `make dev-db-status` is read-only and reports
the layout without migrating it.

## If the setup/admin-creation screen reappears unexpectedly

1. Check inherited shell configuration without exposing other values:
   `env | grep -E '^(DATABASE_URL|OPERATOROS_DEV_DATA_DIR)='`
2. Check `backend/.env` for a stale active `DATABASE_URL` assignment; do not
   print its value unnecessarily.
3. Run `make dev-db-path` and `make dev-db-status`. Confirm the path is the
   expected persistent database, `administrator_configured` is `true`, and
   `users_count` is at least `1`.

Do not delete the persistent database as the first troubleshooting step. Old
session databases are not adopted automatically.

The protected `backend/attendance.db` is never a development or test runtime
database. The legacy migration applies only to the persistent development
directory. Packaged desktop user-data storage remains a separate future scope.
