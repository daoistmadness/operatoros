# Student Master Import Contract (S1 Frozen Draft)

This contract defines future preview and commit behavior. It does not describe an implemented importer.

## Property legend

- Requirement: **R** required, **O** optional, **C** conditionally required.
- Privacy: **G** general/reportable, **R** restricted, **H** highly sensitive.
- Report: **Y** allowed in authorized aggregate/detail reports, **A** aggregate only, **N** excluded by default.
- Mutability: **I** immutable after creation, **M** mutable with audit, **E** effective-dated rather than overwritten.

## Canonical fields

### Student identity

| Field | Requirement | Privacy | Report | Mutability | Rule |
|---|---|---|---|---|---|
| `internal_student_uuid` | R (system) | R | N | I | Generated stable person identity; never supplied as a trusted value by ordinary files |
| `attendance_machine_id` | C | R | N | E | String; required when linking scanner attendance; preserve leading zeros |
| `attendance_device/source` | C with machine ID | R | N | E | Device/site namespace for ID uniqueness |
| `nipd` | C | R | N | M | School identifier; unique when present after conflict review |
| `nisn` | C | H | N | M | National identifier; validate format, encrypt/mask |
| `nik` | O/C by policy | H | N | M | Never log/export raw by default |
| `full_name` | R | R | Y (authorized) | M | Preserve display spelling; normalized companion only for matching |
| `preferred_name` | O | R | Y | M | Never replaces legal/full name |

At least one authoritative identifier among NIPD, NISN, NIK, or reviewed attendance identity is required to commit a new master. Name alone cannot satisfy identity.

### Demographics

| Field | Requirement | Privacy | Report | Mutability |
|---|---|---|---|---|
| `gender` | O | G | A/Y | M |
| `birth_place` | O | R | N | M |
| `birth_date` | C for fallback matching | R | N | M |
| `religion` | O | G | A/Y | M |
| `citizenship` | O | G | A/Y | M |
| `blood_type` | O | R | N | M |

Enumerated values must map through controlled dictionaries; unknown source values produce review warnings rather than silent coercion.

### Academic admission

| Field | Requirement | Privacy | Report | Mutability |
|---|---|---|---|---|
| `admission_date` | C for active academic master | G | Y | M |
| `admission_type` | O | G | A/Y | M |
| `previous_school` | O | R | N | M |
| `initial_program` | O | G | A/Y | E |
| `student_status` | R | G | A/Y | E |

`student_status` is a master lifecycle state, not proof of active enrollment. Import omission never changes it.

### Address

| Field | Requirement | Privacy | Report | Mutability |
|---|---|---|---|---|
| `address` | O | R | N | M |
| `kelurahan` | O | G | A/Y | M |
| `kecamatan` | O | G | A/Y | M |
| `city_regency` | O | G | A/Y | M |
| `province` | O | G | A/Y | M |
| `postal_code` | O | R | N | M |

Fine-grained address is restricted. Geographic reporting uses controlled area labels and an `Unknown / Not Recorded` bucket.

### Contact

| Field | Requirement | Privacy | Report | Mutability |
|---|---|---|---|---|
| `student_phone` | O | R | N | M |
| `student_email` | O | R | N | M |

### Health

| Field | Requirement | Privacy | Report | Mutability |
|---|---|---|---|---|
| `allergy` | O | H | N | M |
| `medical_condition` | O | H | N | M |
| `special_needs` | O | H | A only when policy permits | M |

These fields require field-level authorization and must not enter ordinary exports, logs, search indexes, or analytics payloads.

### Emergency contact

| Field | Requirement | Privacy | Report | Mutability |
|---|---|---|---|---|
| `emergency_contact_name` | C when school policy requires | R | N | M |
| `emergency_contact_relationship` | C with contact | R | N | M |
| `emergency_contact_phone` | C with contact | R | N | M |
| `emergency_contact_address` | O | H | N | M |

### Parent and guardian

The following field set repeats for `father`, `mother`, and `guardian` where applicable.

| Field suffix | Requirement | Privacy | Report | Mutability |
|---|---|---|---|---|
| `_name` | O/C by custodial policy | R | N | M |
| `_nik` | O | H | N | M |
| `_birth_place`, `_birth_date` | O | H | N | M |
| `_education` | O | R | A only | M |
| `_occupation` | O | R | A only | M |
| `_income_band` | O | H | A only | M |
| `_phone`, `_email` | O/C for primary contact | R | N | M |
| `_address` | O | H | N | M |
| `_is_primary_contact` | O | R | N | M |

Do not store raw income where a controlled band meets the reporting need. Guardian fields become conditionally required only when the guardian is the responsible contact.

### Document completeness

Store status/verification metadata, not document image contents in the general student table.

| Field | Requirement | Privacy | Report | Mutability |
|---|---|---|---|---|
| `family_card_status` | O | H | A only | M |
| `birth_certificate_status` | O | H | A only | M |
| `father_id_status`, `mother_id_status`, `guardian_id_status` | O | H | A only | M |
| `school_agreement_status` | O | H | A only | M |
| `publication_consent_status` | O | H | A only | E |

Allowed status values must be controlled (for example `not_recorded`, `missing`, `received`, `verified`, `expired`, `not_applicable`). Verification actor/time is audited separately.

### Source and audit

| Field | Requirement | Privacy | Report | Mutability |
|---|---|---|---|---|
| `source_file` | R per batch | R | N | I |
| `source_sheet` | R per row | R | N | I |
| `source_row` | R per row | R | N | I |
| `import_batch_id` | R | R | N | I |
| `created_by`, `created_at` | R | R | N | I |
| `updated_by`, `updated_at` | R on update | R | N | append audit |
| `source_checksum` | R per batch | R | N | I |

Source metadata must not reveal workstation paths to ordinary users. Store a sanitized filename plus protected batch metadata.

## Input normalization

- Trim surrounding whitespace; preserve original raw values in protected staging/audit.
- Normalize comparison names with Unicode normalization, whitespace collapse, and case folding, but never overwrite display spelling from the normalized value.
- Parse dates through explicit accepted formats; reject ambiguous dates in preview.
- Treat identifiers as strings. Never numeric-coerce NIPD/NISN/NIK/device IDs.
- Empty strings become null only for fields that permit null.
- Enumerations require explicit mapping; unrecognized values are `INVALID` or `CONFLICT`, not silently `Unknown` during master commit.
- Formula cells, hidden sheets/rows, duplicate headers, and duplicate row identifiers must be reported.

## Matching contracts

### A. Existing attendance registry link

Priority, stopping at the first unique authoritative match:

1. exact current `(device/source, attendance_machine_id)`;
2. exact existing reviewed identity link;
3. normalized name only when exactly one registry candidate exists and corroborating evidence is sufficient for human review.

Name-only matching never auto-commits. Different name on the same scanner ID and same name on a new scanner ID are `CONFLICT` until reviewed; the future flow must not perform the current automatic primary-key replacement.

### B. Student master import

1. stable internal identity, only from a trusted OperatorOS export/reference;
2. exact NIPD;
3. exact NISN;
4. exact NIK;
5. exact scoped attendance-machine identity;
6. normalized full name plus exact birth date.

If identifiers resolve to different masters, classification is `CONFLICT`. If a supposedly unique identifier has multiple candidates, classification is `CONFLICT` and commit is blocked.

## Row classifications

| Classification | Meaning | Commit behavior |
|---|---|---|
| `NEW_MASTER` | No candidate; sufficient identity data | Create master after review |
| `LINK_TO_EXISTING_ATTENDANCE_STUDENT` | New master/profile row uniquely links to existing scanner registry | Create/link without moving attendance |
| `UPDATE_MASTER` | Existing master, changed allowed fields | Audited field-level update |
| `UPDATE_ENROLLMENT` | Master unchanged; academic assignment changes | Effective-dated enrollment operation |
| `UNCHANGED` | Canonical values equal | No mutation; retain batch outcome |
| `CONFLICT` | Ambiguous/contradictory identity or protected overwrite | Block row pending resolution |
| `INVALID` | Missing/invalid required data | Block row with safe errors |

One row may propose both master and enrollment changes, but preview must display them separately.

## Preview and commit boundary

Preview is read-only and reports sheet, mapping, row classification, proposed field diffs, identity evidence, conflicts, validation errors, and aggregate counts. Commit requires the same source checksum and preview version, explicit conflict resolution, authorization, and an idempotency key. Any changed workbook invalidates the preview.

Commit is atomic per approved batch unless a future contract explicitly defines independently approved partitions. It writes master/device/enrollment changes and append-only audit records together. No file absence, blank value, or name change may delete a master, deactivate a student, remove an identity, or erase a protected value implicitly.

## Enrollment import contract

One current `student_enrollments` row means one student's academic enrollment for one academic year. The current `(student_id, academic_year_id)` uniqueness permits only one program/jenjang context per year and cannot represent concurrent programs or transfer history.

The target needs effective-dated enrollment history with:

- stable master ID;
- academic year and program;
- jenjang and class assignment;
- `start_date`, nullable `end_date`;
- controlled status (`planned`, `active`, `transferred`, `withdrawn`, `graduated`, `completed`, `cancelled`);
- admission/exit reason;
- source/import batch and created/updated actors/times.

If concurrent formal and PKBM enrollment is permitted, uniqueness must include program and enforce only non-overlapping/elected active intervals according to policy. Class transfers should be a separate effective-dated assignment history rather than overwriting the only class value. S1 does not change the existing constraint.

## Privacy/access contract

- **Administrator:** manage identity, enrollment, restricted contacts; highly sensitive fields require an explicit privileged capability and audit.
- **Report viewer:** general reportable fields and aggregates; no raw national IDs, contacts, precise address, or health notes.
- **Masking:** NIK/NISN/NIPD and document identifiers masked by default; phones/emails partially masked; dates of birth reduced to age bands where possible.
- **Exports:** explicit purpose, role check, field allow-list, watermark/metadata, export audit, and no highly sensitive fields in routine monthly reports.
- **Audit:** actor, purpose/action, subject, fields changed/accessed where feasible, batch/export ID, timestamp, outcome; never log raw secrets or highly sensitive values.

## Non-negotiable safeguards

- Preserve the 3,409 attendance rows and their verified identity attachment.
- Preserve append-only override history.
- Support SQLite and PostgreSQL with equivalent constraints and transaction semantics.
- No scanner-ID reinterpretation, name-only automatic match, implicit deactivation, destructive sync, or missing-value overwrite.
