# Academic Roster Import Contract

## Source authority

An academic roster is authoritative only when its owner/custodian, receipt date, academic year, and unchanged file checksum are recorded. A filename, workbook tab, attendance pattern, scanner ID range, or student age is not sufficient evidence of academic placement.

The preview request is administrator-only multipart form data:

- `file`: `.xlsx` workbook;
- `source_owner`: named registrar or authorized academic custodian;
- `date_received`: ISO date.

Every sheet uses one header row and the canonical snake-case field names below.

## Required fields

| Domain | Field | Rule |
|---|---|---|
| Identity | `student_identifier` | Source-system identifier; must be nonblank |
| Identity | `student_name` | Display name; must be nonblank but is never sufficient alone |
| Academic | `academic_year` | Must exactly match `academic_years.label` |
| Academic | `jenjang` | Must exactly match canonical `jenjangs.name` |
| Academic | `class_name` | Must resolve through an approved S3.5 class mapping rule |
| Academic | `program` | Required source evidence; not used to infer jenjang |
| Academic | `status` | Only `active` rows are committable |

Optional fields are `student_master_id`, `nipd`, `nisn`, `nik`, `birth_date`, `homeroom_teacher`, `admission_type`, and `start_date`. If `start_date` is blank, the academic-year start date is used.

## Identity matching priority

1. Exact `student_master_id`.
2. Exact unique NIPD, NISN, or NIK already stored on `student_masters`.
3. Exact active `student_device_identities.device_identifier` supplied as `student_identifier`.
4. Unique normalized name plus exact birth date already stored on the master.

Name alone is never matched. Multiple results at any level are `AMBIGUOUS`. An unmatched identity is `NEW_STUDENT`; roster import does not create a new master implicitly.

## Classifications

- `MATCHED`: identity, year, jenjang, class mapping, status, and uniqueness all pass.
- `NEW_STUDENT`: no approved matching route resolves the identity.
- `AMBIGUOUS`: an approved matching route returns multiple candidates.
- `MISSING_JENJANG`: the source jenjang is not canonical.
- `MISSING_CLASS`: the class has no approved S3.5 mapping.
- `INVALID`: missing fields, unknown academic year, inactive status, or duplicate master/year enrollment.

Preview persists only an immutable review batch; it does not change students, masters, attendance, or enrollments.

## Commit contract

`POST /api/student-enrollments/roster-commit` requires an administrator, preview ID, explicit preview row IDs, and `COMMIT_ACADEMIC_ROSTER`.

Only `MATCHED` rows are eligible. Commit rechecks that no master/year enrollment has appeared since preview, creates `student_enrollments` and effective-dated `student_enrollment_class_history` rows in one transaction, and stores an idempotent batch result. Any stale or invalid row rolls back the entire selection.

Commit never updates attendance, student masters, legacy students, device identities, academic years, jenjang masters, or mapping rules.

