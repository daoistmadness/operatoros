# Phase 6 Excel Import Matrix

Base: `d42134af87329bc55a7b14479f47ed5f0537c290`

| Endpoint | FastAPI reference | Elysia candidate | Evidence |
| --- | --- | --- | --- |
| `POST /api/uploads/preview` | `MIGRATED_PARITY_GREEN` | `MIGRATED_PARITY_GREEN` | normal workbook and missing-header golden |
| `POST /api/uploads/preview/{batch_id}/commit` | `MIGRATED_PARITY_GREEN` | `MIGRATED_PARITY_GREEN` | transactional apply and idempotent retry |
| `GET /api/uploads/history*` | `NOT_YET_MIGRATED` | FastAPI remains active | read-only upload history is outside the Phase 6 import write path |

The TypeScript import path supports the Phase 0 `.xlsx` corpus. FastAPI remains
available for the current `.xls` compatibility path. The frontend has not
cut over.

Replay evidence:

- 3/3 scenarios: `EXACT_MATCH`.
- 1/1 semantic mutation: `MIGRATION_DEFECT`.
- Existing preview hash: `07cd270ef40c`.
