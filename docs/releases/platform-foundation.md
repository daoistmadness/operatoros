# v0.9.0-platform-foundation

Historical milestone: **Phase 9 platform foundation**. The current completed milestone is [Phase 10 — Incremental Design-System Modernization](phase-10-design-system-modernization.md). This document and its verification counts remain unchanged as the Phase 9 release baseline.

This milestone stabilizes OperatorOS's identity, executive reporting, backup operations, and deployment foundation. It is a beta platform baseline, not a general-availability 1.0 release.

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

## Historical release verification

- Backend: `292 passed`.
- Frontend: `19` test files and `98` tests passed.
- Vite production build: passed.
- SQLite fresh/upgrade/rollback migration tests: passed.
- PostgreSQL migration contract tests: passed; live database execution remains an environment gate.

These counts are the immutable `v0.9.0-platform-foundation` release baseline. Current convergence verification is 296 backend tests, 21 frontend files / 110 frontend tests, a passing Vite build, and 9 passing Windows desktop contracts with no xfail. See `../project-status/phases-8-to-10.md` for the current Phase 8–10 status.
