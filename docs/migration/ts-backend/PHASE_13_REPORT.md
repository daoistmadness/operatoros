# Phase 13 — Python Backend Retirement

Status: local retirement gate passed; delivery gates pending.

## Accepted base

- Phase 12 main: `a8a0911592e6a9261124d9e75044c633939b8e0a`
- Branch: `codex/ts-backend-phase13-python-retirement`
- Authoritative backend: Elysia
- Protected database accessed: no

## Retired production artifacts

The following FastAPI application surface was removed:

- `backend/src/api/`
- `backend/src/main.py`
- `backend/src/sidecar_main.py`
- `backend/src/cli.py` and its retired CLI helpers
- `backend/src/security/`
- `backend/src/schemas/`
- `backend/src/services/auth_service.py`
- `backend/src/services/first_admin_provisioning.py`
- `backend/tests/`
- `backend/pytest.ini`
- `scripts/export_openapi.py`
- `scripts/s43_startup_smoke.py`
- `backend-ts/scripts/gen_schema.py`
- `build_dashboard.py`
- `fix_analytics.py`
- `fix_parser.py`
- `patch_analytics.py`

Active FastAPI route definitions: `0`.

Normal startup invokes Python backend code: `0`.

The normal launcher, standalone launcher, E2E stack, CI, and OpenAPI check now
use Elysia. The old backend selector and Uvicorn branch are removed.

## Retained Python inventory

Python remains only for these non-HTTP purposes:

| Area | Purpose | Production backend dependency |
| --- | --- | --- |
| `backend/src/core/`, `backend/src/models/`, and retained `backend/src/services/` | Disposable schema bootstrap, migration checks, fixture creation, backup safety checks, and historical report/import fixtures | No |
| `backend/migrations/` | Historical raw SQL migration evidence | No |
| `e2e/helpers/`, `e2e/smoke/backend/`, and `e2e/run-*.sh` helper calls | Disposable database seed, HTTP smoke assertions, and result summaries | No |
| `scripts/development_database.py`, `scripts/operatoros-dev-runtime.py`, and protected-path tools | Safe local database and process-session operations | No |
| `scripts/tests/` and `.github/scripts/check_markdown_links.py` | Independent test-scope and documentation tooling | No |
| `docs/migration/ts-backend/` Python tools and golden corpus | Archived migration evidence and source-independent regression fixtures | No |

No retained Python artifact is an HTTP server or normal application backend.
Unknown Python artifacts: `0`.

## Dependency result

The backend requirements file now contains only retained tooling:

- `sqlalchemy`: schema and disposable fixture tooling.
- `pandas`, `openpyxl`, `xlrd`, `xlsxwriter`, `reportlab`: retained fixture and
  historical export tooling.
- `pytest`, `httpx`: smoke and tooling tests.
- `argon2-cffi`: synthetic password fixtures.

Removed from active requirements:

- FastAPI
- Uvicorn
- Pydantic
- `pydantic-settings`
- `python-dotenv`
- `python-multipart`

Python runtime required for retained tooling: `yes`.

FastAPI production dependency: `0`.

Uvicorn production dependency: `0`.

Pydantic backend dependency: `0`.

SQLAlchemy application runtime: `0`. SQLAlchemy remains only in retained
tooling and historical fixture code.

## Regression evidence

- TypeScript backend: `61/61`, `455` expectations.
- Frontend: `301/301`.
- OpenAPI drift check: passed from the committed contract.
- TypeScript typecheck: passed.
- Frontend production build: passed.
- Disposable E2E smoke: `7` backend smoke tests and `19` browser workflows passed.
- Retained tooling tests: `55` passed.
- Protected database access: `0`.

## Retirement counts

- Python files removed: `127`.
- Python lines removed: `32,413`.
- Backend test files removed: `71`.
- Backend test lines removed: `16,614`.
- FastAPI route definitions remaining: `0`.
- Normal startup Python backend invocations: `0`.
- Retired FastAPI/Uvicorn/Pydantic production dependencies: `0`.

The previous Python application baseline of `745 passed, 30 skipped` is retired
with the deleted FastAPI test suite. Its critical behavior is covered by the
TypeScript backend, frontend, E2E, and retained safety-tool tests above.

## Evidence retention

The migration reports, endpoint matrices, OpenAPI evidence, golden corpus, raw
SQL migrations, and historical audit documents remain preserved. Archived
Python replay tools are not daily runtime or CI dependencies.

## Local gate

- Elysia authoritative: `yes`.
- FastAPI active runtime: `none`.
- Frontend tests: `301/301`.
- Backend TypeScript tests: `61/61`, `455` expectations.
- Typecheck: `passed`.
- Frozen Bun install: `passed`.
- Full E2E: `passed`.
- Scheduler owners: `1`.
- Process leaks: `0`.
- `.xlsx`: `passed`.
- `.xls`: `passed`.
- Backup and restore safety: `passed`.
- Protected database access: `0`.

The final gate remains pending PR CI, merge, and accepted-main post-merge
verification.
