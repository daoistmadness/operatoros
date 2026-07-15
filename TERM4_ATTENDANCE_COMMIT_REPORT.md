# Term 4 Attendance Commit Report

## Approved source and preview

- Runtime database: `backend/.local-dev/astryx-development.db`
- Source workbook: `/mnt/c/Users/OPREDEL/Downloads/absen smp term 4.xls`
- Workbook SHA-256: `cecf40ab1a98bf18b060595d2c68789e39ffb7a7a5a37b89a9145e4a4d6a8963`
- Preview batch: `7c58fa0f-6406-458b-95f5-3fb17be2d0b9`
- Preview before commit: `preview`, 242 logical rows, 242 `NEW`, zero conflicts, zero invalid rows
- Duplicate review: one identical student/date source row; it was already collapsed to one logical staging row and required no correction

The source checksum, staging row count, classifications, and duplicate warning were reloaded and checked immediately before commit. No stale snapshot was detected.

## Backup evidence

- Path: `backend/.local-dev/backups/astryx-development-pre-term4-commit-20260715-231417-+0700.db`
- Timestamp: 2026-07-15 23:14:17 UTC+07:00
- SHA-256: `5852ce1e9603d5e17bba06d142ec380361e6814b346489dc128dd826c1dfa355`
- SQLite integrity check: `ok`
- Foreign-key violations: 0

The backup was produced through the SQLite backup API while the source database was open, then reopened independently for checksum and integrity verification. The workflow would have stopped if either verification failed.

## Guarded commit

The import was executed only through:

`POST /api/uploads/preview/7c58fa0f-6406-458b-95f5-3fb17be2d0b9/commit`

The request used the authenticated administrator session, all 242 approved staging row IDs, and the required `COMMIT_ATTENDANCE_IMPORT` confirmation.

| Measure | Before | Commit result | After |
|---|---:|---:|---:|
| Students | 107 | +10 | 117 |
| Attendance | 3,409 | +242 | 3,651 |
| Updated attendance | — | 0 | — |
| Unchanged selected rows | — | 0 | — |

Batch state is `committed`; `committed_at` is `2026-07-15 23:14:19.943476`. One successful upload-history row was created for the workbook.

## Integrity verification

- Duplicate `(student_id, date)` keys: 0
- Orphan attendance rows: 0
- SQLite integrity check: `ok`
- Foreign-key violations: 0
- Original 3,409 attendance payload fingerprint: unchanged
- Original attendance ID/student/date fingerprint: unchanged
- Attendance override fingerprint: unchanged
- New scanner identifiers preserved as student primary identifiers: yes
- Demographic fields inferred for the 10 new students: no

No direct SQLite insert, database merge, manual row copy, or attendance foreign-key rewrite was performed.

