# Windows Desktop Data Lifecycle Report

Audit date: 2026-07-15
Target: Windows 11 x64

## Required production layout

```text
%LOCALAPPDATA%\OperatorOS\
├── Data\
├── Backups\
├── Logs\
├── Runtime\
└── Exports\
```

This exact contract is **not implemented**.

## Current behavior

Normal backend defaults are relative to the process working directory: `.env.example` uses `sqlite:///./attendance.db`, and `BACKUP_DIR` defaults to `./backups/`. Development launchers intentionally write repository-local databases, secrets, and logs. Shell backup scripts also write beneath the repository. These paths are unsuitable for an installed desktop executable.

The experimental Windows entry point redirects data to `%LOCALAPPDATA%\Astryx` (or `ASTRYX_DATA_ROOT`) with lowercase `data`, `backups`, `logs`, and `runtime`, plus `config/auth-cookie-secret`. It does not create an exports directory, and no production logging handler writes to its logs directory. Browser report downloads are initiated by the WebView and are not governed by an OperatorOS exports policy.

## Writes beside source/executable risk

Without the experimental bootstrap or equivalent production bootstrap, SQLite, WAL/SHM files, backups, audit JSONL, and dotenv-relative behavior depend on the current working directory. The repository already contains examples of root/backend-local `.db`, WAL, backup, and development log artifacts. A packaged process must set absolute paths before importing backend configuration or database modules.

## Required lifecycle decisions

1. Resolve `%LOCALAPPDATA%\OperatorOS` through a trusted Windows API and create the five required directories before sidecar import.
2. Place the database and WAL/SHM files in `Data`; backups and audit mirrors in `Backups`; rotating application/Uvicorn logs in `Logs`; locks/PID/readiness metadata in `Runtime`; and explicit report exports in `Exports`.
3. Decide a secure location for the cookie secret. If an additional `Config` directory is prohibited, place a restrictively ACL'd secret in `Runtime` or document a sixth directory. Do not put it beside the executable.
4. Define upgrade, uninstall-with-data-preservation, explicit data removal, backup retention, crash recovery, and legacy `%LOCALAPPDATA%\Astryx` migration behavior.
5. Enforce one owner per data root and one worker; clean stale runtime metadata without treating a stale file alone as proof of a live process.
6. Never write into `Program Files`, the Tauri resource directory, or the PyInstaller extraction directory.

## Verdict

Readiness: **45% — feasibility proven under the old name; production lifecycle contract missing**.
