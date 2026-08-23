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
| 1 | Lateness/status pure rules | import validation, report correctness | `pure-functions/*.json` (4 tables, ~35 cases) | LANDED |
| 2 | Excel import preview pipeline | import validation | `attendance-import/*` workbook + frozen preview | LANDED |
| 3 | HEB calculation | report correctness | `heb/auto-manual-empty.json` + `heb/even-median-rounding.json` | LANDED |
| 4 | Authentication flows | API contract, authorization | `corpora/auth/*.json` (13 scenarios) | LANDED |
| 5 | Authorization matrix | authorization | embedded in auth + review/corrections denial scenarios | LANDED (endpoint-scoped) |
| 6 | Early departure grace | report correctness | pending | PLANNED Phase 5 |
| 7 | Overrides + append-only history | data integrity | `corpora/attendance-review/*.json` incl. trigger-abort cases | LANDED |
| 8 | Corrections state machine | data integrity | `corpora/corrections/*.json` (submit/approve/reject/cancel/self-confirm/duplicate) | LANDED |
| 9 | Academic masters + enrollments | API contract | creation-chain evidence only (grades seed); canonical-resolution cases pending | PARTIAL |
| 10 | Grades grid save + uniqueness | data integrity | `service-corpora/grades/constraints.json` (unique/CHECK/RESTRICT) | LANDED |
| 11 | KKM fallback + term mapping | report correctness | `service-corpora/kkm/resolution-and-term-defaults.json` (85.0 fallback verified at source) | LANDED |
| 12 | Rekap/report aggregates | report correctness | no dedicated fixtures yet | MISSING |
| 13 | Backup checksum + identity | data preservation | `service-corpora/backup/checksum-vectors.json`; execution-history cases pending | PARTIAL |
| 14 | Restore gates fail-closed | migration/rollback | `service-corpora/restore/preflight-gates.json` (21-step rehearsal); HTTP gate scenarios pending | PARTIAL |
| 15 | Migration ledger/fingerprint | migration/rollback | `service-corpora/migrations/startup-validation.json` (fresh/memory/missing-path/no-ledger/empty-file) | LANDED |
| 16 | Browser critical workflows | critical browser workflows | e2e suite reuse (no new corpus) | EXISTING |

Replay harness (`tools/harness.py`) evidence: self-comparison 27/27
EXACT_MATCH; injected mismatch detected 27/27 MIGRATION_DEFECT.
Determinism: both generators byte-identical across double runs after
path/free-space/digest sanitization.

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
