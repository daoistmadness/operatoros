# Platform runtime risk assessment

> **Historical audit record.** Current contracts are [platform portability](../architecture/PLATFORM_PORTABILITY.md), [desktop sidecar runtime](../architecture/DESKTOP_SIDECAR_RUNTIME.md), and [ingestion strategy](../architecture/INGESTION_DEPENDENCY_STRATEGY.md).

## Executive summary

Source inventory found SQLite as supported runtime, PostgreSQL-aware code and
Compose dependencies without real PostgreSQL 16 execution, and substantial
Tauri/PyInstaller sidecar contracts without clean-machine packaged validation.
Pandas/openpyxl ingestion is present; no replacement benchmark/parity evidence
exists. No protected operational data was used.

## Classifications

- Database: `SQLITE_SUPPORTED_POSTGRES_EXPERIMENTAL`.
- Desktop: `DESKTOP_RUNTIME_EXPERIMENTAL`.
- Ingestion: `NO_CHANGE_JUSTIFIED`.

## Deferred evidence

PostgreSQL requires real migration, analytical, and concurrency contracts.
Desktop requires clean-machine onedir execution, resource smoke, and lifecycle
evidence. Ingestion requires synthetic measured parity before a streaming or
Calamine recommendation. Date policy is UTC timestamps with explicit
school-calendar dates; host-local timezone must not define attendance dates.
Runtime diagnostics should report build/version, schema head, dialect, package
mode, and Python version without secrets or sensitive paths.
