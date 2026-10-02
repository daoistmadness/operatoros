# Employee management

The employee area reuses the existing `staff_members` directory. It is
separate from login accounts: importing or creating a staff profile never
creates an OperatorOS user. It owns employee master data, import history,
position mappings, status history, aggregate analytics, and exports. It does
not own payroll, leave, contracts, certification, recruitment, or performance
records.

## Source workbook and mapping

The importer accepts `.xlsx` files containing the `Data Karyawan Edelweiss`
sheet and the 16 recognized source columns. Header case, spacing, and
punctuation are normalized. Unsupported, duplicate, or missing headers fail
preview. The detected mapping is shown before commit.

| Workbook column | Canonical field | Import handling |
| --- | --- | --- |
| `Id Staff` | `source_staff_id` | Text source key, not the database primary key |
| `STATUS` | `employment_status` | `AKTIF` → `ACTIVE`; `KELUAR` → existing `FORMER` state; raw value remains in staged evidence |
| `Nama` | `full_name` | Required; whitespace trimmed |
| `NIP` | NIP identifier | Text; 8 or 18 digits; numeric source cells and placeholder `0` rejected |
| `NUPTK` | NUPTK identifier | Optional text; 16 digits when present |
| `DAPODIK` | raw and normalized DAPODIK status | `AKTIF`, `BELUM`, and `SUDAH` map to distinct values. Other values such as `TIDAK` remain visible as unmapped source values. |
| `Tempat Lahir` | `birth_place` | Optional sensitive field |
| `Tanggal Lahir` | `birth_date` | Optional ISO date; future and invalid dates rejected |
| `Umur` | ignored | Never persisted; age is calculated from birth date |
| `Jabatan` | raw position title | Preserved; normalized only through an approved mapping |
| `Mulai Kerja` | `employment_start_date` | Optional ISO date |
| `Masa Kerja` | ignored | Never persisted; tenure is derived from start/end dates |
| `NIK` | NIK identifier | Optional text; 16 digits when present |
| `Alamat` | address | Optional sensitive field |
| `Email` | email | Optional, trimmed and lowercased; format validated |
| `No Hp` | phone | Optional text; numeric spreadsheet cells are rejected |

The API uses the existing Excel package to parse XLSX dates and Excel serials.
Identifiers are stored as strings. Numeric identifier or phone cells are
rejected because spreadsheet numeric conversion can destroy leading zeroes or
precision. Blank values become null. No age, tenure, termination date,
organizational unit, teacher certification, or job-title category is inferred.

## Preview, matching, and merge

Preview writes only staging rows and issues. It does not change employee
profiles. It reports duplicates within the workbook, duplicates already in
the directory, unsupported status/DAPODIK values, invalid fields, possible
name-and-birth-date matches, and conflicting identity matches. Names are only
a weak review hint and never cause a match.

Matching priority is source staff ID, valid NIP, then valid NIK. Multiple
candidate matches are conflicts. Email and NUPTK are duplicate warnings, not
merge keys. A `KELUAR` row does not establish why or when the employee left;
the existing directory's `FORMER` state is used without fabricating an end
date.

On commit, accepted rows are applied in one SQLite transaction. Re-importing
the same workbook matches the existing employees and produces unchanged rows.
Incoming blank values never clear saved data. Nonblank contact, name, and
position changes can update a record matched by a strong identifier. Different
NIP, NIK, NUPTK, status, birth date, or start date is a conflict and requires
manual review. A stale profile is rejected and must be previewed again.
Position labels remain source text until an administrator approves a mapping.

Staged source and normalized row payloads may contain sensitive values. They
are removed after commit and expire at 29 days; a six-hour API lifecycle sweep
keeps maximum retention below 30 days, with startup and import preview/commit
cleanup as defense in depth. Batch totals,
issue codes, row numbers, and provenance remain available without raw row data.

## History and positions

`staff_employment_history` records manual status changes, imported status
observations, and position changes with source, actor, optional effective
date, and import batch. The workbook does not supply reliable historical exit
dates. An imported inactive state therefore has no invented effective date;
analytics only treats it as observed from the import date onward. Existing
jenjang assignments remain a separate school-stage association and are not
used as organizational units.

`staff_job_title_mappings` preserves each raw title and supports an approved
normalized title, category, and teaching-role flag. Only approved metadata is
used to classify teaching staff. There is no title substring heuristic.
Organizational-unit assignments and teacher certification are unavailable
because the accepted source has no authoritative fields for them.

## Metrics

All metrics are computed by the API for a selected reporting date. Age is the
calendar age from birth date. Tenure uses start date through the reporting date
for active staff and stops at the recorded end date for former staff; former
staff without an end date have unknown tenure. Unknown birth/start dates remain
in the `Unknown` band and reduce coverage.

NUPTK coverage is employees with a nonblank NUPTK divided by all employees.
DAPODIK coverage counts only the three explicitly mapped source statuses;
unmapped values and blanks remain separate. Position totals use raw source
titles; teaching/non-teaching totals include only employees whose approved
mapping sets `is_teaching_role`. Overall completeness is the unweighted
present-value count divided by `employee_count × 8` for NIP, NIK, NUPTK,
DAPODIK, birth date, employment start date, email, and phone. It is null when
there are no employees. Duplicate identity count is the number of duplicated
NIP/NIK/NUPTK value groups, not the number of affected employees.

Current former headcount is not called turnover. Historical exits are
available only where an explicit status history effective date was recorded.
Analytics responses contain aggregates and do not include names, IDs, or
contact data.

## Permissions, audit, and export

Employee API routes enforce capabilities on the server. Employee management,
import, analytics, audit history, and standard exports are administrator-only
by default; ordinary staff receive none of these employee capabilities.
Sensitive profile fields require `view_staff_sensitive`; editing them requires
`edit_sensitive_staff_fields`. Standard XLSX export excludes NIK, birth
details, email, phone, and address. Including those columns requires
`export_sensitive_staff_fields` in addition to `export_staff`.

Creation, edits, status changes, import preview/commit, sensitive profile
reads, and exports are audited with actor, capability, affected fields, and
aggregate metadata. Raw identifiers and addresses are not copied into audit
metadata. Export uses `@operatoros/excel`, marks the filter scope, and refuses
selections above 10,000 rows instead of truncating them.

The source workbook was not present in this checkout during implementation.
The importer has been checked with synthetic XLSX data only; do not use real
employee values in repository fixtures, snapshots, logs, or documentation.
