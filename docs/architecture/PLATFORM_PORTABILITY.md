# Platform portability

## Decision

`SQLITE_ONLY_SUPPORTED`. OperatorOS is a local/desktop SQLite application.
PostgreSQL is not a supported runtime, and the application explicitly rejects
PostgreSQL URLs and legacy PostgreSQL configuration without echoing credentials.
The Tauri desktop target runs a local FastAPI sidecar; a container runtime is
not required.

The current deployment labels are:

- `SQLITE_ONLY_SUPPORTED`
- `TAURI_DESKTOP_LOCAL`
- `POSTGRESQL_NOT_SUPPORTED`
- `CONTAINER_RUNTIME_NOT_REQUIRED`

## Database contract

SQLite must preserve the established business outcomes: fresh bootstrap records
S4.2 then S4.3; migration-ledger ordering is idempotent; constraints and
append-only audit behavior hold; duplicate attendance/upload handling rolls
back atomically; and analytics remain deterministic.

SQLite-specific WAL/PRAGMA configuration and `BEGIN IMMEDIATE` serialization
are intentional. SQLAlchemy and dialect-neutral repository logic remain because
they provide useful transaction and query abstractions, not because a second
dialect is promised.

Existing databases are never migrated by ordinary startup. Current applications
pair with S4.3; the protected operational database is never a test target.

Historical PostgreSQL migrations and the PR #35 evaluation documents remain
audit evidence only. They are not current deployment or compatibility guidance.
