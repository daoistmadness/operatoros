# S2 Live Data Integrity Report

Date: 2026-07-15  
Database inspected: `backend/attendance.db` (SQLite)

## Pre/post startup migration counts

| Measure | Before S2 startup | After S2 startup | Delta |
|---|---:|---:|---:|
| Legacy students | 117 | 117 | 0 |
| Attendance rows | 3,651 | 3,651 | 0 |
| Student enrollments | 0 | 0 | 0 |
| Student subject grades | 0 | 0 | 0 |
| Student masters | table absent | 0 | additive table |
| Attendance rows without a legacy student | 0 | 0 | 0 |

The earlier S1 snapshot recorded 107 students and 3,409 attendance rows. At the start of this S2 execution the live file already contained 117 students and 3,651 attendance rows. S2 did not create that difference: the before/after counts above were captured in the same migration verification run and remained identical.

## Structural checks

- `student_enrollments.student_master_id` exists after startup and is nullable.
- `attendance.student_id` was not modified or rewritten.
- No legacy attendance orphan exists after migration.
- `student_masters` starts empty; no unreviewed backfill was performed.
- Canonical `trg_attendance_override_history_no_update` and `trg_attendance_override_history_no_delete` triggers exist after startup.
- Canonical UPDATE/DELETE triggers also exist for `student_master_change_history` (four S2 append-only triggers total).
- Focused transaction tests prove history INSERT succeeds and UPDATE/DELETE fail.
- All new identity and profile foreign keys use `ON DELETE RESTRICT`; no cascade to a master student or legacy attendance identity was introduced.
- `PRAGMA integrity_check` returned `ok`.
- `PRAGMA foreign_key_check` returned no rows.

## Recovery and migration identity

A safe online SQLite backup was created after the verified schema-only run at `backups/backup_20260715_163647.sqlite.gz`. No pre-run backup payload was present in the project backup directory, so this report does not claim that one existed before execution.

Migration checksums:

- PostgreSQL: `cdaf6aae492365b7d4a8985abdbb88c0191716c4c6f0f2e22f8ab39f577700a2`
- SQLite: `276415ece8337d7fd3acef42e0d22d7d36c7cf874ccce9ad88328f215b89e8c1`

The current runtime does not yet maintain a migration-version ledger for feature SQL. The files and checksums above are the S2 version record; startup uses inspected, idempotent compatibility logic. A centralized migration ledger remains a release-hardening item rather than being introduced implicitly in this feature phase.

## Data mutation statement

The S2 startup run changed schema only. It created additive empty tables/indexes/triggers and the nullable enrollment bridge column. It did not insert, update, remap, or delete student or attendance business rows.
