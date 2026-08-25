# Phase 8 report and analytics migration

Status: local acceptance ready. PR and CI remain required.

Base: `7c60894d664363659d3d3332b780e361edcb8458`

Branch: `codex/ts-backend-phase8-reports-analytics`

## Gate scope

This phase covers the report and analytics families named by the Phase 8
prompt:

- HEB and manual HEB overrides.
- Tardiness reports and tardiness summaries.
- Attendance rekap v2 and workbook export.
- Monthly, management-monthly, and annual reports.
- Report filters.
- XLSX report exports.
- Semantic PDF report exports.
- Decimal half-up percentages and report half-even rounding.
- Data-quality flags and report warnings.

The Phase 8 gate does not close the full API inventory. Phase 10 must resolve
the remaining dashboard, report-builder, student-export, and legacy `.xls`
surfaces.

## Implemented routes

| Family | Elysia routes |
| --- | --- |
| Reports | `/api/reports/filters`, `/monthly`, `/management/monthly`, `/annual` |
| Report exports | `/api/reports/monthly/export`, `/management/monthly/export`, `/annual/export` |
| HEB | `/api/analytics/heb` and `/analytics/heb` |
| Tardiness | report, both summary aliases, and both XLSX exports under `/api/analytics` and `/analytics` |
| Rekap | v2 and legacy paths, plus both XLSX exports under `/api/analytics` and `/analytics` |
| Existing analytics | jenjangs, monthly, summary, date range, incomplete summary, leaderboard, offenders, pending categorization |

## Evidence

- Report HTTP replay: 5/5 `EXACT_MATCH`.
- Service corpus values: monthly, empty monthly, management, annual,
  tardiness, and v2 rekap match the Phase 0 corpus.
- TypeScript report tests: 4 passing tests with role coverage.
- Full TypeScript suite: 47/47 tests passed with 253 expectations.
- Python reference report suite: 79 passed.
- Deliberate mismatch suite: 40/40 `MIGRATION_DEFECT`.
- Export tests prove XLSX and PDF output without attendance mutation.
- Protected database access: 0.

## Explicit later disposition

The following FastAPI families remain outside this Phase 8 gate and must not
remain unknown in the Phase 10 matrix:

- Dashboard detail routes such as attendance reports, late-by-class,
  late-by-jenjang, late-by-student, attendance-rate, historical trends, and
  intervention impact.
- Report-builder sections, templates, branding, previews, and exports.
- Student export preview and download.
- Legacy `.xls` compatibility.

FastAPI remains available. The frontend has not cut over. Phase 9 and Phase 10
have not started in this worktree.
