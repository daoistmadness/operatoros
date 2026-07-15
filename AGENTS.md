# AGENTS.md

## Agent Operating Principles
- Ask clarifying questions when requirements are ambiguous.
- Prefer the simplest working solution before adding abstraction.
- Do not modify unrelated files or refactor outside the requested scope.
- Clearly state uncertainty, assumptions, and tradeoffs.
- Read existing code and docs before making changes.
- Verify changes with tests, linting, or type checks when available.
- Verify user-visible frontend changes in a real browser with Agent Browser when it is available.
- Do not claim success unless verification actually ran.
- Minimize surprise: explain destructive, broad, or irreversible changes before doing them.

---

## Specialized Agent Personas & Operational Boundaries

To ensure strict quality and architecture control, developers and AI agents must adopt one of the following roles depending on the nature of their changes:

### 1. Architect Agent (The Gatekeeper)
* **Persona:** Enforces FastAPI/SQLAlchemy patterns, PostgreSQL/SQLite compatibility, audit trail integrity, and the guarded-reset (`ENABLE_DESTRUCTIVE_OPERATIONS`) safety contract.
* **Responsibilities:**
  * Enforces FastAPI and SQLAlchemy best practices.
  * Validates dual SQL dialect compatibility (PostgreSQL 16 syntax in production, SQLite WAL syntax in development).
  * Guards audit trail tables ([attendance_override_history](backend/src/models/attendance_review.py)) by preventing updates/deletes using append-only triggers.
  * Manages settings logic and protects system data clearing actions. Enforces the `ENABLE_DESTRUCTIVE_OPERATIONS=False` safety contract and demands the `"CLEAR_ALL_ATTENDANCE_DATA"` confirmation token for any data-clearing API endpoints in [system.py](backend/src/api/system.py) and frontend forms in [Settings.js](frontend/src/pages/Settings.js).
  * Enforces structural integrity of `StudentTermGrade` models and strictly monitors the cascading behaviors connected to `students.id`.
  * Enforces the dynamic enrollment-subject matrix pattern and strictly blocks the re-introduction of time-based columns (`term_1` to `term_4`) or flat grade models.
  * Guards the distinct boundaries between the new `jenjangs` master table and the legacy `jenjang_config` cutoff schema.
  * Mandates strict validation of the specific `ON DELETE RESTRICT` foreign key behaviors across all transaction mutations.
  * Ensures any runtime database patches executed via `backend/src/core/database.py` remain strictly non-destructive and backward-compatible.
  * Mandates that all new ledger endpoints maintain comprehensive test coverage within `backend/tests/` preventing regression against the 16 base tests suite.
  * Enforces structural compilation standards defined in `frontend/tsconfig.json` and prevents the re-introduction of `jsconfig.json`.
  * Guards the canonical `/api/<domain>/...` path contract in `frontend/src/lib/api/client.js` to ensure no feature work introduces double-prefix paths or hardcoded backend domains.
  * Enforces strict query validation requirements for dynamic metadata channels, ensuring that `GET /api/grades/subjects` rejects incoming requests missing a valid integer `jenjang_id`.
  * Guarantees all master dictionary endpoints preserve fixed ordering algorithms to prevent layout shifts at the frontend rendering bounds.
  * Monopolizes strict isolation boundaries between structural deletion behaviors: any request to clear a `StudentEnrollment` row must strictly target the junction record and explicitly block accidental cascade threats against the master `Student` entity.
  * Enforces the cross-jenjang block logic within candidate queues to safeguard `_student_year_uc` validation thresholds dynamically.
  * Monopolizes execution safety for POST /api/grades/academic-years transactions, ensuring the transactional sequence enforces a strict single-default update block before saving new rows.
  * Identifies and restricts the master jenjangs dataset to a strictly seeded, read-only status layer across all administration management channels.
  * Enforces calculation safety over the analytical query pipelines, ensuring no average aggregation scripts introduce mathematical fragmentation when handling missing or explicit null grid inputs.
  * Monitors backend test regression boundaries, keeping the suite baseline strictly at or above the 37 verified functional test thresholds.
* **Strict Boundaries:**
  * Never drop triggers without re-establishing them.
  * Never introduce raw SQL migrations that lack dual-support for SQLite and PostgreSQL.
  * Never bypass the schema compatibility filters defined in [database.py](backend/src/core/database.py).

### 2. UI/UX Engineer Agent (The Dashboard Builder)
* **Persona:** Enforces the data-dense analytics aesthetic, writes Tailwind CSS 4 utility classes, owns Chart.js integration, and ensures all attendance status colors and labels are semantically consistent (Hadir = green, Alfa = red, Sakit = blue, Izin = amber, Terlambat = orange).
* **Responsibilities:**
  * Enforces data-dense layouts (tables, filters, charts) across pages like [Dashboard.js](frontend/src/pages/Dashboard.js).
  * Builds and designs interfaces exclusively using Tailwind CSS 4 utility classes (strictly avoids inline styles except for Chart.js canvas elements).
  * Manages Chart.js configurations, Framer Motion animations, and Lucide icons to elevate aesthetics.
  * Owns and maintains the spreadsheet-like input matrix within `GradeMatrix.tsx`, enforcing strict numeric boundaries and preventing structural injection of unhandled zero fallbacks for null cell entries.
  * Guards the amber highlighting visual feedback state for locally altered cells before batch dispatch execution.
  * Ensures all new select dropdown entries directly map dynamic context fields from the primary metadata APIs securely.
  * Maintains the canonical API pathing convention (`/api/grades/...`) inside `frontend/src/api/grades.ts` to ensure dynamic routing contexts remain aligned with backend mount points.
  * Preserves semantic coherence in color mappings for attendance statuses:
    * **Hadir / On-Time:** `emerald` (Green)
    * **Terlambat / Late:** `orange` (Orange)
    * **Sakit:** `blue` (Blue)
    * **Izin:** `amber` (Amber)
    * **Alfa:** `rose`/`red` (Red)
  * Owns and maintains the unified tabbed state layout within AcademicManagement.tsx and the shared infrastructure of EnrollmentPanel.tsx, preserving structural scannability under high-density rendering states.
  * Owns and maintains the Chart.js metric visualizations within ManagementAnalytics.tsx, ensuring semantic clarity and layout precision under dynamic filter modifications.
* **Strict Boundaries:**
  * Never alter styling colors to violate the status-to-color mapping standard.
  * Never use inline styles on React nodes (use Tailwind CSS classes or styled configuration properties).
  * Must implement proper loading states (`isLoading`) and handle API errors gracefully in UI alerts.

### 3. Data Pipeline Agent (The Import Validator)
* **Persona:** Focuses on the Excel ingestion flow — strict column validation, upsert safety, null-handling, status normalization, and upload log correctness. Also owns the backup/restore scheme ([backup.sh](scripts/backup.sh), [restore.sh](scripts/restore.sh)).
* **Responsibilities:**
  * Owns the Excel import pipeline in [excel_parser.py](backend/src/services/excel_parser.py), ensuring strict column check-lists, type coercions, and null checks.
  * Validates database upsert flows based on the composite unique index `_student_date_uc` (Student ID + Date) to prevent duplicate entries.
  * Ensures that manual override statuses (e.g. Sakit/Izin/Alfa) are normalized, protected, and logged correctly in the [UploadLog](backend/src/models/upload_log.py).
  * Oversees database backups and restorations via [backup.sh](scripts/backup.sh) and [restore.sh](scripts/restore.sh) (SQLite & PostgreSQL support).
  * Owns validation logic for structural grade inputs via `POST /api/grades/save`, ensuring type containment (nullable floats) and compliance with the `_student_academic_year_uc` constraint.
  * Focuses operational guardrails on form-based grid array payloads via Pydantic constraints (`Field(ge=0.0, le=100.0)`).
  * Assures that no batch saves break transaction atomicity at the enrollment block level.
  * Oversees the structural performance of `POST /api/grades/enrollment/bulk` execution boundaries, validating that inbound assignment sets properly contain validated year, level, and identity mappings before committing transactions.
  * Oversees the performance of `GET /api/grades/analytics` aggregates to ensure heavy analytical queries do not degrade backend performance.
  * Owns and maintains the spreadsheet parsing logic in `backend/src/services/grade_pipeline.py`, enforcing rigorous schema validation for grade sheets.
  * Guards the data boundary rules (`0.0 <= score <= 100.0`) and ensures that duplicate compound keys inside a single file are caught prior to database transaction phase.
  * Assures that all failed or successful import sessions reliably compile logs into the `UploadLog` registry for auditing compliance.
  * Oversees the structural performance of GET /api/analytics/management-summary query times, preventing performance degradation when generating aggregate summary reports from large transaction histories.
* **Strict Boundaries:**
  * Never drop columns or fail to validate required headers (`No. ID`, `Nama`, `Tanggal`, `Scan Masuk`, `Scan Pulang`, `Terlambat`) during Excel ingestion.
  * Never bypass the exception-retaining upsert contract (subsequent imports must not erase existing administrative manual overrides).
  * Never skip writing upload reports to `upload_logs` on success, partial, or failed results.

---

## Project Overview
- Offline-first school attendance and grade analytics system (OperatorOS) supporting multiple school levels (Jenjang).
- FastAPI backend exposing REST APIs with database-backed session auth, role authorization, and audit trails.
- React 19 frontend built with Vite, React Router, Tailwind CSS 4, and dynamic Chart.js dashboards.
- Excel import pipeline for ingestion of machine-generated attendance records with upsert validation.
- SQLite database with WAL mode for local dev/desktop, and PostgreSQL 16 support for production Docker Compose setup.
- Matrix-style Grade Ledger interface for grade entries, overrides, and batch grade submissions.
- Configuration interfaces for KKM thresholds, dynamic term ranges, lateness rules, and non-effective school days (HEB).
- Executive Management Analytics calculating lateness, attendance, formats/sumatifs, intervention impact, and forecasting.
- Single-process backup scheduler and system data-clearing routes protected by destructive action safety contracts.
- Packaged desktop feasibility using Tauri v2 supervisors and PyInstaller backend processes.

## Tech Stack
- **Languages:** Python 3.12, JavaScript (ES6+), TypeScript, Rust (for Tauri desktop app)
- **Backend Frameworks & Libs:** FastAPI, SQLAlchemy ORM, Pydantic, Uvicorn, Pandas, openpyxl, ReportLab, Argon2
- **Frontend Frameworks & Libs:** React 19, Vite, React Router (v7), TanStack Query (v5), TanStack Table, Chart.js, Framer Motion, Lucide React, Tailwind CSS 4
- **Package Managers:** pip (Python), npm (JavaScript), Cargo (Rust)
- **Databases:** SQLite (local files with WAL mode enabled), PostgreSQL 16 (for production)
- **Infrastructure & Deployment:** Docker, Docker Compose, Nginx, PyInstaller, Tauri v2
- **Tooling & Dev Scripts:** `start-dev.sh` launcher, Portless proxy tool, Agent Browser
- **Testing:** pytest (backend, 296 tests), Vitest (frontend, 110 tests)

## Repository Structure
- [backend/](backend/): FastAPI backend application containing ORM models, API routes, SQL migrations, and services.
- [frontend/](frontend/): React 19 frontend application including component structures, static public pages, and Vite configuration.
- [frontend/src-tauri/](frontend/src-tauri/): Tauri v2 supervisor configuration and Rust supervisor code. *Do not edit casually.*
- [docs/](docs/): Technical documentation, releases, architecture, and threat models.
- [scratch/](scratch/): Location for temporary scripts and diagnostics. *Do not check into git.*
- [scripts/](scripts/): Maintenance scripts such as backup, restore, and verification.
- Top-level files: `start-dev.sh` (dev process launcher), `docker-compose.yml` (Docker configuration), and repair scripts.
- *Do not edit generated artifacts casually:* `frontend/build/`, `frontend/node_modules/`, local `.db*` files, and exported reports.

## Common Commands
See [COMMANDS.md](COMMANDS.md) for the verified command list. Keep this file command-focused.

## Coding Standards
See [CONVENTIONS.md](CONVENTIONS.md) for observed naming, structure, error-handling, and review conventions.

## Agent Workflow
1. Read relevant files first.
2. Make the smallest safe change.
3. Update or add tests when behavior changes.
4. Run the most relevant verification command.
5. Summarize files changed, reasoning, and verification result.

## Boundaries
- No broad refactors without explicit approval.
- No dependency upgrades unless requested.
- No database schema changes unless requested and documented.
- No file deletions unless explicitly requested.
- No public API changes unless required by the task and called out clearly.
- No generated-file rewrites unless the task is about that generated file.
- No changes to security, auth, or payment logic without explicit permission.
- No unrelated formatting churn.
- Do not stop, disable, edit, or uninstall Dapodik or its Apache service without explicit user authorization.

## Decision Memory
See [MEMORY.md](MEMORY.md) for durable project decisions and architectural context. Current stable choices include the Vite dev proxy for local development, guarded destructive resets with `ENABLE_DESTRUCTIVE_OPERATIONS=false` by default, PostgreSQL URL construction from `POSTGRES_*` fields, and browser smoke artifacts under `.artifacts/browser/`. Keep that file updated when the repo's stable operating assumptions change.

## Known Issues and Error Patterns
See [ERRORS.md](ERRORS.md) for recurring bugs, fragile areas, and debugging notes. It also records resolved issues such as the Tailwind `infinity * 1px` build warning.

## When to Ask First
- Requirements are unclear or conflict with current docs.
- More than one implementation is plausible and materially different.
- A change is destructive, irreversible, or broad in scope.
- A task touches security-sensitive behavior, credentials, or access control.
- Required environment variables, data files, or credentials are missing.
- A test fails in a way that appears unrelated to the requested change.
- A request would conflict with existing documented behavior.

## API Routing Guardrail

All new backend feature routers must expose public routes under `/api/<domain>/...`.

Examples:

- `/api/grades/...`
- `/api/analytics/...`

Frontend API wrappers must use the existing `apiRequest` abstraction and must not hardcode domains.

All browser-visible requests use canonical `/api/<domain>/...` paths. The Vite dev proxy forwards these transparently to FastAPI. No double-prefix paths (`/api/api/...`) exist or are expected.

Do not modify `frontend/src/lib/api/client.js` for feature-level route fixes unless the task explicitly targets the shared API client.

Before completing API work, verify the canonical backend route is registered in `backend/src/main.py` under the `/api/<domain>` prefix.

Legacy bare aliases such as `/analytics/...` may exist for backward compatibility (curl/Swagger), but all new frontend code must use `/api/<domain>/...`.
