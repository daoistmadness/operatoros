# PyInstaller Audit Report

Audit date: 2026-07-15

## Classification

**B — Requires modification.** A working feasibility design exists, but no production OperatorOS sidecar artifact definition exists.

## Evidence

- `desktop-spike/spec/astryx_backend.spec` defines a one-file executable named `AstryxBackend`.
- `desktop-spike/build-pyinstaller.ps1` invokes PyInstaller into `desktop-spike/output/pyinstaller`.
- `desktop-spike/backend_entry.py` configures loopback Uvicorn, a dynamic port argument, SQLite, backups, a persistent cookie secret, migrations, and a single-instance data-root lock.
- `desktop-spike/supervisor.py` probes `/health` and demonstrates graceful-then-forced process-tree shutdown.
- The spike README labels all of this experimental and outside production deployment.

## Requirement assessment

| Requirement | Status | Finding |
|---|---|---|
| `operatoros-sidecar.exe` | Fail | Current output is `AstryxBackend.exe`. |
| No Python installation | Feasible, unverified for release | PyInstaller is designed to bundle Python, but no final clean-machine artifact evidence is tied to OperatorOS. |
| No source code at runtime | Feasible | One-file packaging is configured. |
| Dependencies bundled | Partial | Hidden imports are manually listed; build verification is needed for pandas/openpyxl/xlrd/xlsxwriter/reportlab/argon2/asyncpg and SQLAlchemy dialect paths. |
| Complete resources | Fail | Only two SQLite migration files are bundled. |
| Reliable startup | Partial | Loopback restriction, data-root lock, health probe prototypes, and Windows tests exist; production integration does not. |
| Reproducible build | Fail | PyInstaller is not pinned in backend dependencies and there is no release build/CI manifest. |

## Required changes

Create a production spec and entry point outside the experimental spike; name the binary `operatoros-sidecar`; bundle the complete approved SQLite migration set and required package data; configure persistent logs; preserve loopback-only binding and one worker; fail closed on invalid paths/secrets/migrations; pin build tooling separately from runtime dependencies; and validate on a clean Windows 11 x64 machine.

Do not use the sidecar bootstrap to bypass server sessions or move application logic out of FastAPI.
