# S1 Existing Student Model Audit and Contract Definition

Status: architecture baseline only. No schema, source, API, configuration, dependency, or live-data mutation is authorized by this document.

## Executive decision

OperatorOS currently has an attendance identity registry, not a complete student master. `students.id` is the integer value imported from the attendance workbook's `No. ID` column (or an optional manually supplied integer). It must not be reinterpreted as NIPD, NISN, NIK, or a permanent person identifier.

The recommended target is **Option C, introduced additively and in stages**:

1. introduce a permanent student master with an immutable internal UUID/key;
2. represent scanner identifiers as effective-dated device identities linked to that master;
3. preserve every current `students.id` and every existing `attendance.student_id` during transition;
4. link existing registry rows to a master before moving any downstream ownership;
5. stop automatic primary-key migration before enrollment/profile data can depend on the registry row.

This obtains Option C's long-term identity safety without a big-bang rewrite. The existing `students` table remains the compatibility attendance registry during the transition. No current attendance foreign key is rewritten merely to introduce the master.

## Verified live baseline

| Table | Rows |
|---|---:|
| students | 107 |
| attendance | 3,409 |
| attendance_overrides | 0 |
| attendance_override_history | 0 |
| absence_reasons | 0 |
| student_enrollments | 0 |
| student_subject_grades | 0 |
| academic_interventions | 0 |
| academic_years | 1 |
| jenjangs | 1 |
| subjects | 1 |
| assessment_components | 4 |

All 107 students have attendance, none is mapped to jenjang/class, none has `id_updated_at`, and there are no attendance orphans. IDs are integers from 20,000,001 through 20,000,387. Exact and lower/trim-normalized duplicate-name counts are both zero in this dataset; this does not prove names are unique in the school population.

Live SQLite `PRAGMA foreign_key_list` agrees with the ORM delete actions documented below: attendance/absence references use `NO ACTION`, student enrollment cascades from student, grades cascade from enrollment, and academic master/intervention references restrict deletion. The live student table also contains two separately named/created class-name indexes (model-created and compatibility-created), a harmless but redundant bootstrap artifact to clean up only in a future reviewed migration.

## Current relationship tree

```text
students
├── attendance
│   └── attendance_overrides
│       └── attendance_override_history
├── absence_reasons
├── student_enrollments
│   ├── student_subject_grades
│   └── academic_interventions
└── academic_interventions

academic_years ── student_enrollments, academic_interventions
jenjangs ── student_enrollments, subjects, academic_interventions
subjects ── student_subject_grades, assessment_components, academic_interventions
assessment_components ── student_subject_grades
```

## SQLAlchemy model catalog

### `students` — `Student`

| Column | Type | Null/default | Constraint/index | Meaning |
|---|---|---|---|---|
| `id` | Integer | PK, not null | primary key, index | Scanner/import ID in current flow; manually auto-generated or supplied outside import |
| `name` | String | not null | unique `_student_name_uc` | Display/imported full name |
| `jenjang` | String | nullable | index added by model/runtime | Legacy current mapping |
| `class_name` | String | nullable | index | Legacy current class mapping |
| `id_updated_at` | DateTime | nullable, default `None` | — | Time the name-based importer replaced an old scanner-keyed row |

Relationship: `attendances`, one-to-many, no ORM delete cascade configured. No created/updated timestamps or actor audit fields exist.

Runtime compatibility in `core/database.py` additively ensures `id_updated_at`, `jenjang`, the unique name index, and the class-name index. This bootstrap logic is non-versioned compatibility patching and must not be used for the future multi-table master migration.

### `attendance` — `Attendance`

| Column | Type | Null/default |
|---|---|---|
| `id` | Integer autoincrement PK | not null |
| `student_id` | Integer FK `students.id` | not null, indexed |
| `date` | Date | not null, indexed |
| `check_in`, `check_out` | Time | nullable |
| `late_duration` | Integer | not null, default 0 |
| `late_source` | String | not null, default `none` |
| `is_absent` | Boolean | not null, default false |
| `overtime` | Interval | nullable |
| `exception`, `week` | String | nullable |
| `status` | String | not null, indexed |

Unique `(student_id, date)` as `_student_date_uc`; composite status/date index. FK declares no explicit `ON DELETE`, so deletion is restricted/no-action when foreign keys are enforced. Relationship back to `Student`. No timestamps or actor audit fields.

### `attendance_overrides` — `AttendanceOverride`

`id` autoincrement PK; unique/indexed non-null `attendance_id` FK to `attendance.id ON DELETE RESTRICT`; non-null `original_status`, indexed `override_status`, `note`, `reviewed_by`; indexed `reviewed_at` defaulting to UTC time. One override per attendance. Relationship to attendance and history. This is the current review audit head.

### `attendance_override_history` — `AttendanceOverrideHistory`

`id` autoincrement PK; indexed non-null `override_id` FK to overrides with `RESTRICT`; indexed non-null `attendance_id` FK with `RESTRICT`; nullable `previous_status`; non-null `new_status`, `note`, `reviewed_by`; indexed `timestamp` defaulting to UTC time. SQLite and PostgreSQL migration files define update/delete prevention triggers. **The inspected live development database currently reports no triggers in `sqlite_master`**, so append-only enforcement is not physically present in that database despite the migration contract. This pre-existing migration-state discrepancy must be resolved and tested before S2; S1 does not alter it.

### `absence_reasons` — `AbsenceReason`

`id` autoincrement PK; indexed non-null `student_id` FK to students with implicit no-action; indexed non-null `class_name`, `month`, `year`; non-null integer `sakit`, `izin`, `alfa` defaults 0; nullable text `note`; non-null `entered_by`; `entered_at` and `updated_at` UTC defaults. Unique `(student_id, month, year)`. Student relationship uses a backref. Class is snapshotted as text but student ownership remains scanner-registry ownership.

### `student_enrollments` — `StudentEnrollment`

`id` autoincrement PK; indexed non-null `student_id` FK to students with `ON DELETE CASCADE`; indexed non-null academic-year and jenjang FKs with `ON DELETE RESTRICT`; nullable `class_name`; non-null `class_assigned` default false; database `created_at` and `updated_at`. Unique `(student_id, academic_year_id)` as `_student_year_uc`. Relationships to student, academic year, jenjang. The cascade from student is unsafe if a scanner-key migration deletes a populated student row.

### `student_subject_grades` — `StudentSubjectGrade`

`id` autoincrement PK; indexed non-null `enrollment_id` FK with `CASCADE`; indexed non-null subject and component FKs with `RESTRICT`; nullable float `score`; database timestamps. Unique `(enrollment_id, subject_id, component_id)`. Scores are current values, not an append-only grade history.

### `academic_years` — `AcademicYear`

Autoincrement integer PK; unique/indexed label; non-null dates; constrained status (`upcoming`, `active`, `closed`); non-null `is_default`. Partial unique index permits one default. No timestamps. Bootstrap seeds `2025/2026` active/default when absent.

### `jenjangs` — `Jenjang`

Autoincrement integer PK and unique/indexed non-null name. This normalized, seeded master is distinct from legacy `jenjang_config` cutoff settings and `students.jenjang` text. Bootstrap currently seeds only `Primary`.

### `subjects` — `Subject`

Autoincrement PK; non-null name; indexed non-null `jenjang_id` FK with `RESTRICT`; two non-null boolean assessment-support flags. Unique `(name, jenjang_id)`. Bootstrap currently seeds `Language` for `Primary`.

### `assessment_components` — `AssessmentComponent`

Autoincrement PK; non-null name and constrained type (`sumatif`, `formatif`); nullable indexed subject FK with `RESTRICT`. Unique `(name, assessment_type, subject_id)`. Four seeded rows currently exist.

### `academic_interventions` — `AcademicIntervention`

Autoincrement PK. Required student (`RESTRICT`), academic year (`RESTRICT`), and subject (`RESTRICT`) references; nullable enrollment, jenjang references with `RESTRICT`. It snapshots student/subject names, threshold, source, current average, class, type, term, status, priority, ownership/action/outcome fields, follow-up date, and created/updated/resolved timestamps. Score/threshold, status, priority, and assessment-type checks are enforced. Direct student plus optional enrollment linkage explains its two branches in the tree.

## Student identity trace and answers

```text
Excel No. ID
  -> int(row["No. ID"])
  -> lookup Student.id
  -> if missing, exact-name lookup
  -> create/replace Student with id=No. ID
  -> Attendance.student_id = Student.id
```

1. **Is ID supplied by the machine file?** Yes for attendance-created students: exact `No. ID` values are parsed.
2. **Numeric or string?** Forced to Python `int`, stored as SQL Integer. Leading zeros are lost and nonnumeric IDs fail row parsing.
3. **Can scanner ID change?** The code explicitly anticipates it through exact-name ID migration, so yes operationally.
4. **Can IDs collide?** Yes. Lookup by ID wins; if a different person arrives with the same ID, the existing row's name is overwritten. There is no conflict quarantine.
5. **Does changing ID risk history?** Yes. Current code rewrites only `attendance.student_id`, then deletes the old student. It does not relink absence reasons, enrollment, grades, or interventions. With populated branches it may cascade enrollment/grades, hit RESTRICT, or misattach identity.
6. **Meaning of `id_updated_at`?** Timestamp of exact-name-based scanner primary-key replacement; it is not a general profile update time.
7. **Mapping workflow?** `/mapping` and student APIs assign legacy `students.jenjang`/`class_name`; manual creation accepts an optional integer ID. No device-to-person identity review table exists.
8. **Multiple scanner IDs per person?** Not representable concurrently. Exact-name migration collapses old to new and discards the old identity.
9. **Is name truly unique?** No reliable school-domain assumption supports this. Current live data happens to contain no duplicates.
10. **Duplicate-name handling?** Database uniqueness blocks exact duplicates; manual create also blocks case-insensitive duplicates. Import uses exact case-sensitive name matching. Same ID/different name overwrites the name; same exact name/different ID migrates the primary key. Case/spacing variations can instead attempt a new row.

## Name uniqueness decision

The unique name constraint is not safe as a permanent identity rule. Names change, contain spacing/case variations, and can legitimately repeat. Retain it temporarily during compatibility operation because removing it changes importer behavior. In S2, introduce stable identifiers and a normalized-name search field; then remove name uniqueness in an additive/rebuild migration only after importer matching no longer depends on it. Names remain required display data, never an automatic unique key. Name-only matching is allowed only when the candidate set is exactly one and must otherwise produce `CONFLICT`.

## Legacy jenjang/class audit

These fields are active compatibility fields today:

- student listing, filtering, class options, mapping mutation, manual student creation;
- attendance calculations derive jenjang from them for cutoff/HEB behavior;
- student profile/history responses expose them;
- dashboard and reports group/filter using them in current attendance workflows;
- enrollment candidate/source-class APIs use `students.class_name` as the bridge into normalized enrollment;
- the attendance importer preserves them during scanner-ID replacement but does not assign them for new students.

They must remain until consumers migrate. Future academic and monthly student reporting must use effective `student_enrollments + academic_years + jenjangs`; legacy values may seed reviewed enrollment proposals but are not authoritative report dimensions.

## Why the enrollment branch is empty

- APIs exist for candidate listing, source classes, bulk enrollment, listing, and junction deletion.
- The React Enrollment Panel supports academic year, jenjang, class, candidate selection, and bulk enrollment.
- Grade Ledger queries join through `student_enrollments`; without enrollment, no student grade grid can be populated.
- One active/default academic year is seeded.
- Only one jenjang (`Primary`) is seeded, and it is not reconciled to the 107 students.
- All 107 `students.class_name` and `students.jenjang` values are null, so source-class grouping and safe automatic jenjang mapping have no evidence.
- No automatic migration/population is intentionally present. Enrollment is a reviewed administrative operation.

Safe population: import/collect authoritative roster data, preview identity links, map academic year/jenjang/class, classify conflicts, require review, then atomically insert enrollments. Never infer all 107 as active or Primary merely because they attended.

## Population definitions

- **Attendance population:** distinct master-linked students having qualifying attendance in the selected period. This answers participation, not enrollment.
- **Active academic population:** students with an enrollment whose effective interval/status includes the snapshot date. This is the monthly report denominator.
- **Student master population:** all retained masters regardless of active status, device identity, or attendance.

The current 107 are precisely attendance-registry students found in the supplied attendance data: all have attendance. There is no evidence they are the entire active school, and no provided authoritative roster proves whether departed, inactive, PKBM, or non-scanner populations are missing. Any external roster must be profiled and reconciled in S4; absence from one file never deactivates a master.

## Architecture options

| Option | Data safety | Migration/compatibility | Imports/enrollment | Privacy | Decision |
|---|---|---|---|---|---|
| A. Extend `students` | Preserves FKs but leaves scanner PK ambiguity; ID migration threatens all added data | Low initial, high long-term coupling | Simple joins; cannot retain multiple device IDs cleanly | PII mixed into attendance registry and broad APIs | Reject as target |
| B. One-to-one `student_profiles` | Protects attendance and separates PII; still assumes one registry row equals one person | Moderate and additive | Better, but changing/multiple scanner IDs and duplicate registry rows remain awkward | Good boundary | Acceptable interim, not complete target |
| C. Permanent master + device identities | Best: immutable person identity, multiple/effective scanner IDs, attendance preserved by staged links | Highest complexity; safe if additive and dual-read before cutover | Explicit conflict handling and stable enrollment ownership | Best separation and access control | **Recommended, staged** |

## Frozen target contracts

- Stable person identity is an immutable internal UUID/key unrelated to scanner, NIPD, NISN, or NIK.
- Scanner/device IDs are strings in the target contract to preserve leading zeros and vendor formats; uniqueness is scoped to device/source and effective interval.
- Existing integer `students.id` and attendance links are preserved until an audited migration proves master linkage.
- Enrollment and monthly snapshots belong to the stable master, not a mutable scanner ID.
- The future importer is preview-first and classifies `NEW_MASTER`, `LINK_TO_EXISTING_ATTENDANCE_STUDENT`, `UPDATE_MASTER`, `UPDATE_ENROLLMENT`, `UNCHANGED`, `CONFLICT`, or `INVALID`.
- No ambiguous name-only auto-link, no missing-file deactivation, no destructive scanner-ID reinterpretation.

Detailed import, enrollment, privacy, snapshot, reconciliation, and implementation contracts are in the companion S1 documents.

## Mandatory risks

1. Scanner ID currently occupies `students.id`; never reinterpret it.
2. Unique `students.name` is a temporary compatibility constraint, not a valid identity invariant.
3. `students.jenjang`/`class_name` are active legacy fields, not future reporting truth.
4. Enrollment is empty; attendance cannot be used as a silent enrollment seed.
5. Grades and interventions require enrollment context.
6. All 3,409 attendance rows must remain attached to the same verified people.
7. An external roster may contain more than 107 students; preview must distinguish new masters from links.
8. Monthly totals use effective active enrollment, never attendance presence alone.
9. Missing demographics reconcile under `Unknown / Not Recorded`.
10. Missing from any single import never deactivates a student.

## S1 stop boundary

This audit recommends future work but authorizes none. Review the architecture before S2 schema implementation.

## S1 completion checklist

- [x] Actual SQLAlchemy models, runtime bootstrap, migrations, live FKs, indexes, counts, and trigger state inspected.
- [x] `students.id` proven to be the integer attendance `No. ID` in the import path.
- [x] Foreign-key/delete behavior and ORM relationships documented.
- [x] Attendance-oriented identity semantics and current ID-migration risk recognized.
- [x] Staged permanent-master/device-identity architecture recommended.
- [x] Empty enrollment cause and safe population strategy documented.
- [x] Canonical import fields and privacy/mutability/reportability frozen.
- [x] Identifier matching priorities and conflict classifications frozen.
- [x] Monthly active population and three-population distinction frozen.
- [x] Materialized versioned snapshot semantics frozen.
- [x] Reconciliation and Unknown-category rules frozen.
- [x] Privacy, masking, export, and audit boundaries frozen.
- [x] Additive dual-dialect migration risks and phase gates documented.
- [x] No implementation or live-data change performed.
