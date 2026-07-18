# S3.11B Worktree Reconciliation Report

Captured 2026-07-18 on `main` at `26c0dc7dbedf68eec8e79077504deb28e93ef2e2`.

The mixed worktree was classified before staging. The candidate commit uses explicit paths only. No workbook, database, deferred patch script, runtime state, generated browser evidence, or sensitive report is staged.

## Included files

| Classification | Exact paths |
|---|---|
| INCLUDE_CONFIGURATION | `.bun-version`; `.nvmrc`; `.gitignore`; `Makefile`; `backend/pytest.ini`; `frontend/package.json`; `frontend/package-lock.json`; `frontend/vite.config.js`; `.github/workflows/e2e-full.yml` |
| INCLUDE_RUNTIME | `start-dev.sh`; `stop-dev.sh`; `scripts/operatoros-dev-runtime.py`; `scripts/start-tauri-dev.ps1`; `scripts/stop-tauri-dev.ps1`; `backend/src/core/runtime.py` |
| INCLUDE_RUNTIME | `backend/src/core/database.py`; `backend/src/core/schema_guard.py`; `backend/src/core/schema_migrations.py`; `backend/src/main.py`; `backend/migrations/20260722_s38_final_academic_master_postgresql.sql`; `backend/migrations/20260722_s38_final_academic_master_sqlite.sql`; `backend/migrations/migration_manifest.json` |
| INCLUDE_RUNTIME | `backend/src/api/academic_masters.py`; `backend/src/api/analytics.py`; `backend/src/api/config.py`; `backend/src/api/grades.py`; `backend/src/api/review.py`; `backend/src/api/student_enrollments.py`; `backend/src/models/academic_master.py`; `backend/src/models/academic_year.py`; `backend/src/models/jenjang.py`; `backend/src/models/student_enrollment.py`; `backend/src/services/academic_master_preview.py`; `backend/src/services/academic_roster.py`; `backend/src/services/analytics_trends.py`; `backend/src/services/enrollment_population.py`; `backend/src/services/management_analytics.py`; `backend/src/services/report_service.py` |
| INCLUDE_RUNTIME | `frontend/src/App.js`; `frontend/src/api/enrollment.ts`; `frontend/src/components/ChartClass.js`; `frontend/src/components/ChartMonthly.js`; `frontend/src/components/SidebarNav.jsx`; `frontend/src/components/enrollment/EnrollmentPanel.tsx`; `frontend/src/pages/AttendanceReview.js` |
| INCLUDE_TEST | `backend/tests/conftest.py`; `backend/tests/test_dev_launcher.py`; `backend/tests/test_first_admin_provisioning.py`; `backend/tests/test_grades_api.py`; `backend/tests/test_grades_router_security.py`; `backend/tests/test_manual_students.py`; `backend/tests/test_s310d_schema_safety.py`; `backend/tests/test_s311_dev_runtime.py`; `backend/tests/test_s36_academic_roster.py`; `backend/tests/test_s37_academic_master.py`; `backend/tests/test_s38_academic_masters.py`; `backend/tests/test_s3_student_linking_enrollment.py`; `backend/tests/test_student_linking_startup_gate.py` |
| INCLUDE_E2E | `frontend/playwright.config.ts`; `e2e/README.md`; `e2e/clean.sh`; `e2e/fixtures/databases/.gitkeep`; `e2e/fixtures/expected/smoke-fixture.json`; `e2e/fixtures/uploads/.gitkeep`; `e2e/full/backend/.gitkeep`; `e2e/full/desktop/README.md`; `e2e/full/web/.gitkeep`; `e2e/helpers/create-test-workspace.py`; `e2e/helpers/seed-test-database.py`; `e2e/helpers/write-full-summary.py`; `e2e/helpers/write-summary.py`; `e2e/run-full.sh`; `e2e/run-smoke.sh`; `e2e/smoke/backend/.gitkeep`; `e2e/smoke/backend/test_smoke_scenarios.py`; `e2e/smoke/desktop/README.md`; `e2e/smoke/web/.gitkeep`; `e2e/smoke/web/critical-paths.spec.ts`; `e2e/start-test-stack.sh`; `e2e/stop-test-stack.sh` |
| INCLUDE_DOCUMENTATION | `S3_11B_WORKTREE_RECONCILIATION_REPORT.md`; `S3_11B_SOURCE_DIFF_REVIEW.md`; `S3_11B_COMMIT_REPORT.md`; `S3_11B_WINDOWS_CLONE_REPORT.md`; `S3_11B_WINDOWS_BUN_TAURI_ACCEPTANCE.md`; `S3_11B_WINDOWS_NODE_TAURI_ACCEPTANCE.md`; `S3_11B_PROCESS_CLEANUP_REPORT.md`; `S3_11B_FINAL_DEVELOPER_RUNTIME_STATUS.md` |

The academic/startup files are included because a clean candidate snapshot without them failed five launcher tests at the explicit fresh-schema boundary. Adding the reviewed, test-covered tranche produced 16/16 launcher passes and the prescribed E2E smoke pass. They are therefore reproducibility prerequisites, not incidental dirty-tree files.

## Deferred or excluded worktree entries

| Classification | Exact paths |
|---|---|
| DEFERRED_UNRELATED | `S3_5_ENROLLMENT_PREVIEW_REPORT.md`; `S3_5_LEGACY_ACADEMIC_MAPPING_AUDIT.md`; `S3_5_MAPPING_IMPLEMENTATION_REPORT.md`; `S3_6_ACADEMIC_ROSTER_SOURCE_AUDIT.md`; `S3_6_ENROLLMENT_READINESS_REPORT.md`; `S3_6_ROSTER_WORKFLOW_IMPLEMENTATION_REPORT.md`; `S3_7_ACADEMIC_MASTER_AUDIT.md`; `S3_7_MASTER_DATA_REQUIREMENTS.md`; `S3_7_ROSTER_READINESS_REPORT.md` (pre-existing approved-cleanup deletions) |
| DEFERRED_UNRELATED | `S3_ATTENDANCE_DIFF_REPORT.md`; `S3_DATABASE_AUTHORITY_AUDIT.md`; `S3_DATABASE_RECONCILIATION_PLAN.md`; `S3_ENROLLMENT_POPULATION_REPORT.md`; `S3_ENROLLMENT_PREVIEW_REPORT.md`; `S3_LEGACY_STUDENT_LINK_AUDIT.md`; `S3_LINKING_POST_TERM4_REPORT.md`; `S3_LIVE_DATA_INTEGRITY_REPORT.md`; `S3_PRE_MIGRATION_BASELINE.md`; `S3_SOURCE_WORKBOOK_RECOVERY_REPORT.md`; `S3_TERM4_IMPORT_SOURCE_COMPARISON.md` (pre-existing approved-cleanup deletions) |
| EXCLUDE_GENERATED | `backend/ci-test.db-shm`; `backend/ci-test.db-wal`; `start-dev.portless.sh.bak` (pre-existing deletions; outside this commit) |
| DEFERRED_UNRELATED | `S3_11B0_CLEANUP_DRY_RUN.md`; `S3_11B0_REPOSITORY_CLEANUP_INVENTORY.md`; `S3_11B0_REPOSITORY_CLEANUP_REPORT.md`; `S3_11B0A_CLEANUP_DRY_RUN.md`; `S3_11B0A_DISCOVERY_INVENTORY.md` |
| DEFERRED_UNRELATED | `docs/releases/S3_10_FINAL_RELEASE_STATUS.md`; `docs/releases/S3_10_MIGRATION_VALIDATION_REPORT.md`; `docs/releases/S3_10_PRODUCTION_DATA_INTEGRITY_REPORT.md`; `docs/releases/S3_10_PRODUCTION_DEPLOYMENT_REPORT.md`; `docs/releases/S3_10_PRODUCTION_SMOKE_TEST_REPORT.md`; `docs/releases/S3_10_ROLLBACK_PLAN.md`; `docs/releases/S3_10_SECURITY_SMOKE_TEST_REPORT.md` |

## Explicit preserved exclusions

The nine sensitive reports/workbooks, `fix_analytics.py`, `fix_parser.py`, `patch_analytics.py`, unknown/local-development databases, production database, and backups are unchanged and unstaged. They do not appear in `git status` because they have no new worktree modification, but their deferred status remains in force.

No file observed in the recaptured modified/untracked inventory remains unclassified.
