# Phase 12 Cutover Matrix

Base: `f87b58997f474fa6bc489d158efe97096bff6e28`

Phase 12 makes Elysia the normal application backend. FastAPI remains a
selectable rollback and reference backend. Both backends use the accepted
SQLite schema. No production database is used by cutover checks.

| Authority point | Current default | Target default | Rollback | Validation | Status |
| --- | --- | --- | --- | --- | --- |
| Combined development launcher | FastAPI | Elysia | `OPERATOROS_BACKEND=fastapi ./start-dev.sh` | Launcher tests and disposable smoke | `LOCAL_GREEN` |
| Standalone backend launcher | FastAPI | Elysia | `OPERATOROS_BACKEND=fastapi ./scripts/start-backend.sh` | Script validation and health check | `LOCAL_GREEN` |
| Frontend development proxy | Selected backend | Elysia | Set `OPERATOROS_BACKEND=fastapi` | Browser smoke with both runtimes | `LOCAL_GREEN` |
| E2E primary backend | FastAPI-compatible stack | Elysia | `OPERATOROS_E2E_BACKEND=fastapi` | E2E smoke with disposable SQLite | `LOCAL_GREEN` |
| CI primary runtime smoke | FastAPI reference | Elysia | Python backend regression job | CI workflow | `REQUIRED_PR_CI_PENDING` |
| Health and readiness | FastAPI | Elysia `/health`, `/ready` | FastAPI health endpoints | Curl and startup checks | `LOCAL_GREEN` |
| Scheduler owner | FastAPI runtime | Elysia runtime | FastAPI fallback process | Process and lifecycle checks | `LOCAL_GREEN` |
| Operator documentation | FastAPI | Elysia | Rollback runbook | Documentation audit | `LOCAL_GREEN` |

Required final state:

- Every normal authority point identifies Elysia.
- FastAPI remains available without source edits.
- No normal mode starts both backends.
- The final runtime uses one scheduler owner.
- Protected database access remains zero.

Local acceptance is green. Required pull request CI remains pending until the
cutover commits are pushed. The local evidence includes the default Elysia
launcher, the FastAPI fallback, both browser stacks, frontend and backend
tests, the production build, and the full Python backend suite.
