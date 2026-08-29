# Project context

OperatorOS is an offline-first school attendance and academic analytics system.
The supported runtime is a local browser application.

The current runtime contract is:

- Bun and TypeScript run the application.
- Elysia is the authoritative API runtime.
- React and Vite provide the browser UI.
- SQLite is the supported database.
- PostgreSQL is not supported by the current runtime.
- Containers are not required.
- The Tauri desktop shell is removed.

See [AGENTS.md](AGENTS.md), [docs/README.md](docs/README.md), and the current
architecture and operations documents for detailed procedures.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `apps/api/` | Elysia API, domain services, authentication, and API transport |
| `apps/web/` | React browser application and domain UI |
| `packages/contracts/` | TypeBox DTOs and cross-boundary contracts |
| `packages/db/` | Drizzle, SQLite access, and data-path resolution |
| `packages/ui/` | Reusable presentation primitives |
| `packages/excel/` | Excel import and export infrastructure |
| `packages/config/` | Shared workspace configuration |
| `backend/` | Retained Python reference code and development tooling |

The root `bun.lock` is the package lockfile authority. Bun manages runtime
packages and workspaces. Mise manages tool versions. HK manages Git lifecycle
checks. Turbo manages tasks and cache.

Current tool versions include:

- Mise `2026.8.14`
- Bun `1.4.0`
- HK `1.56.1`
- Turbo `2.10.12`
- React `19.2.4`
- React Router `7.18.2`
- TanStack Query `5.101.2`
- TanStack Table `8.21.3`
- Tailwind `4.2.2`
- Base UI `1.7.0`

## API and data ownership

The API exposes browser endpoints under `/api/<domain>/...`. The browser uses
the shared API abstraction. It does not import API internals directly.

`packages/contracts/` owns TypeBox request and response contracts. TypeBox is
the runtime contract authority. Zod is not used.

`packages/db/` owns the canonical data-path resolver. The preferred variable is
`OPERATOROS_DATA_DIR`. The database path is:

```text
<dataDir>/operatoros.sqlite
```

Backups and logs live below the same data root. The legacy
`OPERATOROS_DEV_DATA_DIR` variable remains a deprecated compatibility alias.

Tests and E2E use disposable data directories. They must never use the protected
operational database.

Authentication uses server-side sessions and an HttpOnly `astyx_session` cookie.
The browser does not store authentication tokens in local or session storage.
Authorization remains a server-side responsibility.

## Frontend ownership

`apps/web/` owns route modules, pages, feature components, query hooks, chart
adapters, and domain presentation.

React Router is the only route authority. TanStack Router is not installed.

Native controlled React forms, shared field primitives, and domain-local state
are the form authority. TanStack Form is not installed.

TanStack Query owns server state and cache invalidation. The application uses
one `QueryClient`. Logout clears protected query data. Query persistence to
`localStorage` is not used.

TanStack Table remains the table layer for complex grids. Chart.js remains the
chart layer. Chart adapters format server DTOs. They do not compute canonical
business metrics in the browser.

Canonical attendance, grade, cohort, and trend metrics come from server
analytics. The browser may format values, map labels, adapt chart data, and sort
presentation rows.

## Excel boundary

`packages/excel/` is private internal infrastructure. It may depend on
`packages/contracts/`. It must not depend on the database, UI, or applications.

ExcelJS `4.4.0` handles `.xlsx` work. `@e965/xlsx` `0.20.3` handles the
accepted legacy `.xls` adapter. Business formulas remain in the API and
analytics layers, not in Excel infrastructure.

## Python boundary

Python is not the production API runtime. The repository retains Python
reference code and tooling under `backend/`.

`backend/.venv` supports retained scripts, API tests, E2E helpers, CI fixture
setup, and local database/session helpers. CI can recreate it from
`backend/requirements.txt`.

Do not remove or replace this tooling without a separate Python-retirement
assessment. Do not execute the Python reference backend as the normal
application runtime.

## Development workflow

Use `./start-dev.sh` as the normal local launcher. It validates the Linux Bun
runtime and dependencies, resolves the managed development data root, creates
one owned process session, starts Elysia, then starts Vite.

The launcher waits for backend and frontend readiness. It records owned PIDs,
ports, logs, and session state below `.runtime/operatoros-dev/`. It reuses the
persistent development database across normal restarts.

Use these commands for routine checks:

```bash
./start-dev.sh --check
./start-dev.sh
./stop-dev.sh
make dev-db-status
make dev-sessions-status
```

Use `bun install --frozen-lockfile` for workspace dependencies. Use
`mise install` and `mise run doctor` for toolchain setup.

## Validation

The project keeps these checks active:

- dependency security audit and security tests;
- architecture boundaries and fixtures;
- TypeBox compatibility;
- package and web tests;
- API tests and OpenAPI checks;
- analytics and Excel validation;
- typecheck and production build;
- fresh and existing disposable database checks;
- E2E smoke and full E2E coverage;
- HK and Turbo validation.

Turbo uses measured concurrency and deterministic cache rules. Stateful tasks
remain uncached. CI must pass with empty caches.

## Package boundaries

The intended dependency direction is:

```text
apps/api -> contracts, db, excel
apps/web -> contracts, ui
excel    -> contracts
```

Packages must not import applications. The web application must not import
database, API internals, or Excel infrastructure. The UI package must remain
independent of applications, API code, databases, and Excel code.

## Historical documents

Phase reports and old product audits record historical evidence. They do not
override this context or current procedures in `AGENTS.md`, `docs/README.md`,
and the current architecture and operations documents.
