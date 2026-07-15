# Attendance Import Preview Implementation Report

## Delivered

- Added persistent batch and row staging models.
- Added additive SQLite and PostgreSQL migrations with restrictive foreign keys and classification/state checks.
- Added administrator-only `POST /api/uploads/preview`.
- Added administrator-only `POST /api/uploads/preview/{batch_id}/commit` with selected-row input and exact confirmation token.
- Added before/after snapshots, five-way classification, exact/divergent duplicate handling, identity conflict protection, and override warnings.
- Added stale-preview detection, atomic rollback, idempotent commit results, and upload-history creation on successful commit only.
- Imported the staging models during runtime database initialization.
- Previewed the recovered Term 4 workbook through the authenticated API and stopped before commit.

## Verification coverage

Automated tests cover:

1. preview does not mutate students, attendance, or upload history;
2. identical duplicate collapse and warning;
3. invalid rows remain visible in staging;
4. unchanged, difference, and identity-conflict classification;
5. unauthenticated and staff preview rejection;
6. exact confirmation token enforcement;
7. conflict rejection before mutation;
8. atomic rollback after stale-snapshot detection;
9. idempotent successful commit and one upload-history row;
10. administrative override preservation.

The authenticated Term 4 preview returned HTTP 200 and created batch `7c58fa0f-6406-458b-95f5-3fb17be2d0b9`. Live student/attendance counts were identical before and after.

## Files

- `backend/src/models/attendance_import.py`
- `backend/src/services/attendance_import_preview.py`
- `backend/src/api/uploads.py`
- `backend/src/core/database.py`
- `backend/migrations/20260718_attendance_import_preview_sqlite.sql`
- `backend/migrations/20260718_attendance_import_preview_postgresql.sql`
- `backend/tests/test_attendance_import_preview.py`

## Remaining authorization boundary

No import commit and no S3 linking execution were performed. The batch remains reviewable in `preview` state. Proceeding requires explicit administrator approval and the `COMMIT_ATTENDANCE_IMPORT` token.

