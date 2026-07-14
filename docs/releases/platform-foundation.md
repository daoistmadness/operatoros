# v0.9.0-platform-foundation

This milestone stabilizes Astryx's identity, executive reporting, backup operations, and deployment foundation. It is a beta platform baseline, not a general-availability 1.0 release.

## Added

- Authentication with database-backed, expiring sessions.
- One-time first administrator provisioning without default credentials.
- Monthly and annual executive reports with filtering and grouping.
- In-memory PDF and Excel report exports.
- Admin-only manual backup, restore, scheduling, retention, and history.
- Explicit SQLite and PostgreSQL identity/setup/scheduler migrations.

## Changed

- Development launcher configuration and diagnostics.
- Docker images, Compose configuration, CI contracts, and environment handling.
- Frontend runtime API configuration and server-state query architecture.
- Operational and security documentation.

## Security

- Argon2id password hashing and generic login failures.
- HMAC-digested opaque session tokens with idle/absolute expiration.
- Role-based backend authorization for admin-only operations.
- Authenticated report and export endpoints.
- Atomic, optionally token-protected first-run provisioning.
- Guarded restore with integrity validation and session revocation.

## Known limitations

- The application scheduler creates SQLite snapshots only; PostgreSQL backup remains an external operational workflow.
- Restore supports a single backend worker only.
- A live PostgreSQL 16 migration smoke test requires the release environment's PostgreSQL service.
- The frontend production bundle currently emits a non-blocking large-chunk warning.

## Verification

- Backend: `292 passed`.
- Frontend: `19` test files and `98` tests passed.
- Vite production build: passed.
- SQLite fresh/upgrade/rollback migration tests: passed.
- PostgreSQL migration contract tests: passed; live database execution remains an environment gate.
