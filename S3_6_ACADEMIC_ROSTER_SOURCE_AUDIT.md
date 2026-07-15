# S3.6 Academic Roster Source Audit

## Candidate reviewed

| Evidence | Value |
|---|---|
| Filename | `Data Siswa TA 2025_2026.xlsx` |
| Path | `/mnt/c/Users/OPREDEL/Downloads/Data Siswa TA 2025_2026.xlsx` |
| SHA-256 | `cb97e85d94263605c44c81b97af7e1e3258ba0e5fff6d1a000a8ed0c35771520` |
| Size | 192,558 bytes |
| Filesystem modified | 2026-04-29 01:16:15 UTC+07:00 |
| Workbook created | 2026-04-28 08:24:40Z |
| Workbook modified | 2026-04-28 15:53:37Z |
| Embedded creator | `Unknown Creator` |
| Owner/custodian | Not established |
| Date received | Not established |
| Academic year evidence | Filename only (`2025_2026`) |
| Student rows | 250 |

The workbook contains 20 class-named sheets: K1A–K1D, K2A–K2D, KD1/KD2A–KD2C, P1A/P1B, P2–P6, and S1. Available fields include NIS, NISN, name, class, NIK, Program, birth date, and extensive contact/demographic data.

It does not contain required per-row `academic_year` or `status`. Its fields use a different schema (`NIS`, `Nama`, `Kelas`, `Program`) and its owner is unverified.

## Coverage against OperatorOS

- Runtime masters: 117
- Masters with stored NIPD/NISN/NIK/birth date: 0
- Unique normalized-name-only candidates in roster: 78
- Runtime masters absent by normalized name: 39
- Ambiguous duplicate-name candidates: 0

The 78 name candidates cannot be accepted because name alone is outside the approved matching contract. The 39 missing candidates have no roster row. Of the 78 name-only candidates, 70 have blank Program and eight say Secondary. Program and sheet/class names cannot be used to infer canonical jenjang.

## Endpoint validation

Authenticated `POST /api/student-enrollments/roster-preview` rejected the candidate with HTTP 400 for missing canonical required columns. Before and after rejection:

- academic roster preview batches: 0 → 0
- student enrollments: 0 → 0

## Authority decision

This file is a useful candidate roster but is not validated as the official S3.6 source. Owner, date received, per-row academic year/status, secure identity linkage, and complete 117-student coverage are missing. The stop conditions apply; no conversion, preview batch, or enrollment commit is authorized.

