# OperatorOS metric and filter contract

This file is the live authority for Analytics & Reports metric names,
formulas, denominators, missing data, and source limits. Server services own
the calculations. Web pages and exports format returned values.

## Canonical attendance and lateness registry

| User-facing name | Stable key | Numerator | Denominator | Unit and zero behavior | Missing/unknown data | Canonical owner | Allowed alternate name | Source limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Expected Student-Days | `expected_student_days` | Not applicable | Not applicable | Student-Day count; zero is valid | Unknown calendar dates are reported separately and excluded from known expected-day totals | `term-attendance` via Attendance Calendar and date-effective Enrollment | None | Never estimate from recorded status counts or current class size |
| Hadir | `hadir_count` | Expected-day records with effective status `on-time` or `late` | Not applicable | Student-Day count; zero is valid | Unrecorded expected days are separate; unknown statuses are reported as other status | `term-attendance` | Present, only where existing English UI requires it | Late remains Hadir |
| Attendance Rate | `attendance_rate` | Hadir | Expected Student-Days | Percent; null when denominator is zero | Unrecorded expected days remain in the denominator; unknown calendar dates are disclosed separately | `term-attendance` | None | Attendance Calendar plus date-effective Enrollment define expected days |
| Coverage | `coverage_rate` | Recorded expected Student-Days | Expected Student-Days | Percent; null when denominator is zero | Unrecorded expected days reduce coverage; unknown calendar dates are disclosed separately | `term-attendance` | Recording Coverage | Coverage measures records, not attendance presence |
| Late Events | `late_events` | Attendance events classified as late under canonical Term Lateness rules | Not applicable | Event count; zero is valid | Events without usable duration remain events and are counted separately | `term-lateness` | Late arrivals, only in descriptive copy | A non-expected-day late event may still be counted; it does not add an expected day |
| Students Affected | `affected_students` | Distinct students with one or more Late Events | Not applicable | Student count; zero is valid | Depends on canonical event and student identity resolution | `term-lateness` | None | Distinct students, not event count |
| Total Late Minutes | `total_late_minutes` | Sum of known late-event durations | Not applicable | Minute count; zero is valid | Unknown-duration events are reported separately; zero can mean no known minutes | `term-lateness` | None | Does not infer missing duration |
| Average Late Minutes | `average_late_minutes` | Total Late Minutes | Late Events with known duration | Minutes per event; null when denominator is zero | Events with unknown duration are excluded from this denominator | `term-lateness` | Average Minutes Late | Not the average across all late events when some durations are unknown |
| Late Event Rate | `late_event_rate` | Late Events | Expected Student-Days | Percent; null when denominator is zero | Unknown calendar dates are disclosed separately | `term-lateness` | None | Management-facing canonical rate; not Late Events divided by Hadir |
| Late Among Present | `late_among_present` | Late attendance events | Hadir attendance events (`on-time` plus `late`) | Percent; null when Hadir is zero | Missing attendance rows are not in this event-only denominator | Attendance Analytics and Student Profile summary where retained | None | Event-only descriptive ratio. Never label it Late Event Rate or generic Tardiness Rate |
| Late-affected recorded-day rate | `school_impact_rate_pct` (legacy API field) | Distinct dates with at least one late event | Distinct dates with any non-skipped attendance record | Percent; null when denominator is zero | Dates without recorded attendance are excluded | Legacy Tardiness Report service | None | Compatibility field only; denominator is recorded dates, not Attendance Calendar days or Expected Student-Days |
| Recorded Presence Rate | `recorded_presence_rate` (legacy DTO fields may retain `attendance_rate`) | `on-time` plus `late` attendance events | `on-time` + `late` + `sakit` + `izin` + `alfa` recorded events | Percent; null when denominator is zero | Incomplete, Absent, Unrecorded, and unrecorded expected days are not in the denominator | Attendance Analytics; reused by Class Overview and Management Overview | None | Recorded-status ratio; it is not canonical Attendance Rate |
| Recorded Attendance Rate | `recorded_attendance_rate` | Hadir | Recorded expected Student-Days | Percent; null when denominator is zero | Unrecorded expected days are excluded by definition | `term-attendance` | None | API-only compatibility metric; do not label it Attendance Rate |
| Recorded Presence / HEB | `student_presence_heb` (legacy DTO field `attendance_rate`) | Student `on-time` plus `late` events | Monthly HEB override, or legacy median estimate from the five highest student check-in counts in the jenjang | Ratio; null when HEB is zero | Missing attendance events do not create a numerator; missing HEB gives unavailable | Shared `heb` helper, Student Profile API, and Student Attendance Excel export | None | Legacy estimate, not Expected Student-Days; not comparable to canonical Attendance Rate |
| Recorded Presence / Class Days | `class_recorded_presence` (legacy class-export cell) | Student `on-time` plus `late` events | Distinct class dates with attendance rows, or the manual monthly HEB override | Ratio; blank when denominator is zero | Dates without any class attendance row are excluded; incomplete and unrecorded events do not enter the numerator | Assigned Class Attendance Excel export | None | Legacy class-day denominator; differs from Student Profile's HEB estimate and is not Expected Student-Days |
| Grade Average | `grade_average` | Sum of non-null `student_subject_grades.score` values | Count of non-null grade scores | Score; null when no score exists | Null scores are excluded, not treated as zero | Academic Analytics | Average Score | Academic-year scope; grade rows have no date field |

`term-attendance` counts Late within Hadir. The canonical Attendance Rate is
Hadir divided by Expected Student-Days. Its denominator includes expected
days recorded as Hadir, Sakit, Izin, Alfa, or Unrecorded.

The canonical Attendance Rate and Late Event Rate return `null` when their
Expected Student-Days denominator is zero. Web displays use the existing
unavailable convention (`—` or `Not Available`). APIs do not substitute zero.

Attendance Analytics still exposes compatible DTO fields such as
`attendanceRate` and `tardinessRate`. Its event-only values are labeled
Recorded Presence Rate and Late Among Present. Student Insights uses the
canonical expected-day Attendance Rate and Late Event Rate. DTO field names
remain compatibility identifiers.

## Separate manual monthly S/I/A ledger

The `absence_reasons` monthly ledger is separate from canonical student-level
attendance events. Executive Reports, Monthly Management Report, and retained
legacy summaries may show both raw sources. They do not add manual Sakit,
Izin, or Alfa counts to canonical Hadir to construct a percentage. Their
Attendance Rate and combined completeness rates are unavailable until a
compatible denominator exists. Raw counts remain available with source labels.

## Class and term filter contracts

- `class_id` is the canonical application and API identity when available.
  Class names are display labels and may change or repeat.
- Executive and Monthly Management report requests use `class_id`. The
  backend still accepts legacy `class_name` requests at the report boundary.
  If both appear, `class_id` takes precedence.
- `term_id` identifies an actual configured Academic Term record. It is the
  canonical identity when a page selects a persisted term.
- Academic Analytics `term_1` through `term_4` are grading-period categories
  backed by `academic_assessment_sessions.term_number`. They are not term IDs.
- Historical Management Analytics `term_1` through `term_4` select configured
  or default reporting date ranges. They retain that endpoint's legacy
  category contract and do not replace `term_id`.
- Student Insights `window=term` selects a comparison
  window around the latest observed attendance date. This is not a term
  identifier and does not imply `term_id` equality.

## Service and export ownership

- Term Attendance owns Expected Student-Days, Hadir, Attendance Rate, and
  Coverage. It uses Attendance Calendar and date-effective Enrollment.
- Term Lateness owns Late Events, Students Affected, Total Late Minutes,
  Average Late Minutes, and Late Event Rate.
- Management Review Excel continues to use canonical Term Attendance and
  Term Lateness. Its metrics remain the parity reference when scopes match.
- API DTOs are the business-value source for Web, Excel, and PDF output.
  Exports must not independently recompute the same named metric.
- `GET /api/reports/filters` has one Web query owner in `useReportFilters`.
  Executive Reports and Monthly Management Report use the same query key.
- The legacy `management-summary` endpoints remain because the report builder
  and export routes still call `managementSummary`. They are retained for
  compatibility, not current metric authority. Retirement requires a separate
  caller and compatibility review.

## Other metric contracts

### Attendance event scope

Attendance Analytics uses effective status
`COALESCE(attendance_overrides.override_status, attendance.status)`. It applies
the selected academic-year and inclusive date filters and canonical class IDs.
The monthly `absence_reasons` ledger is not joined to event aggregates.
Override percentage is corrected events divided by selected events; a zero
selected-event denominator is unavailable.

### Grade average

The overall average is the sum of non-null scores divided by their count. It
does not average group averages. The API uses the existing round-half-even
rule to one decimal. Grade rows have no date field, so term analysis includes
only rows attributed through assessment sessions. Period-unknown legacy rows
are excluded from term-filtered results.

### Shared rules

- Stable IDs drive filters and cohort queries. Names are display data.
- Zero, unavailable, and not-applicable are distinct states.
- Missing or unknown data is never reclassified as an absence.
- No persisted analytics rollups or materialized aggregates are used.

## Population Overview (2026-08)

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

The Data Quality resolution workspace is a derived read-only projection of
these same findings. Each finding is classified as `MISSING`, `UNKNOWN`, or
`UNMAPPED`, then mapped to `EDITABLE_IN_OPERATOROS`,
`VIEW_ONLY_IN_OPERATOROS`, `EXTERNAL_SOURCE_REQUIRED`, or
`UNSUPPORTED_CORRECTION`. An edit action is returned only when the existing
canonical editor and the actor's write capability both apply. The workspace
does not persist issue rows, provide a mark-resolved action, or perform
automatic or bulk correction. After a canonical source edit, the finding
disappears when the projection is queried again.

Student profile and enrollment findings use `/students/:id`, with
`edit_student` or `manage_enrollment` respectively. Staff education and
jenjang findings use `/staff/:id` with `manage_staff`. Imported staff
employment-status and job-title findings remain external-source findings
because no local canonical editor exists for those fields.

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
  required term number and an optional known assessment date. `term_1` through
  `term_4` select grading-period categories through `term_number`. They are not
  `term_id` values. `academic_term_configs` supplies the configured date ranges
  and ordering; default periods apply only when no custom row exists. Academic
  year remains a broad scope, not a precise assessment period.
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
- Attendance displays Recorded Presence Rate from Attendance Analytics. It
  uses recorded statuses only and does not replace canonical Attendance Rate.
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

## Student Insights (2026-09)

Student Insights is `/analytics/student-insights` with separate Trends and
Indicators views. `/analytics/trends` and `/analytics/indicators` remain
compatible links that open the corresponding view.

- Trends describes period-to-period change. Attendance deltas are current
  Attendance Rate minus previous Attendance Rate, in percentage points.
- Indicators presents current-period measurements. It does not classify
  students or recommend action.
- `rolling_4w` compares the latest observed attendance date and preceding 28
  calendar days with the previous 28 calendar days. The schema has no
  instructional-day calendar.
- `window=term` selects the configured or default comparison window containing
  the latest observed attendance date. It is a window selector, not a Term ID.
  The previous window is an elapsed-calendar-day comparison.
- Attendance Rate is Hadir divided by Expected Student-Days. Hadir includes
  effective `on-time` and `late` statuses. Expected Student-Days come from the
  Attendance Calendar and date-effective Enrollment. Sakit, Izin, Alfa, and
  Unrecorded expected days remain in its denominator.
- Late Event Rate is canonical Late Events divided by Expected Student-Days.
  Late Events use Term Lateness cutoff, check-in, and effective-status rules.
- Alfa Rate is Alfa divided by Expected Student-Days.
- Zero Expected Student-Days returns `null` for these rates. The API and Web do
  not replace an undefined value with `0%`.
- Student Insights uses the shared server-owned period aggregation backed by
  Term Attendance and Term Lateness. It does not use the Recorded Presence
  Rate or Late Among Present formulas.
- Percent deltas use percentage points. API sample sizes are Expected
  Student-Days. A trend comparison without both values has `insufficient_data`
  direction and does not invent a zero.

Academic trend is available only when session-attributed scores exist for two
adjacent grading-period categories. It compares the mean scored result in the
latest observed category with the immediately preceding observed category and
returns both sample sizes. The categories use `term_number`, not `term_id`.
Period-unknown legacy rows remain excluded. The feature does not infer a time
axis from score IDs or write trend snapshots, rollups, thresholds, risk labels,
alerts, or interventions.

## Student Insights API fields

The existing endpoint and DTO fields remain for compatibility. `tardiness_rate`
is the stable field ID for the canonical Late Event Rate; it does not mean
Late Among Present.

| ID | User-facing name | Source and formula | Unit | Missing data and limitations |
| --- | --- | --- | --- | --- |
| `attendance_rate` | Attendance Rate | Term Attendance: Hadir / Expected Student-Days | Percent; null when denominator is zero | Unrecorded expected days remain in denominator; Late remains Hadir |
| `tardiness_rate` | Late Event Rate | Term Lateness: Late Events / Expected Student-Days | Percent; null when denominator is zero | Events may occur on a non-expected day, but add no denominator day |
| `alfa_rate` | Alfa Rate | Term Attendance: Alfa / Expected Student-Days | Percent; null when denominator is zero | Unknown calendar days are excluded and disclosed by canonical services |
| `academic_average` | Academic average | Academic Analytics score average | Score | Null without a scored result; grade rows have no date or term field |
| `academic_participation` | Academic participation | Scored result slots / expected result slots | Percent | Null when there are no expected result slots |

Attendance indicators use the same expected-day calculations as Trends and
Term Attendance or Term Lateness. Manual monthly Sakit, Izin, and Alfa ledger
values are not combined with canonical student attendance. Percent comparison
fields use percentage points. The Indicators view displays current values
only; existing API comparison fields remain for compatibility.

Student indicators are transparent measurements. They are not classifications.
The surface contains no threshold, risk score, risk level, alert, intervention,
recommendation, or prediction. Staff judgment remains authoritative.

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

## Attendance Submission Deadline Authority (2026-09)

Submission timing is a third independent dimension beside calendar expectation
and attendance recording coverage. The authority is scoped to one academic
year and jenjang, stores an optional same-day local `HH:MM` cutoff, and uses
`Asia/Jakarta`, the existing school timezone authority.

- `BEFORE_DEADLINE` means the date is `EXPECTED`, a cutoff is configured, and
  school-local time is at or before the configured minute.
- `DEADLINE_PASSED` means the date is `EXPECTED`, a cutoff is configured, and
  school-local time is after that cutoff. Exact equality is before deadline.
- `DEADLINE_UNKNOWN` means expectation is unknown or expected attendance has no
  configured deadline. No default cutoff is invented.
- `NOT_APPLICABLE` means calendar expectation is `NOT_EXPECTED`.
- Configuration applies to the selected academic year as current policy. No
  historical deadline backfill or versioned past-policy claim is made.
- `DEADLINE_PASSED` is a factual timing state. It does not mean staff failure,
  negligence, poor performance, violation, alert, or intervention.
- Daily Attendance keeps expectation, recording coverage, and submission timing
  separate. Expected plus no records is never automatically called overdue.

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
