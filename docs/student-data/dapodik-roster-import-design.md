# Dapodik roster import design

Status: design only; no implementation is authorized by this document.

## Scope and source contract

The integration is a one-way roster import. Dapodik supplies school, student,
current registration/rombel, class, and optional PTK master data. OperatorOS
remains the sole owner of attendance events, device identities, manual
attendance overrides, and attendance audit history.

The initial transport is an operator-provided XLSX workbook. CSV can be added
later, but the current academic-roster path validates XLSX and uses
`openpyxl`/Pandas; CSV must not be claimed as supported until equivalent file,
encoding, formula-injection, row-limit, and provenance controls exist.

Every preview records the source owner, receipt date, original filename,
SHA-256 checksum, source school, Dapodik export/version metadata when present,
and whether the file is declared a complete snapshot or a partial extract.
Only a declared complete snapshot may drive missing-record reconciliation.

## Current OperatorOS model and import architecture

The relevant existing models are:

| Concept | Existing model/table | Notes |
|---|---|---|
| Canonical student | `StudentMaster` / `student_masters` | Owns NIPD, NISN, name, gender, birth data, status, and admission data. This is the Dapodik identity target. |
| Legacy attendance student | `Student` / `students` | Attendance-facing legacy identity. Do not add Dapodik identity here or create one merely because a Dapodik row exists. |
| Enrollment | `StudentEnrollment` / `student_enrollments` | One master/year placement, linked to canonical jenjang and optional academic class. Attendance history is not owned here. |
| Class | `AcademicClass` / `academic_classes` | Canonical year/grade/class master. |
| Academic year | `AcademicYear` / `academic_years` | OperatorOS year, not necessarily one-to-one with a Dapodik semester ID. |
| School | None | OperatorOS currently has no school/tenant master. |
| Teacher/personnel | None | `User` is an authentication account and must not be reused for PTK. |

Existing roster ingestion uses `AcademicRosterImportBatch`,
`StudentImportSession`, and immutable `StudentImportAppliedAction` rows. It:

1. validates an XLSX upload and a fixed header set;
2. normalizes values and creates a non-mutating preview;
3. resolves canonical academic year, jenjang, program, grade, and class;
4. classifies rows and exposes validation errors for review;
5. requires selected rows, a preview checksum, an owner-bound session, and an
   explicit confirmation token before commit;
6. commits transactionally and records compensating-action provenance.

`StudentImportBatch`/`StudentImportRow` provide a second preview system for
student-data updates, including normalized payloads, per-field differences,
validation errors, conflicts, and result workbooks. `OperationsAuditEvent`
is the Phase 6 operational audit surface. `StudentMasterChangeHistory` is the
per-field student history. `UploadLog` is attendance-import-specific and must
not be reused for Dapodik roster runs.

The current academic-roster implementation requires a numeric attendance
device identifier for a new student and creates a `StudentDeviceIdentity`.
Dapodik IDs are not attendance-machine IDs. Therefore the Dapodik adapter may
reuse the preview/session/audit infrastructure but must not feed Dapodik IDs
through `student_identifier` or create/replace/retire device mappings.

There is also a contract discrepancy to resolve before implementation: the
published roster contract says unmatched students are review-only, while the
current service has a committable `CREATE_NEW_MASTER` path. This design uses
review-first creation and does not silently create an unmatched student.

## Proposed workbook contract

Use explicit sheets so unlike entities are not inferred from column presence:

### `School`

Required: `sekolah_id`, `nama`, `npsn`.

Optional provenance only: `nss`, `bentuk_pendidikan_id`, `kode_wilayah`,
`status_sekolah`, `last_update`, `soft_delete`.

### `Classes`

Required: `rombongan_belajar_id`, `semester_id`, `sekolah_id`,
`tingkat_pendidikan_id`, `nama`, `jenis_rombel`.

Optional: `ptk_id`, `tanggal_mulai`, `tanggal_selesai`, `last_update`,
`soft_delete`, `anggota_rombel_count`.

### `Students`

Required: `peserta_didik_id`, `nama`, `sekolah_id`.

Optional: `jenis_kelamin`, `nisn`, `tempat_lahir`, `tanggal_lahir`,
`registrasi_id`, `nipd`, `tanggal_masuk_sekolah`, `jenis_keluar_id`,
`tanggal_keluar`, `anggota_rombel_id`, `rombongan_belajar_id`,
`rombel_saat_ini`, `tingkat_pendidikan_id`, `last_update`, `soft_delete`.

The export must include `rombongan_belajar_id` directly or provide a separate
unambiguous mapping from `rombel_saat_ini` to the `Classes` sheet. Display name
alone is not a safe class key.

### `Teachers` (optional and blocked pending a personnel decision)

Required: `ptk_id`, `nama`, `sekolah_id`.

Optional: `ptk_terdaftar_id`, `nip`, `jenis_kelamin`, `jabatan_ptk_id`,
`tahun_ajaran_id`, `tmt_tugas`, `tgl_ptk_keluar`, `soft_delete`.

Unknown headers are rejected or ignored with an explicit preview warning; they
are never copied wholesale into JSON. In particular, `password`, `username`,
and `pengguna_id` must cause a privacy warning and must be discarded before
preview persistence or logging.

## Proposed shadow columns

### `student_masters`

| Column | Type/nullable | Index/constraint | Purpose |
|---|---|---|---|
| `dapodik_peserta_didik_id` | `String(36)`, nullable | Partial unique index when non-null | Stable source identity and first-priority idempotent match. Prefer global uniqueness because Dapodik uses a person identity across school moves; make school-scoped only if real multi-school evidence requires it. |
| `dapodik_sekolah_id` | `String(36)`, nullable | Non-unique index | Current source-school scope until a school/source table exists. |
| `dapodik_last_update_at` | `DateTime`, nullable | None | Last accepted source timestamp for stale-export detection; never use it as the sole conflict rule. |

Reuse existing `nipd`, `nisn`, `full_name`, `gender`, `birth_place`,
`birth_date`, `student_status`, and `admission_date`. Do not add duplicate
`dapodik_nisn` or `dapodik_nipd` columns unless the owner explicitly chooses a
source-vs-canonical conflict-preservation policy. `nisn` is already partially
unique. `nipd` is currently globally unique, which is incompatible with
multi-school local numbering and is an open decision.

### `student_enrollments`

| Column | Type/nullable | Index/constraint | Purpose |
|---|---|---|---|
| `dapodik_registrasi_id` | `String(36)`, nullable | Partial unique index when non-null | School registration source identity. It belongs to the school/year placement rather than the person master. |
| `dapodik_anggota_rombel_id` | `String(36)`, nullable | Partial unique index when non-null | Source membership identity without creating a separate AnggotaRombel model. |
| `dapodik_sekolah_id` | `String(36)`, nullable | Non-unique index | Source-school scope for the placement. |
| `dapodik_semester_id` | `String(16)`, nullable | Composite lookup index with `student_master_id` | Source period evidence. It does not replace `academic_year_id`. |

The existing unique enrollment constraints remain authoritative: one legacy
student/year and one non-null student master/year. Dapodik import must not
bypass `_student_year_uc`, `uq_student_master_academic_year`, or any
`ON DELETE RESTRICT` boundary.

### `academic_classes`

| Column | Type/nullable | Index/constraint | Purpose |
|---|---|---|---|
| `dapodik_rombongan_belajar_id` | `String(36)`, nullable | Partial unique index when non-null | Stable idempotent class match. |
| `dapodik_sekolah_id` | `String(36)`, nullable | Non-unique index | School scope. |
| `dapodik_semester_id` | `String(16)`, nullable | Composite index with school and class source ID | Source-period evidence. |
| `dapodik_ptk_id` | `String(36)`, nullable | Non-unique index | Temporary homeroom-teacher reference only if PTK import is deferred. It must later become a restricted FK to an approved personnel model. |
| `dapodik_last_update_at` | `DateTime`, nullable | None | Stale-source detection. |

Class creation still requires approved `AcademicProgram` and `AcademicGrade`
resolution. Dapodik `tingkat_pendidikan_id` must map through reviewed metadata;
it must not create or mutate the read-only `jenjangs` seed set.

### School and PTK gaps

There is no safe existing table for `dapodik_sekolah_id` ownership or PTK.
For a single-school first release, repeating the school ID on linked rows is
workable but deliberately temporary. Multi-school support should instead add
an integration/source-school table and scope uniqueness through it.

Do not attach `dapodik_ptk_id` to `users`. If personnel browsing or teacher
assignment is in scope, approve a new personnel model first, tentatively
`school_personnel`, with source IDs, display identity, active dates, and
school assignment. If personnel is out of scope, ingest only `ptk_id` on the
class as source metadata and do not persist the `Teachers` sheet.

## Preview classifications and matching

Every input row is normalized, validated, and classified without mutation.
No match is made by name alone.

### Students

Matching order:

1. Exact `student_masters.dapodik_peserta_didik_id`.
2. Exact unique existing `student_masters.nisn`, when the imported NISN is
   valid and nonblank.
3. Exact `nipd` only within the same Dapodik school scope. The current global
   NIPD constraint must be resolved before multi-school use.
4. Name plus exact birth date is a suggestion for manual review, never an
   automatic link.

Outcomes:

- `MATCHED_DAPODIK_ID`: update preview against an existing linked master.
- `MATCHED_NISN_UNLINKED`: propose linking the Dapodik ID and show all field
  differences for explicit approval.
- `MATCHED_NIPD_UNLINKED`: same, but higher review risk.
- `POSSIBLE_DUPLICATE`: ambiguous identifier or name/birth-date candidate;
  never committable without a recorded resolution.
- `NEW_STUDENT`: no match. Default is manual review. An administrator may
  explicitly select “create and link” during a later approved workflow; the
  importer must never silently create it.
- `INVALID` or `PRIVACY_REJECTED`: malformed identifiers, impossible dates,
  missing school/class evidence, or prohibited fields that could not be
  safely discarded.

Updates apply only allowlisted fields. Existing nonblank canonical values are
not overwritten by blank source cells. Conflicting NISN, NIPD, name, birth
date, or gender changes are surfaced in preview and require explicit approval.

### Classes and enrollment

Match a class first by `dapodik_rombongan_belajar_id`. For an unlinked class,
fallback matching may propose exactly one approved class with the same mapped
academic year, grade, and normalized class name. Ambiguous or missing mappings
are `MISSING_CLASS`/`POSSIBLE_CLASS_MATCH`, not automatic creations.

After student and class resolution, match enrollment by
`dapodik_anggota_rombel_id`, then by the existing student-master/year unique
key. A different class in the same year is a proposed effective-dated transfer
and must append `StudentEnrollmentClassHistory`; it is not a second enrollment.

Map `tanggal_masuk_sekolah` or class `tanggal_mulai` to `effective_from` only
when the date lies inside the approved OperatorOS academic year. Otherwise use
the academic-year start with a warning or require review, per owner decision.

### Missing and exited students

Absence from a partial file has no effect. Absence from a declared complete
snapshot produces `MISSING_FROM_SOURCE` review items; it never deletes a
student, legacy identity, enrollment, device mapping, attendance, override, or
history row.

An explicit non-null `jenis_keluar_id`/`tanggal_keluar` or accepted Dapodik
soft-delete state may propose:

- ending the current `StudentEnrollment.effective_to`;
- setting `class_assigned = false`;
- mapping `StudentMaster.student_status` to `transferred`, `withdrawn`,
  `graduated`, or `inactive` through an owner-approved exit-code table.

Missingness alone must not guess transferred vs graduated. Existing attendance
history remains linked and unchanged.

### PTK

PTK matching is blocked until a personnel model is approved. The intended
order is exact `dapodik_ptk_id`, then exact unique NIP, otherwise manual review
or explicit creation. Exit dates deactivate a school assignment; they never
delete a person. PTK import must never create an OperatorOS login account.

## Transaction and idempotency rules

- Preview is non-mutating and expires after the existing 24-hour window.
- Commit requires administrator capability, selected row IDs, preview
  checksum, owner-bound session, and a Dapodik-specific confirmation token.
- Re-read all target identities and uniqueness constraints at commit time.
- Commit a selected logical roster set atomically; any stale/conflicting row
  rolls back that selection.
- The file checksum plus source school, source period, and schema version form
  the import idempotency key. A committed replay returns the original result.
- A source `last_update` older than the last accepted source timestamp cannot
  overwrite newer data without explicit conflict resolution.
- Never update `students`, attendance rows, attendance overrides/history, or
  `StudentDeviceIdentity` as an incidental Dapodik import action.

## Audit and review records

Reuse the Phase 6 ledger rather than `upload_logs`:

### Import/session summary

`StudentImportSession`/batch metadata records:

- source system `DAPODIK` and import schema version;
- filename and checksum;
- source owner, receipt time, source school, Dapodik semester, and snapshot
  completeness declaration;
- total, valid, new, updated, unchanged, exited, missing-from-source,
  conflict, invalid, privacy-rejected, and manually flagged counts;
- selected and committed counts, failure code, and correlation ID.

### Row preview

Each row records source sheet/row, classification, internal matched entity ID,
match rule, validation codes, and an allowlisted normalized payload. Store
field names and typed differences. UI/API audit output masks NISN/NIPD and does
not expose birth details. Prohibited source columns and their values are never
stored.

### Applied actions

Append immutable `StudentImportAppliedAction` entries for actions such as:

- `LINK_DAPODIK_STUDENT`
- `CREATE_STUDENT_MASTER`
- `UPDATE_STUDENT_PROFILE`
- `CREATE_OR_LINK_DAPODIK_CLASS`
- `CREATE_ENROLLMENT`
- `TRANSFER_ENROLLMENT`
- `END_ENROLLMENT`
- `CHANGE_STUDENT_STATUS`

Each action records before/after state sufficient for compensation, checksums,
dependencies, actor, source row, and rollback eligibility. Before/after state
must contain internal IDs and changed field names, not unnecessary PII.

### Operations audit and student history

Emit an `OperationsAuditEvent` for preview creation, commit success/failure,
manual conflict resolution, and rollback. Use `source="IMPORT"`, attach the
import session/action IDs, and store `changed_fields` as field names or masked
summaries. `StudentMasterChangeHistory` records each accepted student field
change with source `dapodik_roster_import` and the batch ID.

Never log raw workbook rows, passwords, usernames, Dapodik session material,
NIK, family data, bank data, or unmasked NISN/NIPD. The current audit scrubber
masks selected keys only; the importer must construct allowlisted metadata
rather than relying on post-hoc masking.

## Fields deliberately not imported

OperatorOS has no attendance or roster-management need for the following
Dapodik fields, so retaining them would create an unnecessary sensitive-data
footprint:

- student `nik`, `no_kk`, and every parent/guardian/spouse NIK;
- parent, guardian, spouse, and family names or demographics;
- income, occupation, education, assistance, PIP/KPS/KIP/KKS, hobby, and
  aspiration fields;
- student, school, or PTK banking, account, tax, and financial fields;
- PTK marital/family fields;
- PTK `username`, `password`, `pengguna_id`, or any application/session field;
- school bank accounts, registration secrets, financial data, or operational
  credentials, including `kode_registrasi` except transient validation if the
  owner later proves a legitimate need;
- addresses, phone numbers, and email addresses not explicitly approved for a
  concrete OperatorOS feature.

Even if these columns appear in an export, their values are discarded before
preview persistence, fixtures, logs, telemetry, or error reports. This follows
data minimization: no functional need means no collection or retention.

## Decisions required before implementation

1. Is OperatorOS permanently single-school, or must this design support
   multiple schools/tenants? Multi-school support requires a school/source
   model and reconsidering global NIPD uniqueness.
2. Should NISN/NIPD remain canonical fields populated from Dapodik, or should
   source copies be retained to permit conflict review without overwriting?
3. Are unmatched Dapodik students always manual-review items, or may an admin
   explicitly create selected masters during commit? The current code and the
   published roster contract disagree here.
4. What is the approved mapping from Dapodik `jenis_keluar_id` values to
   `active`, `inactive`, `transferred`, `withdrawn`, and `graduated`?
5. Does `soft_delete` mean inactive source data for this export, and can it
   ever drive a status change without `tanggal_keluar`?
6. How do Dapodik `semester_id` values map to OperatorOS academic years and,
   if needed, terms? One academic year may contain multiple Dapodik semesters.
7. Who owns the mapping from `tingkat_pendidikan_id` and rombel metadata to
   canonical jenjang/program/grade/class, and must every new mapping be
   approved before roster commit?
8. Will the export contain stable `rombongan_belajar_id` on student rows? If
   not, what authoritative key joins students to classes?
9. Is PTK/personnel management in scope? If yes, approve a dedicated personnel
   model and class-assignment relationship. If no, decide whether a bare
   `dapodik_ptk_id` may remain on `academic_classes` as source metadata.
10. Is the first supported format XLSX only, or is CSV required at launch?
    CSV requires a separate verified security and encoding contract.
11. Must a complete snapshot reconcile missing students automatically into a
    review queue, or should only explicit Dapodik exit fields affect status?
12. Should imported `nama`, gender, birth place/date, and admission date update
    existing nonblank OperatorOS values automatically or always require
    per-field approval?
13. What retention period applies to sanitized preview payloads and failed
    batches? Immutable applied-action provenance remains, but raw preview data
    should expire.

Implementation must not begin until these decisions, the workbook specimen,
and the source-owner/completeness contract are approved.
