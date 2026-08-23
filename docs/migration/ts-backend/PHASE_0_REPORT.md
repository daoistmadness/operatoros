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
| Parity fixtures exist | **PARTIAL** — pure-function truth tables, import-preview goldens, HEB goldens landed (`golden/`); auth/override/corrections/reports/backup corpora still planned per `golden/docs/GOLDEN_PLAN.md` |
| Protected categories have a TS migration plan | PARTIAL — plan exists in `.omo/plans/ts-backend-migration.md`; per-category fixture mapping pending |
| Rollback strategy exists | DONE — full cutover with rehearsed rollback (master plan D7) |

## Golden corpus progress

Landed (regenerate via `golden/tools/generate_golden_fixtures.py`):

- `pure-functions/` — 4 truth tables (~35 cases): status derivation,
  late-minute precedence, cutoff/terlambat parsing, jenjang derivation.
- `attendance-import/` — synthetic 15-row workbook + frozen preview
  classification/counters, plus missing-header error case.
  Classifications exercised: NEW(6), DIFFERENCE(2), CONFLICT(3),
  INVALID(1). UNCHANGED not yet produced by the seed — revisit seed match.
- `heb/auto-manual-empty.json` — auto median-top5 (20), manual override
  wins (22), empty jenjang (0).

Recorded discoveries (behavior is authoritative):

1. Excel-source lateness fires ONLY for duration-parsable string values
   (e.g. `"00:25"` → `(25, "excel")`). Raw integers and `"00:00"` fall
   through to the calculated path. A TS port must reproduce this parser
   distinction exactly.
2. Malformed date `31/02/2026` coerces to null with a parse warning and the
   row drops as invalid — warning text recorded in run output and counters.
3. Exact-duplicate rows collapse before logical-row counting; divergent
   duplicates become CONFLICT rows.

## Deviations

1. Subagent/Oracle consultation unavailable this session (subagent model
   routing predates the free-model config switch). All analysis done
   in-session. Re-evaluate after an opencode restart.
2. `.nvmrc` is deleted in the operator's uncommitted working tree. The
   migration runtime contract says `.nvmrc` is authoritative. Needs an
   operator decision before Phase 12 launcher changes. Not fixed here.

## Completion audit (2026-08-23, second increment)

| Requirement | Status |
|---|---|
| Replay harness implemented | DONE — `golden/tools/harness.py` (adapters, 5 layers, verdicts, normalization) |
| FastAPI self-comparison | PASSED — 27/27 scenarios EXACT_MATCH |
| Deliberate mismatch detection | PASSED — injected fault flagged MIGRATION_DEFECT on all 27 |
| Deterministic generation | PASSED — both generators byte-identical on double runs |
| Protected DB boundary | HELD — fail-closed guard exercised during development; no protected access |
| Auth corpus | LANDED — 13 replay scenarios (login/logout/me/expiry/lockout/setup/role-metadata) |
| Override corpus | LANDED — incl. append-only trigger UPDATE/DELETE abort evidence |
| Corrections corpus | LANDED — submit/approve/reject/cancel/self-confirm/duplicate-terminal |
| Migration corpus | LANDED — startup-validation cases vs disposable DBs |
| Integrity corpus | LANDED — CHECK/unique/composite/FK-RESTRICT via replay SQL steps |
| KKM/terms/grades/HEB-edge/backup checksums | LANDED — service-level goldens (`service-corpora/`) |
| Coverage matrix | `golden/coverage-matrix.json` — 33 fixtures across categories |

### Remaining gaps (gate withheld)

1. Reports corpus: no dedicated report-aggregate fixtures yet.
2. Academic placement/canonical-resolution cases: creation-chain evidence
   only.
3. Restore HTTP-gate scenarios and backup execution-history cases: preflight
   rehearsal + checksum vectors cover the core, depth pending.

Per gate rules these keep `TYPESCRIPT_BACKEND_PHASE_0_READY` withheld until
closed.

### Runtime authority resolution

Current repository policy is Bun-authoritative for JavaScript tooling
(`frontend/bun.lock` whitelist, bun engines/scripts/CI). No `.nvmrc`
consumer exists in scripts, CI, or Makefile. The operator's uncommitted
`.nvmrc` deletion was not touched. Phase 0 documentation no longer claims
`.nvmrc` as authoritative.
