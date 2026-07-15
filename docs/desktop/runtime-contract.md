# OperatorOS Desktop Runtime Contract

- Status: **Frozen for Phase 11.1B–11.1D**
- Target: Windows 11 x64
- Owner: Tauri runtime for directory preparation; FastAPI sidecar for application data
- Last reviewed: 2026-07-15

## Purpose

This document defines the filesystem and data-lifecycle contract for the installed OperatorOS desktop application. Implementations may add internal files inside the listed directories, but may not introduce another mutable root or write mutable state beside application binaries.

## Canonical paths

The per-user data root is exactly `%LOCALAPPDATA%\OperatorOS`. Tauri resolves `%LOCALAPPDATA%` through the operating system, canonicalizes the result, and passes absolute paths to the sidecar. The current working directory is never used to derive production paths.

```text
%LOCALAPPDATA%\OperatorOS\
├── Data\
│   └── operatoros.db
├── Backups\
├── Logs\
├── Runtime\
└── Exports\
```

SQLite companion files `operatoros.db-wal` and `operatoros.db-shm` may exist in `Data` while SQLite requires them.

| Directory | Ownership and contents | Retention |
|---|---|---|
| `Data` | FastAPI/SQLAlchemy database and SQLite companion files | Persistent across restart, upgrade, uninstall, and reinstall by default |
| `Backups` | Managed backups, integrity metadata, and security/operation audit mirrors | Persistent; backend retention rules apply only to managed backups |
| `Logs` | Rotating, redacted Tauri, sidecar, startup, migration, and crash diagnostics | Persistent with bounded retention |
| `Runtime` | Sidecar/data-root lock, non-secret launch metadata, and the persistent ACL-protected `auth-cookie-secret` | Ephemeral files are cleaned only after ownership checks; the secret persists |
| `Exports` | User-requested generated copies and reports managed by OperatorOS | Persistent until explicitly removed by the user or an approved retention policy |

`Runtime\auth-cookie-secret` is created atomically by the sidecar on first initialization, contains at least 32 random bytes of entropy, and is restricted to the current Windows user. It is never exposed to React, logged, embedded, or regenerated merely because the application restarts or upgrades.

## Binary contract

Installer-controlled application files, including `OperatorOS.exe`, `operatoros-sidecar.exe`, frontend assets, migrations, and libraries, are immutable during ordinary use. They live in the installer-selected application location. The application must not self-modify these files or use that location for data, configuration, logs, backups, exports, locks, or temporary database files.

The following are prohibited:

- writing `operatoros.db` or its WAL/SHM files beside `OperatorOS.exe`;
- using a relative production `DATABASE_URL`, backup path, log path, or export path;
- writing `.env`, credentials, mutable configuration, or a generated secret beside binaries;
- treating the PyInstaller extraction directory or Tauri resource directory as writable storage;
- redirecting the SQLite database to a network or roaming-synchronized directory.

## Directory protection

Tauri creates the canonical root and five directories before launching the sidecar. Creation must fail closed when the resolved root is outside `%LOCALAPPDATA%\OperatorOS`, is a file, is a network location, cannot be protected for the current user, or is otherwise unsafe. The sidecar independently canonicalizes and validates every supplied path before database initialization.

Ordinary application operation runs without administrator privileges. Access control is limited to the current Windows user and required operating-system principals. Logs redact passwords, cookies, session/setup secrets, database credentials, and sensitive request bodies.

## Installation and data lifecycle

### First installation

1. The installer writes immutable application files only.
2. On first launch, Tauri creates the canonical directory tree.
3. The sidecar atomically creates the persistent cookie secret.
4. The sidecar initializes `Data\operatoros.db`, applies the approved migration sequence, verifies integrity, and only then reports ready.
5. First-admin provisioning proceeds through FastAPI; no default account or password is created.

### Upgrade

The installer replaces only application files. It preserves `%LOCALAPPDATA%\OperatorOS` in place. The new sidecar validates the existing database, creates and verifies any required pre-migration backup, applies forward migrations, and reports ready only after all checks pass. Two application versions must never concurrently access the same data root.

### Uninstall

Default uninstall removes application binaries and installer metadata but preserves the complete OperatorOS data root. Data deletion is a separate, explicit, destructive user action with clear scope and confirmation; it must not be implied by ordinary uninstall.

### Reinstall

Reinstall discovers and reuses the preserved canonical data root. It validates the database and secret before opening the UI. It must not overwrite, silently reset, or create a second database when preserved data exists but cannot be opened.

### Legacy Astryx data

Automatic movement from `%LOCALAPPDATA%\Astryx` is not part of Phase 11.1B unless a separately approved, backup-first rename migration is implemented and tested. When both roots exist, OperatorOS must fail to an explicit recovery/migration choice rather than merge them or choose silently.

## Acceptance rules

Phase 11.1D must prove on a clean Windows 11 x64 profile that all mutable writes stay inside the canonical root or a user-selected export destination, upgrades/uninstalls preserve data, reinstall reuses it, secrets persist, and ordinary execution never requires elevation.
