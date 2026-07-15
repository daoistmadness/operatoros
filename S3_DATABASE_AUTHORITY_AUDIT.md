# S3 Database Authority Audit

Date: 2026-07-15  
Method: read-only SQLite URI connections; no database mutation occurred.

## Authority conclusion

`backend/.local-dev/astryx-development.db` is the OperatorOS WSL development runtime database because `start-dev.sh` explicitly exports that path when no external database configuration is supplied. It is the only candidate with `users` and `sessions`, and therefore the only candidate capable of the required authenticated S3 API workflow.

`backend/attendance.db` is a reference/legacy environment database. It contains a strict attendance-data superset and prior mapping work, but it is not the configured authenticated runtime.

The databases have different operational and identity-migration histories. S3 linking must remain paused until the reference-only import and mapping state are reconciled through controlled application workflows.

## Database inventory

| Property | Runtime database A | Reference database B |
|---|---|---|
| Path | `backend/.local-dev/astryx-development.db` | `backend/attendance.db` |
| Size | 1,581,056 bytes | 1,691,648 bytes |
| Modified | 2026-07-15 22:34:49 +07:00 | 2026-07-15 16:50:55 +07:00 |
| Configured by `start-dev.sh` | yes | no |
| `users` / `sessions` | present / present | absent / absent |
| Authenticated API capable | yes | no |
| Students | 107 | 117 |
| Attendance | 3,409 | 3,651 |
| Attendance range | 2026-04-01 through 2026-06-12 | 2026-04-01 through 2026-06-12 |
| Distinct attendance dates | 48 | 50 |
| Student masters / device links / enrollments | 0 / 0 / 0 | 0 / 0 / 0 |
| Academic year | `2025/2026`, 2025-07-01–2026-06-30, active/default | identical |
| SQLite `user_version` / `application_id` | 0 / 0 | 0 / 0 |
| Journal mode | WAL | WAL |
| `PRAGMA integrity_check` | `ok` | `ok` |
| `PRAGMA foreign_key_check` | no rows | no rows |

Neither database maintains a migration-version ledger. Migration state was therefore checked structurally. Both contain the S3 student-master, preview, enrollment, and append-only-history tables/triggers. Database A additionally contains the identity tables. Database B contains one saved legacy-link preview and one saved enrollment preview from the earlier reference-database review.

## Schema inventory

Shared domain tables include attendance, legacy students, academic configuration, jenjang masters/configuration, uploads, reports, backups, student masters/profiles, device identities, import staging, enrollment population previews, enrollments/grades, and all three protected history domains.

Runtime-only identity tables:

- `users`
- `sessions`

All expected UPDATE/DELETE append-only triggers exist in both databases for:

- `attendance_override_history`
- `student_master_change_history`
- `student_enrollment_class_history`

## Student comparison

| Category | Count |
|---|---:|
| Present in both by identical legacy ID | 107 |
| Only runtime DB | 0 |
| Only reference DB | 10 |
| Same normalized name with different ID | 0 |
| Possible normalized-name duplicate | 0 |
| Needs controlled reconciliation review | 10 |

All 107 shared IDs have identical names. No reference-only name has a normalized-name candidate in runtime. Therefore the extra ten records are not conflicting duplicates; they are the ten students introduced by the second reference-only upload. They must still be imported through the validator rather than copied directly.

There is a second metadata difference: 29 shared students have `Primary` plus `P1A`/`P1B` assignments in database B while the same fields are blank in database A. Names and IDs for those rows are otherwise identical. This is prior mapping work, not attendance-import content, and must be reviewed/reapplied through the mapping workflow.

