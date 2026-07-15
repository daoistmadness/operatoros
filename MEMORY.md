# Memory

This file records durable project decisions and stable context for future agent runs.

## Stable Decisions
- The repository is a full-stack OperatorOS school attendance and grade analytics platform, not a generic dashboard starter.
- The backend is FastAPI + SQLAlchemy, and the frontend is React 19 with Vite.
- `backend/src/main.py` is the authoritative router registration point.
- `backend/src/core/database.py` creates tables on startup and applies compatibility fixes for older local databases.
- Raw SQL files in `backend/migrations/` are the repo's visible migration history.
- The frontend uses Vite for development. In dev mode, `VITE_API_BASE_URL` is empty and the Vite dev proxy forwards `/api/*` from `http://127.0.0.1:5173` to `http://127.0.0.1:8000`.
- All API paths are canonical `/api/<domain>/...`. No double-prefix paths (`/api/api/`) exist anywhere in the codebase.
- `frontend/nginx.conf` serves the production build and proxies `/api/` to the backend service.
- `scripts/verify-browser.sh` is the repo-owned Agent Browser smoke test and writes artifacts under `.artifacts/browser/`. Default target URL is `http://127.0.0.1:5173`.
- The backend has database-backed users and sessions, Argon2id password hashing, one-time first-administrator provisioning, HttpOnly cookie authentication, role dependencies, session expiry/revocation, and admin-only authorization for protected operations. Fresh installations have no default credentials.
- Management Analytics KKM thresholds and term date ranges are database-backed under `/api/academic-config`; the analytics JSON/PDF/Excel paths resolve configured values first and preserve legacy fallback behavior when no config exists.
- Academic interventions are stored in `academic_interventions` and exposed under `/api/academic-interventions`; Management Analytics Below-KKM JSON/PDF/Excel rows include active intervention status, priority, owner, and follow-up metadata.
- Management Analytics exports utilize in-memory serialization (`io.BytesIO` streams) for zero disk footprint concurrency safety. The PDF layout is landscape vector-rendered with ReportLab; the Excel layout is an advanced editable Pandas + XlsxWriter workbook with native linked charts and deterministic column mapping.
- The Executive Insights engine dynamically runs rule checks to generate actionable management findings, rendering them in the JSON payload, frontend Analisis & Rekomendasi Manajemen panel, PDF page 1, and Excel `Insights` worksheet.
- Phase 18 historical trend analytics are exposed at `/api/analytics/historical-trends` and rendered in Management Analytics under `Historical Trends`. Trend payloads include attendance, lateness, grade, Below-KKM, intervention, KKM metadata, term metadata, data quality diagnostics, and deterministic forecast series.
- Phase 18 forecasting is transparent and conservative only: allowed methods are moving average, weighted moving average, and simple linear trend. Forecast rows must expose method, history point count, confidence, data sufficiency, and warning text; fewer than 2 history points returns no forecast. Do not add opaque AI/ML forecasting.
- Phase 18 Management Analytics exports include trend/forecast PDF pages and editable Excel sheets `Trend_Attendance_Data`, `Trend_Lateness_Data`, `Trend_Grades_Data`, `Trend_Interventions_Data`, `Forecast_Data`, and `Trend_Insights` with native charts linked from `Charts`.
- Phase 19 intervention impact analytics are exposed at `/api/analytics/intervention-impact` and rendered in Management Analytics under `Intervention Impact`. Baseline score is `academic_interventions.current_average`; latest score is the current Grade Ledger average for the same student/year/subject/assessment context; score delta is latest minus baseline.
- Phase 19 risk scoring is deterministic and explainable only. Risk factors include still below effective KKM, non-positive score delta, overdue follow-up, high/urgent priority, repeated context, open longer than 30 days, and missing latest score. Do not add opaque AI/ML risk scoring.
- Phase 19 exports include an Intervention Impact PDF page and editable Excel sheets `Intervention_Impact_Data`, `Intervention_Impact_Summary`, `Risk_Students_Data`, and `Owner_Workload_Data` with native charts linked from `Charts`.
- Phase 20 report builder templates are exposed at `/api/report-builder/...`. Report templates and branding configs seed idempotently on startup, the builder uses `threshold_source` and the Phase 18/19 analytics payloads as its data source, and user-created templates are preserved across restarts.
- `POST /system/clear-data` is guarded by `ENABLE_DESTRUCTIVE_OPERATIONS=false` by default and requires the `CLEAR_ALL_ATTENDANCE_DATA` confirmation token.
- Phase 9 scheduled backups use a single-process in-application scheduler with persistent `backup_scheduler_config` and `backup_execution_history` tables, filesystem snapshot compatibility, automatic verified execution, and UTC daily/weekly/monthly retention. No external queue, cloud storage, or distributed scheduler is used.
- Phase 8 frontend query architecture is complete for the approved authentication, Backup Management, and Executive Reports pilots. TanStack Query owns the shared provider/client, query keys, retry/cache policy, and mutation invalidation. TanStack Table remains selective, and Grade Matrix remains explicitly excluded.
- Phase 9 core platform work is complete, but Phase 9.6 remains implemented rather than externally closed until the packaged artifact passes the clean no-development-tool Windows runbook. Local Windows Job Object, single-instance, integrity, port-release, and restart contracts pass 9/9 with no xfail.
- Phase 10 incremental design-system modernization is complete. Login, navigation, Settings, Backup Management, restore dialog, Executive Reports, Dashboard/Attendance Summary, and target semantic tables use the owned primitive/shared-pattern system; 200%-equivalent reflow, rendered contrast, and disposable monthly/annual PDF/XLSX acceptance passed.
- The backend can construct a PostgreSQL SQLAlchemy URL from `POSTGRES_*` fields; Compose supplies `db` as the service host.
- Backend behavioral tests now live under `backend/tests/` and are run with `pytest`.
- The desktop (Tauri) launcher will inject `window.__APP_CONFIG__ = { apiBaseUrl: "http://127.0.0.1:<port>" }` at runtime. The API client reads this before VITE_API_BASE_URL.
- Phase 11.0 uses a minimal Tauri v2 shell under `frontend/src-tauri`. It embeds `frontend/build` through the `custom-protocol` feature, exposes no Rust commands or native capabilities, and does not start the FastAPI sidecar; runtime API injection and sidecar ownership remain Phase 11.1 work.
- Phase 11.0.1 WebView2 authentication acceptance is complete. A disposable external backend verified first-admin setup, login validation, Secure HttpOnly SameSite=Lax cookie creation, reload/restart restoration, logout cleanup, protected-route blocking, and one-shot expired-session 401 recovery without local/session-storage tokens. Phase 11.1 is ready.
- **Verified Test Suites (July 2026)**: The backend test suite contains 296 tests verified using `pytest`. The frontend test suite contains 110 tests verified using `Vitest`. Both suites pass cleanly on the standard development stack.

## Operational Notes
- Keep SQLite database files and generated Excel outputs out of version control unless a task explicitly requires them.
- Keep `frontend/node_modules/`, `frontend/build/`, and other generated assets unedited.
- `./start-dev.sh` is the preferred local launcher. It starts uvicorn and the Vite dev server concurrently. Press Ctrl+C to stop both.
- `./scripts/start-backend.sh` and `./scripts/start-frontend.sh` can be used to start services individually.
- `docker compose down -v` is destructive because it removes the PostgreSQL volume.

## Links
- See [AGENTS.md](AGENTS.md) for current operating rules.
- See [COMMANDS.md](COMMANDS.md) for verified commands.
- See [ERRORS.md](ERRORS.md) for fragile areas and recurring issues.
- See [CONVENTIONS.md](CONVENTIONS.md) for observed code conventions.
- See [Phase 10 release notes](docs/releases/phase-10-design-system-modernization.md) for the current completed milestone and [Phase 8–10 consolidated status](docs/project-status/phases-8-to-10.md) for the foundation history and open Phase 9.6 gate.
