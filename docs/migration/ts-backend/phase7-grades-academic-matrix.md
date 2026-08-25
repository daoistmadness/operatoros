# TypeScript Backend Phase 7 Endpoint Matrix

Base: `08ec1f61db3dcea9f716f2cc1d1bdca36deb1e0a`

Branch: `codex/ts-backend-phase7-grades-academic`

The Phase 7 routes use the existing S4.3 SQLite schema and server-side
authorization. Tests use disposable databases only.

| Domain | FastAPI routes | Elysia routes | Status |
| --- | --- | --- | --- |
| Grades | 14 routes under `/api/grades` | Same 14 routes | `MIGRATED_PARITY_GREEN` |
| Academic configuration | 10 routes under `/api/academic-config` | Same 10 routes | `MIGRATED_PARITY_GREEN` |
| Progression | 8 routes under `/api/student-progression` | Same 8 routes | `MIGRATED_PARITY_GREEN` |
| Interventions | 6 routes under `/api/academic-interventions` | Same 6 routes | `MIGRATED_PARITY_GREEN` |

## Evidence

- Grade constraint golden: unique grade rows, component checks, and subject delete restriction.
- KKM golden: configured precedence and fallback `85.0`.
- FastAPI grade and academic-config tests: `26 passed`.
- FastAPI progression tests: `9 passed`.
- TypeScript focused academic tests: `3 passed`, `17 expectations`.
- Complete TypeScript regression: `42 passed`, `210 expectations`.
- TypeScript typecheck passed.
- Frozen Bun install passed.

The Phase 0 HTTP corpus has no dedicated grade, intervention, or progression
scenarios. Those routes use source tests and disposable TypeScript integration
tests until the full API parity phase expands HTTP coverage.

Phase 8 has not started. FastAPI remains available. The frontend has not cut
over.
