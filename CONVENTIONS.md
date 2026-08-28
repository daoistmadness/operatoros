# Conventions

## Naming
- Python modules, variables, and functions use `snake_case`.
- React components, context providers, hook modules, and page files use `PascalCase` when they represent components or pages.
- SQL migration files are date-stamped and descriptive, for example `2026_04_02_dashboard_performance_indexes.sql`.
- Utility scripts use descriptive imperative names, for example `generate_primary_lateness_dashboard.py`.

## Organization
- Backend routes live in `apps/api/src/domains/` and `apps/api/src/auth/`.
- Backend database schema lives in `apps/api/src/db/`.
- Backend processing logic and analytics live in the TypeScript domain modules.
- Frontend route screens/pages live in `apps/web/src/pages/`.
- Shared UI and API helpers live in `apps/web/src/components/` and `apps/web/src/lib/`.

## Formatting
- **Python**: Follow PEP8 standards. Indentation uses 4 spaces.
- **JavaScript / TypeScript / CSS / HTML / JSON**: Indentation uses 2 spaces. Semicolons are preferred in JavaScript and TypeScript.
- **Markdown**: Use standard headers and lists. Do not backtick-wrap the display text of links (e.g. write `[link text](README.md)` rather than `[`link text`](README.md)`).

## Imports and Structure
- Keep imports grouped by standard library, third-party, then local modules.
- Prefer small helper functions over deeply nested logic.
- Keep route registration explicit in `apps/api/src/app.ts`.
- Keep frontend route definitions explicit in `apps/web/src/App.tsx`.
- Keep API URL construction centralized in `apps/web/src/lib/api/client.ts` rather than scattering backend URLs across pages.
- Keep development routing centralized in `apps/web/vite.config.js` and `start-dev.sh`; browser requests should use `/api` exactly once.
- Keep destructive request payloads typed with Elysia schemas rather than accepting unstructured JSON.

## Error Handling
- Backend routes return sanitized Elysia error envelopes for client-facing validation errors.
- Upload and report endpoints return structured payloads rather than plain strings where practical.
- Frontend API calls surface backend `detail` messages when available.
- Destructive or privileged actions should log requests, rejections, and completion without logging sensitive payload values.

## Logging
- Backend uses simple logging and `print(...)` timing in some analytics endpoints.
- Avoid introducing noisy logging unless it helps diagnose a known issue.

## Testing Style
- Backend behavioral tests live under `apps/api/tests/` and use Bun.
- Frontend tests live under `apps/web/src/` (e.g. `*.test.js` or `*.test.ts`) and use `Vitest`.
- Validate behavior with startup checks, smoke requests, backend tests, and frontend build checks.
- For user-visible frontend changes, run the Agent Browser smoke test when the tool is available.

## Review Standards
- Preserve existing API shapes unless the task explicitly changes them.
- Avoid rewriting generated build artifacts or one-off repair scripts unless that is the task.
- Prefer targeted changes that are easy to verify and easy to roll back.
- Do not edit `apps/web/build/`, `apps/web/node_modules/`, local database files, or generated reports as part of ordinary reviews.
