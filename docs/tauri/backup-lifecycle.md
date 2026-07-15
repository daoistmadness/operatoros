# Backup and Restore Lifecycle

The existing SQLite service uses the SQLite backup API, checks free space/integrity/tables, writes SHA-256 metadata, applies retention, serializes operations, and audits outcomes. Restore requires admin authorization, enabled destructive operations, exact confirmation, one worker, compatible schema, a safety snapshot, atomic replacement/rollback, and reauthentication. These guarantees stay in FastAPI; Tauri only coordinates lifecycle and native selection.

- Managed backups default to `%LOCALAPPDATA%/Astryx/backups` with current-user-only ACLs.
- A user-selected folder is an export destination, not the managed repository. Rust obtains it through a native dialog and copies a verified database/metadata pair.
- React receives display names and operation IDs, not unrestricted paths.
- Shell backup scripts remain server/operator tooling and are not bundled.

The scheduler starts once through FastAPI lifespan; sleep/resume and clock changes need tests. Shutdown stops new jobs and waits a bounded time for an active backup, never killing during atomic snapshot/rename.

```text
Admin confirms restore
-> backend validates authorization, checksum, schema, integrity, and tables
-> desktop enters maintenance and drains mutations/scheduler work
-> backend snapshots and atomically restores or rolls back
-> restored sessions are revoked
-> Tauri restarts the sidecar and verifies database health
-> WebView reloads at Login with the audited result
```

Although current restore disposes SQLAlchemy connections in-process, desktop restarts the sidecar to guarantee clean engine/scheduler/module state. External backup import is deferred until a native quarantine-and-validation workflow exists.
