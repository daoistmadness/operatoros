# Academic Mapping Contract

## Purpose

This contract controls the translation from legacy attendance identities into enrollment academic context:

`student_master → student_enrollment → jenjang → class`

Mapping is a reviewed data-migration action. It must never infer jenjang or class from a student's name, scanner identifier, attendance dates, or workbook filename.

## Jenjang resolution

1. A nonblank legacy `students.jenjang` that exactly equals one canonical `jenjangs.name` is an `EXACT` match. No transformation occurs.
2. Case, whitespace, abbreviation, or spelling transformations require an approved `jenjang` rule whose `target_id` references `jenjangs.id` with `ON DELETE RESTRICT`.
3. A normalized candidate is only a proposal until approved. Multiple normalized candidates are `AMBIGUOUS` and blocked.
4. Blank values remain `EMPTY_JENJANG`; no rule may use a blank source to bulk-assign students.
5. Canonical jenjang rows are seeded master data and are not created by mapping preview or enrollment population.

## Class resolution

1. The legacy source is `students.class_name`.
2. The enrollment target is the approved rule's `target_value` stored in `student_enrollments.class_name`.
3. Because OperatorOS currently has no canonical class dictionary table, every nonblank class transformation requires an approved `class` rule.
4. Blank values remain `EMPTY_CLASS`. Similar names, grade numbers, student names, or jenjang assumptions cannot supply a class.
5. Class changes after enrollment require the effective-dated enrollment transfer/history workflow, not a mapping-rule rewrite.

## Mapping rule lifecycle

`student_academic_mapping_rules` stores:

- `mapping_type`: `jenjang` or `class`;
- original and normalized source values;
- jenjang `target_id` or class `target_value`;
- `draft`, `approved`, or `rejected` status;
- creator and creation timestamp;
- approver and approval timestamp.

Only `approved` rules participate in enrollment preview. Database checks require the correct target type and approval metadata, prohibit more than one rule per normalized source/type, and restrict deletion of referenced jenjang rows.

Creation or approval of mapping rules is outside the non-mutating preview endpoint. Until an authenticated administration workflow supplies explicit reviewed values, rules must be loaded through an approved, audited migration process—not ad hoc SQL.

## Preview and enrollment safety

`POST /api/student-enrollments/mapping-preview` is administrator-only and non-mutating. It returns affected students, source values, classifications, canonical candidates, and approved proposals.

Enrollment preview may return `CREATE_ENROLLMENT` only when:

- exactly one active canonical student mapping exists;
- jenjang is exact or resolved by an approved rule;
- class is resolved by an approved rule;
- no existing cross-master or cross-jenjang enrollment conflict exists.

`EMPTY`, `MISSING`, `AMBIGUOUS`, unapproved normalized matches, and stale targets remain blocked. Every mapping transformation is attributable to a stored rule and approver.

