# Database Lifecycle

Desktop v1 uses one file-backed SQLite database owned by one FastAPI sidecar. PostgreSQL remains a browser/Docker server option and is not bundled.

Writable files must never live in Program Files, beside the executable, or relative to the working directory. Tauri passes an absolute URL under a machine-local path such as `%LOCALAPPDATA%/Astryx/data/astryx.sqlite3`; roaming/network synchronization is unsafe for SQLite/WAL.

```text
%LOCALAPPDATA%/Astryx/
  data/astryx.sqlite3[|-wal|-shm]
  backups/
  logs/
  runtime/
  exports/
```

## Startup

1. Acquire application/database locks and protected current-user directories.
2. Reject installation-directory, network-share, and path-escape targets; verify space/ownership.
3. Integrity/schema-check existing data or initialize a new database.
4. Create a verified pre-migration backup and apply versioned transactional migrations.
5. Open SQLAlchemy with existing foreign-key/WAL pragmas and start one scheduler.
6. Report ready only after database and migration checks pass.

Current `init_db()` creates tables, seeds defaults, and applies compatibility patches at module startup. Phase 11 must inventory and version this before packaging; migration failure must leave the prior database recoverable.

On corruption, do not mutate the live file. Offer retry, logs, validated backup restore, or exit, while preserving the corrupt file. Restore retains checksum, schema, required-table, integrity, snapshot, rollback, and session-revocation guarantees.

Updates preserve the data root; uninstall preserves it by default. Deletion remains an explicit guarded operation. Enforce one worker/scheduler and use Tauri single-instance plus a sidecar/database lock; two versions must never share the file during update/rollback.

## Phase 9.6 Windows spike evidence

On 2026-07-14 the PyInstaller sidecar created a fresh database through an absolute disposable Windows path representing the `%LOCALAPPDATA%` layout. The packaged identity and first-admin migrations ran before normal `init_db()` initialization. Identity, scheduler, operational, academic, and reporting tables were present; WAL-backed operation, manual backup, guarded restore, session revocation, and `PRAGMA integrity_check = ok` succeeded.

Runtime validation wrote only beneath the supplied data root. Installation-directory/repository writes were not observed. Occupied-port and invalid-secret startup failed closed. Exact inherited Windows ACL behavior was not certified on a clean user profile, database locking was not tested with two packaged sidecars, and upgrade migration from a historical production snapshot remains required before Phase 11 approval.
