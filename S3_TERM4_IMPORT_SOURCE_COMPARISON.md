# S3 Term 4 Import Source Comparison

Date: 2026-07-15  
Source SHA-256: `cecf40ab1a98bf18b060595d2c68789e39ffb7a7a5a37b89a9145e4a4d6a8963`

## Identity and logical-key comparison

The recovered workbook explains the reference-only identity and attendance-key set exactly:

| Comparison | Result |
|---|---:|
| Workbook physical rows | 243 |
| Workbook unique student/date rows | 242 |
| Reference-only attendance rows | 242 |
| Workbook student identities | 10 |
| Reference-only student identities | 10 |
| Workbook keys absent from reference additions | 0 |
| Reference addition keys absent from workbook | 0 |
| Workbook identities absent from reference additions | 0 |
| Reference identities absent from workbook | 0 |

Names and legacy IDs match the ten reference-only students exactly. Raw names and scanner identifiers are intentionally not reproduced in this repository report.

## Payload comparison

The reference database is not a byte-for-byte/current-parser rendering of the recovered workbook:

- 151 workbook rows have a blank `Scan Pulang`; all 151 have a populated check-out in the reference database.
- The reference database contains 155 check-outs at `15:03`, demonstrating a later default/repair operation.
- 22 workbook rows do not match the reference check-in value, primarily where a scan side was missing and subsequently repaired.
- Every non-null workbook check-out matches its corresponding reference value.
- The current parser would classify the 242 logical workbook rows as approximately 173 incomplete, 68 on-time, and 1 late before review/repair.
- The historical reference upload log records 4 late entries, while the current reference rows are 238 on-time and 4 late.

Therefore the workbook proves provenance for the ten identities and 242 logical attendance dates, but the reference database also contains a historical repair/normalization step not represented in the workbook and not reproduced by the current parser alone.

## Class and jenjang comparison

The workbook has no class or jenjang columns. All ten workbook-only students have blank legacy class/jenjang values in the reference database. The 29 `Primary`/`P1A`/`P1B` differences identified earlier belong to shared students and were separate mapping actions; they are not explained by this attendance workbook.

## Duplicate behavior

One physical row duplicates an existing `(No. ID, Tanggal)` key with the same scan content. Current chunk normalization records one intra-chunk conflict and retains one logical row, yielding the expected 242 records. This part of current behavior matches the reference import count.

## Preview assessment

An authenticated non-mutating preview was not generated because no such route exists. Calling `POST /api/uploads/upload` would commit directly, violating the explicit stop-before-commit requirement.

Even if executed against a disposable database, the current parser result would not match the expected historical status/check-out payload without a separately reviewed repair policy. It is therefore unsafe to characterize the workbook as ready for live import solely from the 242/10 count match.

## Required resolution

Before live import, engineering approval is required for one of these paths:

1. implement and review a true authenticated attendance-import preview/dry-run contract that reports proposed inserts, new students, duplicates, incomplete rows, and payload differences without committing; then explicitly review how incomplete scans should be resolved; or
2. recover the exact converted artifact plus documented repair procedure used for the reference import and prove deterministic parity in an isolated environment.

Direct database copying or merging is not an acceptable substitute. Until this is resolved, the runtime remains at 107 students/3,409 attendance rows and S3 linking must not execute.

