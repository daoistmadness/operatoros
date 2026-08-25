# Phase 10 full API parity audit

Status: `BLOCKED_TYPESCRIPT_BACKEND_PHASE_10_FULL_API_PARITY`.

Base: `daaa1a8ff052b958be573c15a390e42c6d035d2c`.

Branch: `codex/ts-backend-phase10-full-api-parity`.

The audit does not issue the Phase 10 gate. The endpoint matrix contains 70
missing operations and one deprecated operation. Candidate analytics, roster,
and staff-import routes still need full dual replay. The legacy `.xls` preview
path also needs an approved disposition.

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
- Added the complete route matrix in
  `phase10-endpoint-matrix.md`.

## Inventory

- FastAPI: 327 operations across 282 OpenAPI paths.
- Elysia: 256 candidate operations and one Elysia-only `/ready` route.
- Unresolved route operations: 71.
- Unknown operations: 0.
- FastAPI aliases are included in the comparison.

## Replay and mismatch evidence

- Existing full Phase 0 replay: 40/40 `EXACT_MATCH`.
- Existing deliberate mismatch replay: 40/40 `MIGRATION_DEFECT`.
- Phase 10-specific replay for unresolved families: not run because those
  Elysia routes do not exist yet.

## Blocking defects

The unresolved families include active frontend consumers:

- analytics dashboard detail and management routes;
- attendance follow-ups;
- data portability;
- report builder;
- roster and student update workflows;
- teacher assignments, student exports, roster, and staff-import candidates remain candidate-only until dual replay;
- upload history and conflict resolution;
- destructive clear-data control.

These routes need implementation and FastAPI-versus-Elysia replay. The full
matrix lists each family, route count, classification, and next action.

Legacy `.xls` remains an explicit FastAPI compatibility blocker. FastAPI and
the frontend still accept `.xls`. Elysia currently supports the Phase 0
`.xlsx` corpus only. The repository contains no approved deprecation record.

## Safety and scope

- Protected database access: 0.
- FastAPI remains available.
- Frontend global cutover: no.
- Phase 11 started: no.
- Phase 7, Phase 8, and Phase 9 merged-main prerequisites remain accepted.

Next safe action: complete dual replay for the existing candidate routes, then
close the smallest remaining FastAPI family.
