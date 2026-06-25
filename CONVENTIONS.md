# Conventions

## Naming
- Python modules and functions use `snake_case`.
- React components and page files use `PascalCase` when they represent components.
- SQL migration files are date-stamped, for example `2026_04_02_dashboard_performance_indexes.sql`.
- Utility scripts use descriptive imperative names, for example `fix_parser.py` and `generate_primary_lateness_dashboard.py`.

## Organization
- Backend routers live in `backend/src/api/`.
- Backend models live in `backend/src/models/`.
- Backend processing logic lives in `backend/src/services/`.
- Frontend route screens live in `frontend/src/pages/`.
- Shared UI and API helpers live in `frontend/src/components/` and `frontend/src/lib/`.

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
- Validate behavior with startup checks, smoke requests, backend tests, and frontend build checks.
- For user-visible frontend changes, run the Agent Browser smoke test when the tool is available.

## Review Standards
- Preserve existing API shapes unless the task explicitly changes them.
- Avoid rewriting generated build artifacts or one-off repair scripts unless that is the task.
- Prefer targeted changes that are easy to verify and easy to roll back.
- Do not edit `frontend/build/`, `frontend/node_modules/`, local database files, or generated reports as part of ordinary reviews.
