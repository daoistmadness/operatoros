# S3 Source Workbook Recovery Report

Date: 2026-07-15  
Execution mode: read-only discovery and validation; no import or database mutation.

## Recovery result

The original source workbook was found:

| Property | Value |
|---|---|
| Path | `/mnt/c/Users/OPREDEL/Downloads/absen smp term 4.xls` |
| Filename | `absen smp term 4.xls` |
| Size | 41,010 bytes |
| Modified | 2026-06-25 22:57:46 +07:00 |
| SHA-256 | `cecf40ab1a98bf18b060595d2c68789e39ffb7a7a5a37b89a9145e4a4d6a8963` |
| Format | Legacy binary XLS/BIFF readable by `xlrd` |

The reference upload log records `absen smp term 4.xls.xlsx`. The additional `.xlsx` suffix is consistent with a converted/upload-processing artifact; the recovered original is the pre-conversion `.xls` source.

## Search coverage

Read-only filename searches covered:

- repository and parent OperatorOS project directories;
- WSL home, downloads, documents, projects, and backup locations;
- Windows Downloads, Documents, Desktop, OneDrive, and temporary locations;
- project/user ZIP, JAR, 7z, TAR, TGZ, and TAR.GZ archive entry names.

No second exact-name source or converted `absen smp term 4.xls.xlsx` artifact was found in those locations.

## Workbook inspection

| Property | Result |
|---|---|
| Sheets | 1 |
| Sheet name | `Sheet 1` |
| Physical data rows | 243 |
| Unique `(No. ID, Tanggal)` rows | 242 |
| Distinct student identities | 10 |
| Date range | 2026-04-01 through 2026-06-12 |
| Blank student IDs | 0 |
| Blank names | 0 |
| Duplicate logical keys | 1 duplicated source row |

Required headers are present exactly:

- `No. ID`
- `Nama`
- `Tanggal`
- `Scan Masuk`
- `Scan Pulang`
- `Terlambat`
- `Absent`
- `Lembur`
- `Pengecualian`
- `week`

The duplicate is an identical student/date scan row. The current parser's deterministic intra-chunk conflict handling reduces the 243 physical rows to 242 logical records.

## Import preparation status

The workbook is recovered and suitable for controlled parser investigation, but it is **not yet approved for live import**.

Two blockers prevent an authenticated preview:

1. The current authenticated endpoint `POST /api/uploads/upload` performs parse/upsert commits immediately. There is no attendance-import preview endpoint or dry-run mode to stop before commit.
2. Current parser output does not reproduce the historical reference payload/status result. Details are recorded in `S3_TERM4_IMPORT_SOURCE_COMPARISON.md`.

The configured runtime administrator is `mikhail`; no credential or session secret was accessed or recorded. No upload timestamp, batch ID, or preview result exists because invoking the only upload endpoint would mutate the authoritative runtime database.

## Stop decision

No file was modified, converted, copied, or uploaded. No SQLite database was changed. S3 linking remains stopped pending an approved non-mutating preview mechanism and resolution of the historical post-import repair differences.

