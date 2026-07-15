# Academic Master Contract

## Hierarchy

Enrollment academic placement is governed by:

`academic_years → jenjangs → academic_programs → academic_classes → student_enrollments`

Every referenced row must be active at preview and commit time. Student imports and attendance imports cannot create or reactivate academic master data.

## Jenjang master

Required fields are `id`, unique `code`, unique `name`, positive integer `level`, and `active`. Existing compatibility rows with null code/level are incomplete and cannot authorize new enrollment until reviewed.

Jenjang creation or enrichment requires an approved academic-structure source and recorded owner. Similar words in a roster are proposals only.

## Program master

`academic_programs` requires `id`, restrictive `jenjang_id`, `name`, and `active`. `(jenjang_id, name)` is unique. A program cannot cross jenjang boundaries or be created from a roster row.

## Class master

`academic_classes` requires `id`, restrictive `academic_year_id`, `program_id`, `jenjang_id`, `class_name`, and `active`. `(academic_year_id, jenjang_id, class_name)` is unique.

The referenced program must belong to the same jenjang. Application validation enforces this before approval; database references prevent deletion of masters in use.

## Enrollment rules

- Enrollment requires active academic year, jenjang, program, and class masters.
- `student_enrollments.academic_class_id` is the canonical class reference; `class_name` remains only a compatibility snapshot.
- No free-text jenjang, program, or class can authorize enrollment.
- One student master may have at most one enrollment per academic year.
- Historical enrollment and class-history rows are immutable; changes use effective-dated history.
- Inactive masters remain readable for history but cannot receive new enrollments.

## Controlled import governance

`POST /api/student-enrollments/academic-master-preview` accepts a named source owner and proposed jenjang/program/class hierarchy. It stores review staging and classifies `NEW`, `EXISTS`, `CONFLICT`, or `INVALID`; it never changes canonical masters.

Approval and canonical insertion are intentionally not exposed in S3.7. A later authorized commit must revalidate references, operate atomically, record approver/time/source/checksum, and reject any stale preview.

Frozen rules:

1. Jenjang cannot be created from student or roster imports.
2. Classes cannot be created automatically from roster imports.
3. Enrollment cannot use free-text academic values.
4. Historical enrollment remains immutable.
5. Every academic master change requires attributable audit evidence.

