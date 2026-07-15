# S3 Linking Post-Term 4 Report

## Fresh preview

The legacy-link preview was regenerated after the attendance import; no previous 107- or 117-student assumption was reused.

- Endpoint: `POST /api/student-masters/legacy-link/preview`
- Preview ID: `16c480b9-d581-426c-89a0-44867b2acb20`
- Snapshot SHA-256: `5ade5d5184452ba3f2764e1005a7dc2439967c3f26aad74337fbd8bcb531277f`

| Classification | Count |
|---|---:|
| Total legacy students | 117 |
| Safe auto-create | 117 |
| Safe auto-link | 0 |
| Review required | 0 |
| Conflicts | 0 |
| Invalid | 0 |

The result was deterministic: every row was safe, and no name-only, duplicate-name, invalid, or conflicting mapping required manual resolution.

## Linking commit

All 117 reviewed safe rows were committed through `POST /api/student-masters/legacy-link/commit` using the required `LINK_LEGACY_STUDENTS_TO_MASTERS` confirmation.

- Canonical student masters created: 117
- Active device mappings created: 117
- Existing mappings skipped: 0
- Legacy-link history records present: 117
- Legacy students with exactly one active canonical mapping: 117 of 117

## New attendance students

The ten Term 4 identities were created only by the guarded attendance commit. Their scanner IDs remain intact, and the linking commit mapped those legacy identities without changing any `attendance.student_id` value. No class, jenjang, or demographic values were inferred during attendance import or canonical linking. Canonical masters remain `pending_review`, consistent with the linking contract.

Post-link database checks continued to report SQLite integrity `ok`, zero foreign-key violations, and unchanged attendance overrides.

