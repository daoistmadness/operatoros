# Term 4 Attendance Import Preview Report

## Source and authority

- Workbook: `/mnt/c/Users/OPREDEL/Downloads/absen smp term 4.xls`
- SHA-256: `cecf40ab1a98bf18b060595d2c68789e39ffb7a7a5a37b89a9145e4a4d6a8963`
- Runtime database: `backend/.local-dev/astryx-development.db`
- Preview endpoint: `POST /api/uploads/preview`
- Authenticated role: existing active administrator
- Preview batch: `7c58fa0f-6406-458b-95f5-3fb17be2d0b9`
- Batch state: `preview`
- Commit timestamp: none

## Result

| Measure | Result |
|---|---:|
| Physical workbook rows | 243 |
| Logical student/date rows | 242 |
| New attendance rows | 242 |
| Difference rows | 0 |
| Unchanged rows | 0 |
| Conflicts | 0 |
| Invalid rows | 0 |
| New student identities | 10 |
| Duplicate warnings | 1 |

The one warning is an identical duplicate student/date key collapsed to one logical row. This preview exactly matches the reference import event's `+10 students / +242 attendance` key-set expectation.

The reference database still contains repaired/enriched attendance values not fully supplied by this source workbook. In particular, the source-driven proposal includes many incomplete records because checkout scans are blank. Therefore this result establishes provenance and key coverage; it does not establish that a commit would reproduce every repaired value in the reference database.

## Non-mutation proof

Before preview, the runtime database contained 107 students and 3,409 attendance rows. After the authenticated preview it still contained 107 students and 3,409 attendance rows. The operation created 242 staging rows only. The batch has no `committed_at` value and no upload-history commit record was created.

A pre-preview database backup was created at `backend/.local-dev/backups/astryx-development-pre-attendance-preview-20260715.db` with SHA-256 `0d1bfa30540c9f2e896f75cb1ba736c501c94c3ea82337f0d4501dc225a7007c`.

## Decision

Stop condition reached. Do not call the commit endpoint and do not begin S3 linking until an administrator reviews the incomplete source rows and explicitly approves the selected attendance changes.

