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

## Project Overview
- Full-stack attendance analytics system for school operations.
- FastAPI backend with SQLAlchemy models, routers, and services.
- React frontend with routed pages, charts, and configuration screens.
- Excel import flow for attendance spreadsheets and sample-template downloads.
- Local SQLite support plus Docker Compose PostgreSQL support.
- Manual review features for attendance overrides and absence reasons.
- Configuration screens for jenjang cutoffs, HEB overrides, and system settings.
- Report generation for attendance, rekap absensi, tardiness, and dashboard views.
- WSL2-oriented development launcher and operational docs.
- Portless-first launcher plus a safe direct-port fallback for local worktrees.
- Repository-owned Agent Browser smoke testing for frontend verification.
- Utility scripts for dashboard generation, repair, and diagnostics.

## Tech Stack
- Languages: Python, JavaScript
- Backend: FastAPI, SQLAlchemy, Pydantic, Uvicorn, pandas, openpyxl
- Frontend: React 19, react-scripts, React Router, Tailwind CSS 4, Chart.js, Framer Motion, lucide-react
- Package managers: pip, npm
- Databases: SQLite, PostgreSQL 16
- Infrastructure: Docker, Docker Compose, Nginx
- Tooling: `start-dev.sh`, shell scripts, Excel utilities
- Testing: backend `pytest` tests, frontend CRA test script, and docs-link validation

## Repository Structure
- `backend/`: API source, ORM models, services, and raw SQL migration files
- `frontend/`: React source, API client, pages, components, and Nginx config
- `docs/`: operating notes, WSL2 guidance, and utility script docs
- `scratch/`: one-off diagnostics; do not treat as supported workflows
- Top-level `*.py`: reporting or repair scripts; some rewrite code or output files
- `docker-compose.yml`: container orchestration for backend, frontend, and PostgreSQL
- `start-dev.sh`: local WSL2 dev launcher
- Do not edit generated artifacts casually: `frontend/build/`, `frontend/node_modules/`, local `attendance.db*` files

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

## Decision Memory
See [MEMORY.md](MEMORY.md) for durable project decisions and architectural context. Current stable choices include the local-vs-Docker API base split (`http://localhost:8000` vs `/api`), guarded destructive resets with `ENABLE_DESTRUCTIVE_OPERATIONS=false` by default, PostgreSQL URL construction from `POSTGRES_*` fields, Portless as the preferred launcher, and browser smoke artifacts under `.artifacts/browser/`. Keep that file updated when the repo’s stable operating assumptions change.

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
