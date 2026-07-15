# S3 Pre-Migration Baseline

Captured: 2026-07-15T16:50:18+07:00  
Database: `backend/attendance.db`

## Preconditions

- S2 commits present: `9e59548`, `64be86a`, `34f90e3`.
- Most recent full backend suite immediately before S3: 314 passed.
- SQLite `PRAGMA integrity_check`: `ok`.
- SQLite `PRAGMA foreign_key_check`: no rows.
- No pending destructive migration was identified. S3 migrations contain only additive tables, nullable columns, indexes, and triggers.

## Counts

| Measure | Count |
|---|---:|
| Legacy students | 117 |
| Student masters | 0 |
| Active device identities | 0 |
| Student enrollments | 0 |
| Student subject grades | 0 |
| Attendance rows | 3,651 |
| Orphan attendance references | 0 |

## Master-data readiness

- Default academic year: `2025/2026` (`id=1`, 2025-07-01 through 2026-06-30).
- Canonical jenjangs: `Primary` (`id=1`).
- Legacy jenjang distribution: `Primary=29`, missing=88.
- Legacy class distribution: `P1A=16`, `P1B=13`, missing=88.
- Every non-null legacy jenjang maps exactly to the guarded canonical `Primary` master. Missing values are not inferred.

## Audit trigger inventory

- `trg_attendance_override_history_no_update`
- `trg_attendance_override_history_no_delete`
- `trg_student_master_change_history_no_update`
- `trg_student_master_change_history_no_delete`

## Backup and migration identity

- Backup: `backups/backup_20260715_163647.sqlite.gz`
- Backup SHA-256: `681a7a2af7b8569bdd8d9670e319a1766e84577c9ababbd9b86f6ab001686424`
- S2 PostgreSQL migration: `cdaf6aae492365b7d4a8985abdbb88c0191716c4c6f0f2e22f8ab39f577700a2`
- S2 SQLite migration: `276415ece8337d7fd3acef42e0d22d7d36c7cf874ccce9ad88328f215b89e8c1`

