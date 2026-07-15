# S3 Live Data Integrity Report

Date: 2026-07-15  
Execution scope: additive schema startup plus saved previews only; no linking/enrollment commit.

| Measure | Baseline | After schema and previews | Delta |
|---|---:|---:|---:|
| Legacy students | 117 | 117 | 0 |
| Student masters | 0 | 0 | 0 |
| Device identities | 0 | 0 | 0 |
| Student enrollments | 0 | 0 | 0 |
| Student subject grades | 0 | 0 | 0 |
| Attendance | 3,651 | 3,651 | 0 |
| Orphan attendance references | 0 | 0 | 0 |

Preview evidence tables each contain one row. They are workflow evidence and do not alter business identity or academic records.

## Integrity results

- `PRAGMA integrity_check`: `ok`.
- `PRAGMA foreign_key_check`: no rows.
- Duplicate active device identities: 0.
- Duplicate canonical enrollment/year pairs: 0.
- Enrollment/master mismatches: 0 (no enrollment rows).
- Attendance foreign keys and legacy student IDs were not rewritten.
- Legacy jenjang and class fields were not changed.
- Six append-only triggers are installed: UPDATE/DELETE protection for attendance override history, student master change history, and enrollment class history.

## S3 migration checksums

- PostgreSQL: `a050747c70c092813a19440384e93bf8ccc879b91f8a95f67aa144b495bd57b4`
- SQLite: `76c86b44d71dae13288aa0b0437d27dc55ed00f4d10f53ad824e99e30e799dc7`

## Live execution hold

All 117 link rows are safe to auto-create, but the live commit was not authorized explicitly. No confirmation token was submitted and no safe row was committed. A fresh preview must be reviewed immediately before any later commit, followed by the full post-migration integrity sequence.

Post-schema/preview recovery backup: `backups/backup_20260715_165750.sqlite.gz`  
SHA-256: `680aee0c48ea545336c18fd8fd16256da781da4852a9c75b8e634da47bd5d779`
