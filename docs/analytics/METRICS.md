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
