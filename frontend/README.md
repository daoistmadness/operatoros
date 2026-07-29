# OperatorOS Frontend

## Server-state and error conventions

- Normalize runtime failures at `src/lib/api/client.ts`; UI code consumes the
  typed helpers from `src/lib/api/errors.ts` and never renders raw causes.
- Define deterministic domain keys in `src/lib/query/queryKeys.ts`. Omit
  undefined filters and preserve textual identifiers.
- Prefer feature hooks named `useXxxQuery` or `useXxxMutation`. Query functions
  must forward TanStack Query's `AbortSignal`.
- Keep hooks unconditional and use `enabled` for inactive tabs or missing IDs.
- Mutations use exact domain invalidation; never call `invalidateQueries()`
  without a key.
- Keep local drafts, selections, modal state, browser effects, and explicit file
  downloads outside TanStack Query.

## Feature ownership

- Migrated domains live under `src/features/<feature>/` and expose one narrow
  public surface from `index.ts`.
- Routes and other domains import a feature through that public entry point;
  they do not import its `api/`, `pages/`, `queries/`, or component internals.
- Feature internals may import their own files and domain-neutral infrastructure
  from the existing shared roots. Shared code must never import a feature.
- Generated OpenAPI contracts remain under `src/generated/openapi/`. Only an
  approved feature API adapter may import them.
- Keep route page exports lazy-safe. Do not create a root feature barrel or
  eagerly import every feature page.
- Run `npm run boundaries:check` after changing imports, and
  `npm run boundaries:test` after changing the enforcement rules.

## Responsibilities
This React app provides the staff-facing UI for uploading attendance files, mapping students to classes, configuring HEB and jenjang rules, reviewing attendance overrides, and viewing reports and charts.

## Structure
```text
frontend/
├── src/
│   ├── components/   # Shared UI and navigation
│   ├── lib/          # API client and helpers
│   ├── pages/        # Route-level screens
│   ├── App.tsx       # Router definition
│   ├── main.tsx
│   ├── index.css     # Tailwind source
│   └── vite-env.d.ts
├── public/
└── package.json
```

## Requirements
- Node.js 22+
- npm

## Setup
```bash
cd frontend
npm ci
```

## Run
### Direct local development
```bash
npm run dev
```

### Repository launcher
Run the repo launcher from the root:
```bash
./start-dev.sh
```

The launcher starts Vite and FastAPI directly. Vite proxies canonical `/api/*` browser requests to the backend.

## Production Build
```bash
npm run build
```

The production bundle is served from `frontend/build/`.

## API Configuration
- [`src/lib/api/client.ts`](src/lib/api/client.ts) centralizes URL building.
- `VITE_API_BASE_URL` is the only build-time browser API base variable.
- The default empty value keeps requests same-origin; Vite proxies them during
  development and the local Tauri sidecar owns the packaged API lifecycle.
- The client sends JSON requests, multipart uploads, and file downloads through the shared request helper in `frontend/src/lib/api/`.
- Authentication uses the backend's HttpOnly session cookie rather than browser-stored bearer tokens.

## Routes and Pages
Routes are defined in [`src/App.tsx`](src/App.tsx):
- `/` Dashboard
- `/upload` Upload file import screen
- `/upload-history` Latest upload attempts
- `/mapping` Class mapping
- `/attendance-review` Manual attendance override review
- `/config/jenjang` Jenjang cutoff configuration
- `/config/heb` HEB overrides
- `/config/absence-reasons` Sakit / Izin / Alfa entry
- `/reports` Attendance report builder
- `/reports/rekap-absensi` Rekap absensi report
- `/reports/tardiness` Tardiness report
- `/settings` System reset and settings
- `/students/:id` Student profile

The `Settings` page hides destructive reset controls unless the backend explicitly reports that destructive operations are enabled.

## Desktop packaging

Tauri is the supported packaged target. It launches a local FastAPI sidecar and
uses SQLite; Docker, Nginx, Compose, and PostgreSQL are not runtime
dependencies.

## Verification
```bash
npm run build
```

If the build fails, check:
- `VITE_API_BASE_URL`
- the Vite proxy target in `vite.config.js`
- backend availability
- CORS settings on the API for direct-port development
- stale `node_modules/`

## Troubleshooting
- If the frontend cannot reach the API, confirm the Vite development proxy target and backend port.
- If the browser shows React HTML instead of JSON, confirm that the request path starts with `/api` exactly once.
- If uploads fail, verify that the workbook is `.xlsx` and that the backend sample template matches the source file.
- If browser verification fails, install Agent Browser with `npm install -g agent-browser` and `agent-browser install` (or `agent-browser install --with-deps` on Linux/WSL2).

## Known Limitations
- Frontend tests run with Vitest.
- The UI assumes the backend routes documented in the source code are available.
- Some screens depend on class mapping and HEB data being populated first.
