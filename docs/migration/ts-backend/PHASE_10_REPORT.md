# Phase 10 full API parity audit

Status: `LOCAL_ACCEPTANCE_READY_PENDING_PR_MERGE`.

Base: `daaa1a8ff052b958be573c15a390e42c6d035d2c`.

Branch: `codex/ts-backend-phase10-full-api-parity`.

Starting continuation HEAD: `7dc34f4`.

Current closure commits: `44ff2df`, `683d8dd`, `8cfa015`, `bb3ede8`.

Local acceptance is complete. The Phase 10 gate remains withheld until PR #58
is promoted, merged, and verified on `origin/main`.

## Completed in this loop

- Added the FastAPI root response at `GET /`.
- Added backup delete parity at `DELETE /api/admin/backups/{filename}`.
- Added verified backup download parity at
  `GET /api/admin/backups/{filename}/download`.
- Added focused disposable tests for backup download and deletion.
- Added analytics filter parity for canonical and legacy aliases.
- Added late-by-class, late-by-jenjang, and late-by-student parity for both aliases.
- Added attendance-rate by student and by jenjang parity for both aliases.
- Added monthly late counts by class parity for both aliases.
- Added attendance-report parity for both aliases.
- Added intervention-impact parity for both aliases.
- Added a management-summary candidate with disposable attendance, grade, term,
  and intervention tests.
- Added the operator work-queue candidate with server-side capability checks.
- Preserved the legacy `/students/operations` audit alias.
- Added the teacher-class assignment candidate with overlap and lifecycle checks.
- Added student export preview and download candidates with sensitive-field
  capability checks, row limits, and audit records.
- Added academic-master preview and roster-template candidates with non-mutating
  preview behavior and ExcelJS workbook output.
- Added staff import history and detail candidates with issue-count aggregation.
- Added student import rollback-preview candidate behavior with legacy fail-closed handling.
- Added transactional student import rollback commit candidate behavior with idempotency.
- Added data portability dataset, CSV export, template, import, and history candidates.
- Added upload history, timeline, row outcome, sanitized evidence, missing-record,
  and sample-template candidates.
- Added attendance follow-up candidate discovery, workflow, metrics, notes, and history routes.
- Added report-builder template, branding, preview, and export candidates.
- Added historical-trends and management-summary export candidates.
- Added academic roster preview and commit candidates.
- Added the destructive system clear-data candidate.
- Added the complete route matrix in
  `phase10-endpoint-matrix.md`.
- Added legacy BIFF8 `.xls` replay through `@e965/xlsx` `0.20.3`.
- Added dual replay evidence for all 14 candidate route families.
- Added executable full-app OpenAPI contract parity for 326 intended operations.

## Current evidence

- FastAPI-versus-Elysia replay: 54/54 `EXACT_MATCH`.
- Phase 6 workbook replay: 5/5 `EXACT_MATCH`.
- Deliberate mismatch replay: 54/54 `MIGRATION_DEFECT`.
- TypeScript regression: 61/61 tests passed, 454 expectations.
- Typecheck: passed.
- Frozen Bun install: passed.
- PR #58 CI before continuation: backend, backend-ts, frontend, and docs passed.
- OpenAPI contract: 326/326 intended operations, 159/159 schemas, exact.
- The deprecated FastAPI `POST /api/uploads/upload` remains intentionally
  absent. Elysia-only `GET /ready` remains outside the FastAPI contract.

## Inventory

- FastAPI: 327 operations across 282 OpenAPI paths.
- Elysia: 327 candidate operations and one Elysia-only `/ready` route.
- Unresolved route registrations: 0.
- Unknown operations: 0.
- FastAPI aliases are included in the comparison.

## Replay and mismatch evidence

- Existing full Phase 0 replay: 40/40 `EXACT_MATCH`.
- Existing deliberate mismatch replay: 40/40 `MIGRATION_DEFECT`.
- Phase 10-specific candidate-family replay: 14/14 `EXACT_MATCH`.
- `.xlsx` replay: 3/3 `EXACT_MATCH`.
- `.xls` replay: 2/2 `EXACT_MATCH`.
- FastAPI self-replay: 54/54 `EXACT_MATCH` after adding the Phase 10 corpus.

## Closure evidence

- All 14 candidate families have representative FastAPI-versus-Elysia replay.
- Legacy `.xls` is `MIGRATED_TO_ELYSIA` with `@e965/xlsx` `0.20.3`.
- Request, response, status, cookie, security, and schema parity pass for the
  intended OpenAPI operations.
- The deprecated upload operation and Elysia readiness route have explicit
  dispositions.

## Safety and scope

- Protected database access: 0.
- FastAPI remains available.
- Frontend global cutover: no.
- Phase 11 started: no.
- Phase 7, Phase 8, and Phase 9 merged-main prerequisites remain accepted.

Next safe action: push the local acceptance commits to PR #58, observe required
CI, merge normally, and verify `origin/main`.
