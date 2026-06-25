# School Attendance Analytics Backend

## Responsibilities
This backend exposes the attendance API, imports Excel files, stores students and attendance records, maintains lateness/HEB configuration, and generates report payloads and Excel exports.

## Structure
```text
backend/
├── src/
│   ├── api/        # Routers for uploads, analytics, students, config, review, system
│   ├── core/       # Settings and SQLAlchemy engine/session setup
│   ├── models/     # ORM models
│   ├── services/   # Excel parsing and attendance metric helpers
│   └── main.py     # FastAPI application entry point
├── migrations/     # Raw SQL migrations for SQLite and PostgreSQL
├── requirements.txt
└── Dockerfile
```

## Runtime and Configuration
- Python 3.12 is the current runtime used by the Docker image and dev script.
- `backend/src/core/config.py` loads environment variables from `backend/.env` when present.
- `DATABASE_URL` is optional when the `POSTGRES_*` fields are provided.
- `ENABLE_DESTRUCTIVE_OPERATIONS` defaults to `false` and keeps guarded reset routes disabled.
- Optional variables: `ALLOWED_ORIGINS`, `HOST`, `PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_HOST`, `POSTGRES_PORT`.
- Example values:
  - `DATABASE_URL=sqlite:///./attendance.db`
  - `ALLOWED_ORIGINS=http://localhost:3000`
  - `ENABLE_DESTRUCTIVE_OPERATIONS=false`
  - `HOST=0.0.0.0`
  - `PORT=8000`

## Setup
```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run
```bash
uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

The app exposes:
- API root: `GET /`
- OpenAPI docs: `GET /docs`
- Redoc: `GET /redoc`

## Router Layout
- `GET /analytics/*` for reports, dashboards, HEB, and attendance statistics
- `GET /uploads/*` and `POST /uploads/upload` for imports and upload history
- `GET /students/*` and `POST /students/set-class` for student management
- `GET /config/*` and `PUT /config/*` for jenjang, HEB overrides, and absence reasons
- `GET /review/*` and `POST /review/*` for attendance overrides
- `GET /system/health` and `POST /system/clear-data` for system checks and guarded resets
- `GET /api/tardiness/summary-by-jenjang` is also mounted directly in `backend/src/main.py`

## Database Behavior
- `core/database.py` creates the schema on startup with SQLAlchemy metadata.
- SQLite gets `PRAGMA foreign_keys=ON`, `journal_mode=WAL`, and related pragmas.
- The code applies compatibility fixes for older local databases, including missing columns and indexes.
- There is no Alembic runner in the repo; the SQL files in `backend/migrations/` are the canonical migration history.
- When PostgreSQL fields are set, the backend builds a SQLAlchemy URL from separate connection parts instead of string-concatenating credentials.

## Excel Import
- `POST /uploads/upload` accepts multipart form data with a `file` field.
- Only `.xlsx` files are accepted. The parser also accepts common spreadsheet MIME fallbacks.
- The first worksheet must include the required columns listed in `backend/src/services/excel_parser.py`.
- Rows are processed in chunks, student IDs may be backfilled, and late duration can be read from the file or derived from jenjang cutoffs.
- `GET /uploads/sample-template` downloads a sample workbook that matches the expected column layout.

## System Reset Guard
- `POST /system/clear-data` is disabled unless `ENABLE_DESTRUCTIVE_OPERATIONS=true`.
- The request body is a Pydantic model with `mode` and `confirmation`.
- The confirmation token must be `CLEAR_ALL_ATTENDANCE_DATA`.
- `mode="attendance"` deletes attendance data, override history, override rows, upload logs, and absence-reason data.
- `mode="full"` deletes the same data plus students.
- The route logs requests, rejections, and completion without logging sensitive row contents.

Example:
```bash
curl -X POST http://localhost:8000/system/clear-data \
  -H 'Content-Type: application/json' \
  -d '{"mode":"attendance","confirmation":"CLEAR_ALL_ATTENDANCE_DATA"}'
```

## Error Handling and Logging
- Upload failures return structured HTTP errors with hints when possible.
- The backend writes upload summaries to the `upload_logs` table.
- Some analytics endpoints emit basic timing logs with `print(...)` for performance inspection.

## Smoke Tests
```bash
curl http://localhost:8000/
curl http://localhost:8000/system/health
curl http://localhost:8000/uploads/history
curl "http://localhost:8000/analytics/monthly"
curl -o /tmp/attendance_template.xlsx http://localhost:8000/uploads/sample-template
```

Upload smoke test:
```bash
curl -F "file=@sample_attendance.xlsx" http://localhost:8000/uploads/upload
```

## Production and Container Notes
- `backend/Dockerfile` runs `uvicorn src.main:app --host 0.0.0.0 --port 8000 --workers 2`.
- `docker-compose.yml` connects the backend to PostgreSQL through `POSTGRES_*` variables.
- The backend container should connect to the database service as `db`, not `localhost`.
- `frontend/nginx.conf` is separate from backend deployment; it only matters when the frontend is containerized.

## Known Limitations
- No backend authentication or authorization layer is implemented.
- Historical SQL migrations are manual; there is no automated migration CLI in the repo.
- The `system/clear-data` endpoint is still high-risk even with the guard in place.
