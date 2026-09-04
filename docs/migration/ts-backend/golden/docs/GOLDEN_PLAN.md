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
| 9 | Academic placement + canonical resolution | data integrity, API contract | `service-corpora/academic/placement-and-resolution.json` + `corpora/academic-placement/*` (3 scenarios: history listing, missing-master 404, duplicate-year 409) | LANDED |
| 10 | Grades grid save + uniqueness | data integrity | `service-corpora/grades/constraints.json` (unique/CHECK/RESTRICT) | LANDED |
| 11 | KKM fallback + term mapping | report correctness | `service-corpora/kkm/resolution-and-term-defaults.json` (85.0 fallback verified at source) | LANDED |
| 12 | Report aggregates (monthly/management/annual/rekap/tardiness) | report correctness | `service-corpora/reports/*` (8 files) + `corpora/reports/*` (5 scenarios) | LANDED |
| 13 | Backup checksum + identity + execution history | data preservation | `service-corpora/backup/checksum-vectors.json` + `service-corpora/restore/success-path.json` (creation/history/checksum relation) | LANDED |
| 14 | Restore gates fail-closed + success path | migration/rollback | preflight rehearsal + `corpora/backup-restore/*` (6 scenarios) + `service-corpora/restore/success-path.json` (200 restore, snapshot, revocation, recovery history, corrupt fail-closed) | LANDED |
| 15 | Migration ledger/fingerprint | migration/rollback | `service-corpora/migrations/startup-validation.json` (fresh/memory/missing-path/no-ledger/empty-file) | LANDED |
| 16 | Browser critical workflows | critical browser workflows | e2e suite reuse (no new corpus) | EXISTING |

Replay harness (`tools/harness.py`) evidence: self-comparison 40/40
EXACT_MATCH; injected mismatch detected 40/40 MIGRATION_DEFECT.

Restore success path (`service-corpora/restore/success-path.json`):
HTTP backup 200 with checksum; two-phase contract (preflight SHA256s +
four acknowledgements + RESTORE_DATABASE phrase); restore HTTP 200 with
post_restore integrity ok / FK violations 0; cookie + database session
revocation proven; post-backup marker session absent (restored state
proven); safety snapshot via pre-restore auto backup; recovery history
RESTORE_REQUESTED -> STARTED -> COMPLETED with matching
operation_reference_id and safety_backup_filename; corrupt backup fails
closed; restored DB history shows backup-era RUNNING row (source-
accurate replacement semantics). Root cause of earlier empty-backup
evidence: frozen pydantic settings fields — fixed by repointing
settings.DATABASE_URL/BACKUP_DIR at the disposable active DB before the
one-time main import.

Academic placement evidence (`service-corpora/academic/`): full population
action matrix (CREATE_ENROLLMENT / ALREADY_ENROLLED / CROSS_JENJANG_CONFLICT /
MISSING_MASTER_LINK / MISSING_CLASS), jenjang resolution EXACT / MISSING /
AMBIGUOUS (genuine two-candidate ambiguity via normalized name collision),
class APPROVAL_REQUIRED, populate preview→commit→idempotent re-commit,
wrong-confirmation rejection, attendance FK preservation across enrollment
population, duplicate master+year rejected at database layer
(`uq_student_master_academic_year` — schema-prevented ambiguity), master
delete RESTRICT, historical ENDED + current ACTIVE coexistence with no
flattening onto student_masters, canonical person identity architecture,
name-only merge prohibition. Future-dated enrollment: NOT_APPLICABLE
(source keys placement on lifecycle_state + academic_year only).
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
python_tooling="$(bun scripts/python-tooling-env.ts --repo . print-executable)"
PYTHONHASHSEED=0 OPERATOROS_PYTHON="$python_tooling" "$python_tooling" docs/migration/ts-backend/golden/tools/generate_golden_fixtures.py
```

The generator is deterministic for all JSON evidence when run with PYTHONHASHSEED=0 (parser set-ordering is hash-seed dependent). The `.xlsx` binaries
embed build timestamps and are regenerated artifacts: their bytes may differ
between runs; their PARSED content is what carries parity meaning. The
preview checksum is frozen to a token for the same reason. Committed outputs
must never be hand-edited.
