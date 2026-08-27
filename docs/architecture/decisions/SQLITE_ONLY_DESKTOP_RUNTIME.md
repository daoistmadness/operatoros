# SQLite-only desktop runtime

- Status: Accepted
- Decision date: 2026-07-29
- Accepted baseline: `03df8317c94431420692c75efd15b585c6b29d7d`
- Update 2026-08-20: the experimental Tauri desktop shell was removed. The
  supported runtime is `LOCAL_BROWSER_RUNTIME`: a local Elysia backend with
  the React frontend in a browser and a SQLite database. The former Python
  backend is retired. The SQLite-only
  decision is unchanged.

## Context

OperatorOS is an offline-first school application targeting a local
deployment. The prior PostgreSQL-aware Compose stack represented a
hosted-server deployment that the product does not require. Its driver,
configuration, branches, tests, and container topology increased maintenance
and safety scope without an active deployment owner.

## Decision

OperatorOS is standardized on SQLite as its sole supported database for local
deployment. Drizzle is the application persistence layer.
PostgreSQL and containerized hosted-server deployment are removed from active
support. PostgreSQL URLs fail explicitly with a sanitized SQLite-only error.

Supported deployment is `LOCAL_BROWSER_RUNTIME` with a local Elysia backend,
the React frontend in a browser, and a SQLite database. PostgreSQL, Docker
Compose, and hosted multi-service runtime topologies are unsupported.

## Reasons and consequences

The decision aligns runtime operations with the actual offline desktop product,
removes credentials and network-database operations, and keeps backup,
transaction, audit, and migration safeguards focused. It reduces portability
to SQLite semantics and deliberately gives up hosted horizontal scaling.

No container runtime is required by application startup or ordinary test tiers.
Historical PostgreSQL migrations and PR #35 audit documents remain evidence,
not current operating guidance.

## Operational safeguards

S4.2 remains the fresh-bootstrap baseline and S4.3 remains the current runtime
head. Existing outdated databases are rejected and never silently migrated.
Foreign keys, bounded SQLite locking, atomic transactions, append-only audit
triggers, protected-path guards, and run-relative protected-database snapshots
remain mandatory.

Backup and restore operate on SQLite files with verified, guarded workflows.
Rollback backups are restore inputs and cannot become writable runtime data.
The repository operational database is excluded from development, tests, and
packaging.

## Local data path contract

Any packaged or long-lived local runtime must use an absolute database path in
the operating-system application-data directory: Application Data on Windows,
XDG application data on Linux, and Application Support on macOS. It must not
depend on the working directory or resolve to `backend/attendance.db`.
Development and tests use explicit disposable paths.

## PostgreSQL reconsideration

Reconsideration requires an explicit hosted/server product requirement, a new
architecture decision, separate authorization, migration and rollback design,
production operations ownership, contract tests, backup/restore procedures,
and security and credential-management plans.
