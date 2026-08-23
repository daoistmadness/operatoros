# Golden Corpus Plan — TypeScript Backend Migration

Status: scaffolding complete, corpora filling incrementally
Reference implementation (parity oracle): current FastAPI backend
Protected DB rule: every fixture uses synthetic data and disposable
in-memory or temp-file SQLite. `backend/attendance.db` is never opened.

## Purpose

Golden fixtures are the acceptance evidence for the migration. Each fixture
records the behavior of the CURRENT Python backend. The future Elysia
backend must reproduce the recorded behavior. Differences are classified,
never silently accepted.

## Corpus taxonomy (directive areas × protected categories)

| # | Area | Protected category | Fixture set | Status |
|---|---|---|---|---|
| 1 | Lateness/status pure rules | import validation, report correctness | `pure-functions/derive-status.json`, `late-minutes.json`, `cutoff-parsing.json`, `jenjang-derivation.json` | LANDED |
| 2 | Excel import preview pipeline | import validation | `attendance-import/normal-preview.json` + `.xlsx` sources | LANDED |
| 3 | HEB calculation | report correctness | `heb/auto-manual-empty.json` | LANDED |
| 4 | Authentication flows | API contract, authorization | `auth/` | PLANNED Phase 3 |
| 5 | Authorization matrix | authorization | `auth/` role/capability matrix | PLANNED Phase 3 |
| 6 | Early departure grace | report correctness | `early-departure/` | PLANNED Phase 5 |
| 7 | Overrides + append-only history | data integrity | `overrides/` incl. trigger rejection cases | PLANNED Phase 5 |
| 8 | Corrections state machine | data integrity | `corrections/` | PLANNED Phase 5 |
| 9 | Academic masters + enrollments | API contract | `academics/` | PLANNED Phase 4 |
| 10 | Grades grid save + uniqueness | data integrity | `grades/` | PLANNED Phase 7 |
| 11 | KKM fallback + term mapping | report correctness | `kkm/` (85.0 fallback, Term 1-4 defaults) | PLANNED Phase 7 |
| 12 | Rekap/report aggregates | report correctness | `reports/` | PLANNED Phase 8 |
| 13 | Backup checksum + identity | migration/rollback | `backups/` corruption-detection cases | PLANNED Phase 9 |
| 14 | Restore gates fail-closed | migration/rollback | `restore/` each gate refusal | PLANNED Phase 9 |
| 15 | Migration ledger/fingerprint | migration/rollback | `migrations/` s42→s43 steps | PLANNED Phase 2 |
| 16 | Browser critical workflows | critical browser workflows | e2e suite reuse (no new corpus) | EXISTING |

## Normalization rules

Only nondeterministic fields may be normalized during comparison:

- timestamps (`created_at`, `uploaded_at`, `set_at`)
- generated UUIDs and autoincrement surrogate ids where they do not carry
  business meaning
- absolute durations of internal operations

Business fields are never normalized: statuses, classifications, counts,
late minutes, late source, HEB values, KKM values, percentages.

## Parity classes

| Class | Meaning | Mergeable |
|---|---|---|
| EXACT_MATCH | byte-equal JSON after canonicalization | yes |
| NONDETERMINISTIC_EQUIVALENT | equal after allowed normalization | yes |
| INTENTIONAL_CONTRACT_CHANGE | approved documented difference | only with approval record |
| MIGRATION_DEFECT | any other difference | no — blocks phase |

## Regeneration

All landed fixtures regenerate from source of truth:

```
cd backend
.venv/bin/python ../docs/migration/ts-backend/golden/tools/generate_golden_fixtures.py
```

The generator is deterministic. Committed outputs must never be hand-edited.
