# Phase 0 Report — TypeScript Backend Migration Gates

Date: 2026-08-23
Branch: `codex/ts-backend-phase0-gates`
Base: `codex/remove-tauri-shell` @ `75d8e7a` (worktree carried operator WIP; untouched)

Gate token: **NOT YET CLAIMED**. Fixture work remains. See checklist.

## Measured inventory (authoritative, generated from source)

| Item | Assumed | Measured | Evidence |
|---|---:|---:|---|
| HTTP endpoints | ~340 | **327** | `api-inventory.json` |
| OpenAPI path entries | — | 282 | `openapi-frozen.json` |
| Database tables | ~60 models | **77 tables** | `db-inventory.json` |
| SQL triggers | some | **15** on 5 tables | `db-inventory.json` |
| SQLite migration files | 42 total | 20 sqlite + 14 postgresql + other | `migrations-inventory.json` |
| Schema baseline/head | s42/s43 | `20260724_s42` / `20260725_s43` | `migration_manifest.json` |

Trigger-protected tables: `attendance_override_history`,
`student_enrollment_class_history`, `student_enrollment_lifecycle_audit`,
`student_master_change_history`, `student_progression_audit`.
These five are append-only by database trigger. Any TS data layer must keep
the same DDL.

Auth surface (from route dependencies): `get_current_user` (180 routes),
`capability_dependency` (128), `role_dependency` (61),
`require_restore_admin` (2), 3 routes with no dependencies.
Note: `get_db` appears on 304 routes as infrastructure, not authorization.

## Generation method

`tools/generate_inventories.py` imports the FastAPI app under the test-suite
isolation pattern (`OPERATOROS_ISOLATED_TEST=true`, disposable absolute-path
SQLite file, dummy secret). It never touches `backend/attendance.db`.
Rerun command:

```
cd backend && .venv/bin/python ../docs/migration/ts-backend/tools/generate_inventories.py
```

## Gate checklist

| Gate requirement | Status |
|---|---|
| API inventory exists | DONE |
| Database inventory exists | DONE (incl. triggers) |
| Migration inventory exists | DONE |
| OpenAPI contract frozen | DONE (`openapi-frozen.json`) |
| Parity fixtures exist | **PENDING** — golden corpus scaffolding is the next work item |
| Protected categories have a TS migration plan | PARTIAL — plan exists in `.omo/plans/ts-backend-migration.md`; per-category fixture mapping pending |
| Rollback strategy exists | DONE — full cutover with rehearsed rollback (master plan D7) |

## Deviations

1. Subagent/Oracle consultation unavailable this session (subagent model
   routing predates the free-model config switch). All analysis done
   in-session. Re-evaluate after an opencode restart.
2. `.nvmrc` is deleted in the operator's uncommitted working tree. The
   migration runtime contract says `.nvmrc` is authoritative. Needs an
   operator decision before Phase 12 launcher changes. Not fixed here.

## Next steps (in order)

1. Build golden fixture corpora (synthetic workbooks, request/response
   snapshots) under `docs/migration/ts-backend/golden/`.
2. Design the dual-backend replay harness (same requests → FastAPI vs Elysia,
   normalized nondeterministic fields only).
3. Scaffold `backend-ts/` package (Phase 1 start) only after fixtures exist.
