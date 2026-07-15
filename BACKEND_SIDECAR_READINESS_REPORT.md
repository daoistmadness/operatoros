# FastAPI Sidecar Readiness Report

Audit date: 2026-07-15

## Verified backend contract

- Entry point: `backend/src/main.py`, exporting `app`.
- Container production command: `uvicorn src.main:app --host 0.0.0.0 --port 8000 --workers 1` in `backend/Dockerfile`.
- Desktop spike entry: `desktop-spike/backend_entry.py`, which imports `main:app` after adding `backend/src` through the PyInstaller spec.
- Health endpoint: `GET /health` returns `{"status": "ok"}`.
- Settings: environment-backed Pydantic settings in `backend/src/core/config.py`; `DATABASE_URL` or a complete PostgreSQL field set is mandatory.
- Database: SQLAlchemy engine and SQLite WAL/foreign-key pragmas in `backend/src/core/database.py`.
- Initialization: `init_db()` creates non-identity tables, seeds minimum grade-ledger data, and runs compatibility patches. Identity tables are migration-owned.
- Authentication secret: startup fails closed unless `AUTH_COOKIE_SECRET` is at least 32 characters.
- Scheduler/restore contract: one backend worker is the expected safe configuration.

## Production independence

The FastAPI application itself does not require Vite or other frontend development tooling. A PyInstaller build can remove the Python installation requirement. However, `backend/requirements.txt` mixes runtime and test dependencies (`pytest`, `httpx`) and no production lock/artifact manifest is present.

## Runtime path readiness

Database and backup locations can be redirected through `DATABASE_URL` and `BACKUP_DIR`. The experimental entry point proves creation of a persistent secret and directories from `ASTRYX_DATA_ROOT`. Core backend settings do not define an OperatorOS data-root, log directory, runtime directory, or export directory; production desktop bootstrap must supply resolved absolute paths before importing `main`.

## Migration readiness

This is the principal backend blocker. There is no Alembic or general migration runner. Startup combines `create_all`, runtime compatibility patches, and manually applied SQL migrations. The experimental executable bundles and runs only the 2026-07-13 identity and 2026-07-14 first-admin SQLite migrations. It does not establish a complete, ordered, versioned upgrade path for all repository migrations.

## Logging

Python modules use standard `logging`, and security/backup operations write JSONL audit artifacts under `BACKUP_DIR`. No production sidecar logging configuration or rotation to `%LOCALAPPDATA%\OperatorOS\Logs` was found. Uvicorn console logging alone is insufficient for a windowed packaged app.

## Secrets

Database credentials, cookie secret, setup token, and policy settings are externalized. The spike persists the cookie secret to a file, but under `%LOCALAPPDATA%\Astryx\config`; Windows ACL hardening and the final OperatorOS path contract are not implemented.

## Verdict

Readiness: **70% — requires modification**. The application is embeddable and has a valid health/auth/database foundation. A production bootstrap, complete migrations, persistent logging, and clean packaged-runtime validation are mandatory.
