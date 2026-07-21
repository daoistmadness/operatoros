# Conventions

## Naming
- Python modules, variables, and functions use `snake_case`.
- React components, context providers, hook modules, and page files use `PascalCase` when they represent components or pages.
- SQL migration files are date-stamped and descriptive, for example `2026_04_02_dashboard_performance_indexes.sql`.
- Utility scripts use descriptive imperative names, for example `fix_parser.py` and `generate_primary_lateness_dashboard.py`.

## Organization
- Backend routers live in `backend/src/api/`.
- Backend models live in `backend/src/models/`.
- Backend processing logic/analytics live in `backend/src/services/`.
- Frontend route screens/pages live in `frontend/src/pages/`.
- Shared UI and API helpers live in `frontend/src/components/` and `frontend/src/lib/`.
- Desktop Rust code lives in `frontend/src-tauri/src/`.

## Formatting
- **Python**: Follow PEP8 standards. Indentation uses 4 spaces.
- **JavaScript / TypeScript / CSS / HTML / JSON**: Indentation uses 2 spaces. Semicolons are preferred in JavaScript and TypeScript.
- **Markdown**: Use standard headers and lists. Do not backtick-wrap the display text of links (e.g. write `[link text](README.md)` rather than `[`link text`](README.md)`).

## Imports and Structure
- Keep imports grouped by standard library, third-party, then local modules.
- Prefer small helper functions over deeply nested logic.
- Keep route registration explicit in `backend/src/main.py`.
- Keep frontend route definitions explicit in `frontend/src/App.js`.
- Keep API URL construction centralized in `frontend/src/lib/api/client.js` rather than scattering backend URLs across pages.
- Keep Portless development routing centralized in `frontend/src/setupProxy.js` and `start-dev.sh`; browser requests should use `/api` exactly once.
- Keep destructive request payloads typed with Pydantic models rather than accepting unstructured JSON.

## Error Handling
- Backend routes raise `HTTPException` for client-facing validation errors.
- Upload and report endpoints return structured payloads rather than plain strings where practical.
- Frontend API calls surface backend `detail` messages when available.
- Destructive or privileged actions should log requests, rejections, and completion without logging sensitive payload values.

## Logging
- Backend uses simple logging and `print(...)` timing in some analytics endpoints.
- Avoid introducing noisy logging unless it helps diagnose a known issue.

## Testing Style
- Backend behavioral tests live under `backend/tests/` and use `pytest`.
- Frontend tests live under `frontend/src/` (e.g. `*.test.js` or `*.test.ts`) and use `Vitest`.
- Validate behavior with startup checks, smoke requests, backend tests, and frontend build checks.
- For user-visible frontend changes, run the Agent Browser smoke test when the tool is available.

## Review Standards
- Preserve existing API shapes unless the task explicitly changes them.
- Avoid rewriting generated build artifacts or one-off repair scripts unless that is the task.
- Prefer targeted changes that are easy to verify and easy to roll back.
- Do not edit `frontend/build/`, `frontend/node_modules/`, local database files, or generated reports as part of ordinary reviews.
