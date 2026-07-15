# Backend Packaging Audit

The packaged executable needs the Python runtime, `backend/src`, dependency modules/native DLLs, the two migration-owned SQLite bootstrap scripts, explicit absolute configuration, and writable app-data paths. It must not depend on a repository working directory or `.env`.

| Dependency/area | Classification | Packaging finding |
| --- | --- | --- |
| FastAPI, Starlette, Pydantic/settings | Pure Python/core | Packaged successfully. Settings instantiate during import, so the entrypoint must configure environment first. |
| SQLAlchemy | Python plus Greenlet binary | Packaged and initialized SQLite successfully. Dynamic dialect hooks produce harmless warnings for unused MySQL/PostgreSQL drivers. |
| Uvicorn standard | Python plus httptools/watchfiles/websockets binaries | Required explicit hidden protocol/loop/lifespan modules; one worker and no reload. |
| pandas/NumPy | Native/high risk | Dominates analysis/build size; PyInstaller hooks included DLLs. Excel-path parity still needs a clean-machine matrix. |
| openpyxl/xlrd/XlsxWriter | Python | Included through application imports; functional report/import coverage remains required. |
| ReportLab/Pillow | Python plus Pillow binaries/resources | Hooks executed; every PDF/font path needs golden-output validation. |
| Argon2 | Native binding | Packaged login succeeded, proving the binding loaded on this host. |
| asyncpg | Native/optional desktop | Explicitly included for build parity, though SQLite desktop v1 does not use it. Separate server/desktop dependency sets may reduce size later. |
| SQLite | CPython standard extension | Database creation, WAL configuration, integrity, backup, and restore succeeded. |
| Raw SQL migrations | External resources | Identity/setup SQL was explicitly bundled. Production needs a versioned migration manifest; arbitrary filename execution is prohibited. |
| `.env` and relative paths | Runtime risk | Desktop entrypoint sets configuration before importing `main`; absolute launcher-owned paths are required. |

## Spike entrypoint behavior

`desktop-spike/backend_entry.py` is intentionally experimental. It resolves `%LOCALAPPDATA%\Astryx` (or a disposable override), persists an auth secret outside the executable, applies identity/setup migrations idempotently, rejects partial identity schema, then imports FastAPI and binds only to loopback.

Current `init_db()` still performs table creation, seeding, and compatibility patches at import time. That worked in the package, but Phase 11 must replace implicit startup patching with an inventory/version gate and pre-migration backup policy described in the database lifecycle document.

PyInstaller warnings about missing Jinja2 and unused `pysqlite2`, MySQLdb, psycopg2 are non-blocking for observed routes, but the complete warning file must be reviewed whenever dependencies change.
