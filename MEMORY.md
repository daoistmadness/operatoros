# Memory

This file records durable project decisions and stable context for future agent runs.

## Stable Decisions
- The repository is a full-stack school attendance analytics system, not a generic dashboard starter.
- The backend is FastAPI + SQLAlchemy, and the frontend is React with CRA-style scripts.
- `backend/src/main.py` is the authoritative router registration point.
- `backend/src/core/database.py` creates tables on startup and applies compatibility fixes for older local databases.
- Raw SQL files in `backend/migrations/` are the repo’s visible migration history.
- The frontend client uses `http://localhost:8000` for local development and `/api` in the Docker bundle.
- `frontend/nginx.conf` strips `/api/` and forwards requests to the backend service.
- Portless is the preferred local launcher, with default logical route names `school-attendance` and `api.school-attendance`.
- Portless mode uses same-origin `/api` browser requests and worktree-prefixed `.localhost` URLs.
- Portless proxy defaults to port 443 (HTTPS) and relies on a unified shared state directory (`PORTLESS_STATE_DIR`) instead of privilege-boundary file links.
- React dev server proxy (`setupProxy.js`) verifies Portless development TLS natively using `NODE_EXTRA_CA_CERTS`.
- `scripts/verify-browser.sh` is the repo-owned Agent Browser smoke test and writes artifacts under `.artifacts/browser/`.
- The backend currently has no explicit auth/authorization system in server code.
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
- `POST /system/clear-data` is guarded by `ENABLE_DESTRUCTIVE_OPERATIONS=false` by default and requires the `CLEAR_ALL_ATTENDANCE_DATA` confirmation token.
- The backend can construct a PostgreSQL SQLAlchemy URL from `POSTGRES_*` fields; Compose supplies `db` as the service host.
- Backend behavioral tests now live under `backend/tests/` and are run with `pytest`.
- On developer machines where Windows Dapodik Apache owns port 443, the WSL Portless proxy uses a documented non-conflicting public port. The project never stops or reconfigures Dapodik automatically.

## Operational Notes
- Keep SQLite database files and generated Excel outputs out of version control unless a task explicitly requires them.
- Keep `frontend/node_modules/`, `frontend/build/`, and other generated assets unedited.
- `start-dev.sh` is the preferred local launcher for WSL2 development and defaults to Portless.
- `start-dev.sh --no-portless` is the safe direct-port fallback; it fails on occupied ports instead of killing them.
- `portless trust` is a required first-time setup step for the default local launcher.
- `docker compose down -v` is destructive because it removes the PostgreSQL volume.

## Links
- See [AGENTS.md](AGENTS.md) for current operating rules.
- See [COMMANDS.md](COMMANDS.md) for verified commands.
- See [ERRORS.md](ERRORS.md) for fragile areas and recurring issues.
- See [CONVENTIONS.md](CONVENTIONS.md) for observed code conventions.
