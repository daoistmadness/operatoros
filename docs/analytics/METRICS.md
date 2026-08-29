# OperatorOS metric reference

These definitions apply to the Phase 16 canonical analytics routes.

## `attendance_rate`

- Meaning: observed attendance rate for the selected enrollment population.
- Numerator: attendance records with effective status `on-time` or `late`.
- Denominator: numerator plus stored `sakit`, `izin`, and `alfa` counts.
- Date range: inclusive `start_date` through `end_date`, bounded by the
  selected academic year. Attendance uses its ISO date. Absence reasons use
  the stored month bucket that overlaps the selected months.
- Grouping: all selected enrollments, or class and jenjang cohorts.
- Unit: percent.
- Rounding: `ROUND_HALF_EVEN` to one decimal place.
- Missing data: `unavailable` with a null value when the denominator is zero.
  A rounded value of zero uses status `zero`.
- Late records count as present and also appear in the late count.

## `grade_average`

- Meaning: average of available grade scores for the selected population.
- Numerator: sum of non-null `student_subject_grades.score` values.
- Denominator: count of non-null grade score values.
- Date range: academic-year filter. Grade rows have no date field in the
  current schema.
- Grouping: all selected enrollments, or class and jenjang cohorts.
- Unit: score.
- Rounding: `ROUND_HALF_EVEN` to one decimal place.
- Missing data: `unavailable` with a null value when no score exists.
  A rounded value of zero uses status `zero`.

## Shared rules

- The API rejects invalid dates, inverted ranges, out-of-year ranges, and
  unknown filter IDs.
- Stable entity IDs drive filter and cohort queries. Labels are display data.
- The API returns sample counts and numerator/denominator data with cohort
  metrics.
- Zero, unavailable, and not-applicable states are distinct contract values.
- The existing report service keeps its accepted report-specific formulas.
  Phase 16 does not silently change those response semantics.


## Data Recapitulation (2026-08)

Descriptive counts computed server-side from canonical data.

### Active student

A canonical `student_masters` row that currently has a
`student_enrollments` row with `effective_to IS NULL` and
`lifecycle_state = 'ACTIVE'` for the selected academic year (default: the
`academic_years` row with `is_default = 1`). Each student is counted once
per recap request even if duplicate enrollment rows exist.

### Active staff

A `staff_members` row with `employment_status = 'ACTIVE'`.

### Category rows

- Gender/religion come from `student_masters` (optional fields; missing
  values surface as an explicit "Unknown" category and in `unknownCount`).
- Jenjang comes from the enrollment's `jenjang_id`; class/rombel from the
  enrollment's `academic_class_id` (missing class -> "Unknown").
- Age is derived server-side from `student_masters.birth_date` against the
  current date and returned only as bands (<=5, 6-7, 8-9, 10-11, 12-13,
  14-15, 16+). Birth dates never leave the API.
- Staff employment status uses `staff_members.employment_status`
  (ACTIVE/FORMER/UNKNOWN); job title uses `job_title_normalized` with
  `job_title_raw` as fallback; education uses the highest
  `staff_education.education_level`; jenjang assignment counts distinct
  staff per assigned jenjang (staff with no assignment -> "Unknown").
  Staff gender and PTK type/rank/certification are not available in the
  canonical schema and are intentionally absent.

### Percentage

`count / total in current filtered scope * 100`, rounded to 2 decimals;
0 when the scope total is 0. Class/rombel matrices are generated
server-side with row totals, column totals, and a grand total.
