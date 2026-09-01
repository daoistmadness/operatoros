# OperatorOS metric reference

These definitions apply to the Phase 16 canonical analytics routes.

## Attendance Analytics Expansion

The attendance expansion uses one event-level source. It joins attendance to
the selected academic enrollment for the attendance date. An enrollment is
selected once per attendance event. This prevents duplicate counting when
enrollment history overlaps.

### Effective status

Every count uses `COALESCE(attendance_overrides.override_status,
attendance.status)`. An override is authoritative. The API reports
`on-time` as Present and keeps `late`, `incomplete`, `absent`, `sakit`,
`izin`, and `alfa` as separate statuses. Null or unknown statuses are
reported as Unrecorded.

### Attendance expansion rates

- Attendance rate = `(Present + Late) / (Present + Late + Sakit + Izin + Alfa) * 100`.
- Late counts as attended.
- Tardiness rate = `Late / (Present + Late) * 100`.
- Unexcused absence rate = `Alfa / (Present + Late + Sakit + Izin + Alfa) * 100`.
- Incomplete, Absent, and Unrecorded remain visible as counts. They are not
  added to the established attendance-rate denominator.
- Percentages use the 0–100 scale and round to two decimals. A zero
  denominator returns `0`.
- Total records includes every selected effective-status event.
- Override percentage uses override-corrected records divided by total
  selected records.

### Scope and data limits

The scope requires an academic year and an inclusive attendance date range.
Optional filters use canonical jenjang and academic class IDs. The API
returns zero-valued aggregates for a valid empty scope.

The daily and grouped views use event-level attendance statuses. The legacy
monthly `absence_reasons` ledger has no attendance-date key, so it is not
joined into these event aggregates. This avoids double counting and avoids
inventing a date for a monthly reason. HEB is reported from the existing
monthly `heb_overrides` values and does not change attendance rates.

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


## Data Quality and Completeness (2026-08)

Diagnostic view of missing and unmapped canonical master data. Read-only;
no automatic repair, no risk scores, no persisted snapshots.

### Scope

- Student quality applies to current enrollments (effective_to IS NULL,
  lifecycle filter default ACTIVE) for the selected academic year.
- Staff quality applies to `staff_members.employment_status` (default ACTIVE).

### Required vs optional

- REQUIRED (conditionally): class/rombel assignment is required for ACTIVE
  students; a missing class on a non-ACTIVE enrollment is reported as an
  optional-field gap instead.
- OPTIONAL_BUT_TRACKED: student gender, religion, birth date; staff
  education, jenjang assignment, job title.
- Missing enrollment: an `active` student master with no current enrollment
  row is reported separately (MISSING_ENROLLMENT) and excluded from the
  enrollment-based denominators.

### Missing vs unknown vs unmapped

- NULL/empty value -> Missing.
- A recorded but unknown category value (for example
  `employment_status = 'UNKNOWN'`) -> Unknown (UNKNOWN_CATEGORY_VALUE).
- A raw value that has no normalization mapping (job_title_raw present,
  job_title_normalized absent) -> Unmapped (UNMAPPED_JOB_TITLE).

### Denominators

Field completeness = populated applicable records / applicable records,
rounded to 2 decimals. Conditional fields use only applicable records (for
example class assignment uses ACTIVE students only). Applicability is
stated per field in the response.

### Issue drilldown

Issues endpoints return the affected record name, context (jenjang/class or
employment/job title), and typed issues, filtered by field and issue type
and paginated server-side (page/page_size, max 200). Capabilities:
students `view_student`, staff `view_staff`; exports
`export_student_data` / `export_staff`.

## Academic Analytics Expansion (2026-08)

Academic analytics uses the canonical `student_subject_grades` rows joined to
the selected academic-year enrollment, subject, and assessment component.
Each student is counted once per academic year. The API performs all business
aggregates. The browser only formats returned values.

### Score and averages

- Scores use the stored 0–100 `student_subject_grades.score` value.
- The overall average is the sum of non-null scores divided by the count of
  non-null scores. It does not average group averages.
- Formatif and sumatif averages use the same rule within each type.
- The current schema has no grade weights. Academic analytics applies no
  invented weight.
- Displayed averages use the existing `ROUND_HALF_EVEN` rule to one decimal.
- Minimum and maximum use the raw non-null score values.

### Missing and participation

- The expected result set is the selected enrollment population crossed with
  the canonical subject/component catalog for that jenjang.
- A result with a null score is missing. It is not treated as score zero.
- Participation percentage is scored result slots divided by expected result
  slots, on the 0–100 scale. A zero denominator returns `0`.
- New score entries belong to an `academic_assessment_sessions` parent with a
  required canonical term number and an optional known assessment date. Term
  numbers use the existing `academic_term_configs` authority, including its
  explicit ordering; default periods are used only where that authority has no
  custom row. Academic year remains a broad scope, not a precise assessment
  period.
- Historical grade rows migrated from S4.3 retain a null session and are
  explicitly period-unknown. They are included in the unfiltered view but are
  excluded from term-filtered results. No date is inferred from `created_at`,
  import time, row order, or filename.
- Academic analytics supports the existing academic-year, jenjang, class,
  subject, assessment-type, and session-backed term filters. Term-filtered
  participation counts enrollment/component/session slots; missing scores are
  not zero.

### Mastery

KKM comparisons reuse the existing threshold precedence and legacy fallback of
85. They compare each student-subject-assessment-type average with its
effective threshold. The output reports counts only. It does not create risk,
intervention, or performance labels.

### Scope and safety

Authorization uses `view_student` for analytics and the existing
`export_student_data` capability for Excel. Filters narrow the server-side
authorized scope. Subject-specific and global assessment components are
counted once. No persisted academic rollups are created.

## Management Analytics Overview (2026-08)

The management overview is a concise entry point. It composes the existing
recapitulation, attendance, academic, and data-quality authorities. It does
not define a new cross-domain score or duplicate their formulas.

### Sections and authority

- School Snapshot uses active student enrollment and active staff records from
  Data Recapitulation.
- Attendance uses the effective-status and rate rules in Attendance Analytics.
- Academic uses the score, average, and participation rules in Academic
  Analytics.
- Data Quality uses the student and staff completeness rules in Data Quality.

### Scope and access

The overview requires an academic year. Jenjang and class filters narrow the
server-side scope. Attendance uses the selected academic-year date range by
default. The overview returns only sections allowed by the actor's existing
capabilities; hidden sections are not returned as data. Detail links preserve
compatible academic-year, jenjang, and class filters.

The overview has no dedicated export. Detailed analytics pages remain the
authoritative export surfaces.

## Student Trend Insights (2026-08)

Student Trends compares descriptive attendance values for one student across
two deterministic windows. It reuses effective attendance status, where an
attendance override replaces the original status.

- `rolling_4w`: the latest observed attendance date in the selected scope and
  the preceding 28 calendar days, compared with the preceding 28 calendar
  days. The current schema has no instructional-day calendar.
- `term`: the configured or existing default term containing the latest
  observed attendance date, compared with the equivalent elapsed calendar-day
  portion of the preceding term.
- Attendance rate is `(Present + Late) / (Present + Late + Sakit + Izin + Alfa)
  * 100`, with Late counted as attended.
- Tardiness is `Late / (Present + Late) * 100`.
- Alfa is reported as the canonical unexcused absence rate using the
  attendance-rate denominator.
- Percent deltas use percentage points. Values use the existing two-decimal
  attendance convention.
- A missing current or previous denominator returns `null` and
  `insufficient_data`; it never becomes a zero comparison.
- Every metric returns its current and previous sample size.

Academic trend is available only when session-attributed scores exist for two
adjacent canonical terms. It compares the mean scored result in the latest
observed term with the immediately preceding observed term and returns both
sample sizes. If either period is absent, the value is `null` with
`insufficient_data`. Legacy period-unknown rows remain excluded. The feature
does not infer a time axis from score IDs or write trend snapshots, rollups,
thresholds, risk labels, alerts, or interventions.

## Student Indicator Discovery (2026-08)

Student indicators are transparent measurements. They are not classifications.
The endpoint is `/api/analytics/student-indicators` and reuses the existing
student-trend attendance windows and academic-year scope.

### Candidate registry

| ID | Domain | Canonical source | Unit | Status |
| --- | --- | --- | --- | --- |
| `attendance_rate` | Attendance | Attendance Analytics / Student Trends | Percent | Accepted for Stage 2 |
| `tardiness_rate` | Attendance | Attendance Analytics / Student Trends | Percent | Accepted for Stage 2 |
| `alfa_rate` | Attendance | Attendance Analytics / Student Trends | Percent | Accepted for Stage 2 |
| `academic_average` | Academic | Academic Analytics score average | Score | Accepted for Stage 2 |
| `academic_participation` | Academic | Academic Analytics result-slot participation | Percent | Accepted for Stage 2 |
| Attendance override prevalence | Attendance | No student-level interpretation | Count/percent | Rejected: diagnostic context only |
| Data-quality issue count | Data quality | Data Quality | Count | Rejected: confidence context, not a student indicator |
| Academic trend | Academic | Session-attributed scores only | Score | Technically available for comparable session-backed terms; not added to the Stage 2 risk registry |
| Mastery proportion | Academic | KKM exists for aggregate reporting only | Percent | Deferred: no existing student-level indicator contract |

Accepted attendance values use the canonical effective status. An override
replaces the original status before aggregation. Attendance rate is
`(Present + Late) / (Present + Late + Sakit + Izin + Alfa) * 100`. Tardiness
rate is `Late / (Present + Late) * 100`. Alfa rate uses the attendance-rate
denominator. Percent deltas use percentage points.

Academic average uses the stored non-null 0–100 scores and the existing
round-half-even rule to one decimal. Academic participation is scored result
slots divided by expected result slots. Missing scores are not numeric zero.
Academic indicators continue to expose current values only. Session-backed
academic trend is descriptive Student Trend output and is not automatically a
Stage 2 risk indicator.

### Missing data and boundary

Each value includes sample sizes and a data status. `not_applicable` means the
student has no applicable data. `insufficient_data` means a current value may
exist, but a comparable previous value is unavailable. No zero is substituted.

The Stage 2 surface contains no threshold, risk score, risk level, alert,
intervention, recommendation, or prediction. Staff judgment remains
authoritative. Threshold validation is a later stage.

## Class Overview (2026-08)

Class Overview is the canonical class-level operational surface at
`/classes/:id`. It uses the selected academic class and its current canonical
enrollment roster. Duplicate enrollment rows are reduced to one student.

- The class header uses the academic class, jenjang, grade, and academic year
  masters.
- Attendance reuses Attendance Analytics effective-status counts and rates.
  The default date range is the class academic-year range.
- Academic results reuse Academic Analytics score and participation rules.
  A selected term uses session-backed results. All-period results may include
  legacy scores with unknown period attribution and state that limitation.
- Data completeness reuses Data Quality student issue semantics. It provides
  context only. It does not classify students.
- Non-admin staff can open a class only when an active current assignment
  exists for that class and academic year. Filters narrow this server-side
  scope.
- The page links to Student 360 and the detailed Attendance, Academic, and
  Data Quality surfaces. It adds no rollups, formulas, roles, or exports.

## Daily Attendance Operations (2026-09)

Daily Attendance Operations reports attendance-recording coverage for one
selected `YYYY-MM-DD` date. It uses active, date-effective enrollments and
distinct students with an attendance row for that date.

- `COMPLETE` means recorded students equal expected active enrolled students.
- `PARTIAL` means recorded students are greater than zero and lower than the
  expected count.
- `NONE` means no attendance record exists for a non-empty class.
- `EMPTY_CLASS` means the date-effective expected student count is zero.
- `unrecordedStudentCount` is the server-side difference between expected and
  recorded students. It is never converted to `Alfa`.
- Status counts use effective status. `COALESCE(override_status, status)` is
  counted once per student.
- A `coveragePercent` is not applicable for an empty class and returns `null`.
- Recording coverage remains separate from the School Calendar expectation.
  `NONE` means `No attendance recorded`; it is not an overdue or failed
  submission state.

## School Calendar & Attendance Expectation (2026-09)

The Attendance Calendar is the canonical, local authority for whether
attendance is expected for a date and jenjang. It does not define a deadline,
submission lateness, or overdue state.

- `EXPECTED` comes from a configured jenjang weekday rule or an explicit date
  exception.
- `NOT_EXPECTED` comes from an explicit date exception or configured jenjang
  weekday rule.
- `UNKNOWN` means no configured rule applies, or the date is outside the
  selected academic year. It is never converted to either other state.
- A date exception overrides the recurring weekday rule. This also supports a
  replacement school day by explicitly setting `EXPECTED` on a normally
  non-attendance weekday.
- Rules are scoped by academic year and jenjang. Class-specific and
  school-wide exceptions are not represented because current school data does
  not establish those authorities.
- Existing attendance rows are evidence that records exist. They do not
  create recurring calendar rules or backfill historical expectation.
- Daily Attendance displays calendar expectation separately from recording
  coverage. `EXPECTED` with no records is not an overdue status.

## Academic Assessment Operations (2026-09)

Assessment Operations reports score-entry coverage for session-backed academic
records. Its API is `/api/grades/assessment-operations` and is available under
the current administrator-only grade-entry authority.

The operational row is a `session × class × subject` scope. The current
assessment-session table stores the academic year, term, label, and optional
assessment date, but it does not store class or subject ownership. The page
therefore does not claim that a session belongs to one class or subject.

- Sessions with a non-null assessment date use active, class-assigned,
  canonical student-master enrollments effective on that date.
- Sessions without an assessment date use the active enrollment snapshot for
  the selected academic year. The UI shows `Date not recorded` and never uses
  `created_at` as a substitute.
- `applicableStudentCount` is the distinct active canonical student count for
  the class scope. Duplicate enrollment rows contribute one student.
- `recordedScoreCount` is the distinct applicable-student count with at least
  one canonical non-null score for the session and subject. A valid score of
  zero is recorded data. A null score is not recorded.
- Legacy grade rows without `assessment_session_id` are period-unknown and are
  excluded from operational session coverage. Out-of-scope score rows do not
  increase coverage.
- `unrecordedScoreCount` is the server-side difference between applicable and
  recorded students. It is not a failure, absence, overdue state, or risk
  signal.

Coverage states are neutral data-entry states:

- `COMPLETE`: applicable students are greater than zero and all have a
  recorded score.
- `PARTIAL`: at least one, but not all, applicable students have a recorded
  score.
- `NONE`: applicable students exist and no score is recorded.
- `EMPTY`: no applicable students exist.

Coverage percentages use the existing round-half-even convention to one
decimal place and are null for `EMPTY`. The endpoint uses bounded server-side
aggregation and returns only the requested page. It does not create scores,
averages, KKM decisions, deadlines, rollups, alerts, or risk classifications.
