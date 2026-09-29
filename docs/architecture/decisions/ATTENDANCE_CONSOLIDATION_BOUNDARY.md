# Attendance consolidation boundary

- Status: C0 decisions recorded; phase validation in progress
- Audit date: 2026-09-29
- Baseline: `f2c494c540a0d90010b62e00b8351888c72ef8b3`
- Scope: C0 audit and documentation only. No runtime or schema behavior changed.

## C0 result

The canonical denominator for consolidated reports is Attendance Calendar
expectations combined with date-effective Enrollment. Current reports still
use additional event and HEB ratios, so the repository has
`MULTIPLE_LIVE_DENOMINATORS`.

The manual monthly ledger is `LEDGER_NOT_LOCKED`. Existing finalization is
attendance-date scoped and does not block monthly Sakit/Izin/Alfa edits.

The operator resolved the source, unit, entry-mode, completion, lock, and
historical-cutoff decisions on 2026-09-29. C0 remains documentation-only. Its
gate is issued after this change passes docs validation and merges.

## Audit findings

### Expected dates and Student-Days

`attendance_calendar_weekday_rules` and `attendance_calendar_exceptions` are
scoped by Academic Year and Jenjang. An explicit date exception wins over the
weekday rule. Dates outside the Academic Year and dates without an applicable
rule resolve to `UNKNOWN`. Existing attendance rows do not create calendar
expectations.

Term Attendance enumerates one row for each date-effective enrollment and
student. Null enrollment bounds use the selected Academic Year bounds. Only
`EXPECTED` rows enter `expected_student_days`; `NOT_EXPECTED` rows are excluded.
`UNKNOWN` rows are excluded and reported in quality fields. Overlapping
effective enrollments fail the calculation.

On an expected Student-Day, an absent attendance row is `unrecorded`. Effective
status comes from `COALESCE(attendance_overrides.override_status,
attendance.status)`. `on-time` and `late` count as Hadir. `sakit`, `izin`, and
`alfa` are canonical daily statuses. A present row with a null or unsupported
status is counted as another status and as recorded coverage, not as an absent
row; report readiness is false. `NOT_EXPECTED` and `UNKNOWN` never become Alfa.

Approved overrides change the effective canonical status and may change the
effective check-in time. They do not change calendar expectation. The override
and correction workflows retain review metadata and audit history.

### Denominator decision

Future consolidated canonical Attendance Rate uses:

```text
Hadir / Expected Student-Days
```

Future consolidated Coverage uses recorded expected Student-Days divided by
Expected Student-Days. Expected days without a canonical record remain
Unrecorded in both coverage reporting and the Attendance Rate denominator.
Unknown calendar state remains visible and is never silently treated as
expected.

`heb_overrides` is not an Expected Student-Day authority. It stores an integer
day count for `(jenjang label, calendar month, calendar year)`. In the shared
`calculateHeb` helper, the override replaces a fallback estimate based on the
median check-in-day counts of up to five students. The assigned-class workbook
uses the same override but otherwise counts dates with attendance rows. The
Attendance Analytics `hebTotal` field sums configured overrides only. Tardiness
exports also show HEB, while their canonical Late Event Rate uses Expected
Student-Days. Keep HEB as a separate legacy display value; it must not replace
or be added to the canonical denominator.

The active formulas differ:

- Term Attendance and Term Lateness use the Attendance Calendar and
  date-effective Enrollment for Expected Student-Days.
- Attendance Analytics uses recorded `on-time`, `late`, `sakit`, `izin`, and
  `alfa` events for Recorded Presence Rate. Missing expected days are absent
  from this event-only denominator.
- Student Profile and assigned-class exports use HEB-based ratios. Their HEB
  fallback calculations differ.
- Tardiness `late_event_rate` uses Expected Student-Days. Its compatibility
  `school_impact_rate_pct` uses recorded dates as its denominator.
- Monthly Management and Executive report attendance rates are unavailable;
  they do not have a compatible expected-day denominator.

### Lateness authority gap

Term Lateness compares ordinary effective check-ins with
`jenjang_config.cutoff_time` at read time. That table stores one mutable cutoff
per Jenjang and has no effective dates or history, so historical check-ins are
reclassified against the current cutoff. Machine imports also persist a
status and duration derived from the cutoff at preview time. Term Lateness
uses effective check-in as the time authority; a status-only override still
asserts its effective status without inventing a duration.

Replace this policy authority with append-only `jenjang_lateness_policy`
history keyed by `jenjang_id` and `effective_from`, with `cutoff_time`,
`source` (`RECORDED` or `BACKFILL_ASSUMED`), `created_by`, `created_at`, and
`reason`. Resolve the latest policy whose `effective_from` is on or before the
attendance date. The operator confirmed cutoff-only behavior; do not add
lateness grace in this program.
`attendance_submission_deadlines` remains a separate same-day submission
deadline.

During migration, create one `BACKFILL_ASSUMED` policy per Jenjang with
attendance history. Use that Jenjang's earliest attendance date and current
configured cutoff. Record the migration as actor and label the reason as an
explicit backfill assumption. If a used Jenjang has no configured cutoff,
fail migration preflight without partial changes; do not invent a cutoff.
Reports identify dates covered only by a `BACKFILL_ASSUMED` policy. Normal
policy changes take effect on a current or future date and cannot backdate
over covered history. Historical recomputation requires a separate previewed
and audited admin operation, outside this program.

### Manual ledger, identity, and state

The current operator input is totals-only. The administrator form sends
`academic_year_id`, `class_id`, and month, then saves Sakit/Izin/Alfa integer
fields to `absence_reason_class_entries`. The table stores `class_name`,
calendar `month` and `year`, values, note, `entered_by`, `entered_at`, and
`updated_at`. The save path discards the submitted Academic Year and class IDs.
Reads match class names in the selected year's class inventory. The current
TypeScript schema does not declare a unique key for these rows; application
code selects the latest matching row by ID.

The operator selected Student-Days as the unit: each value counts school days
on which a student had that reason. Keep nonnegative integer validation. A
submitted class total must not exceed known Expected Student-Days.

Row presence currently means saved data: the page labels it `Tersimpan`, and
report completeness counts an existing class-month row. A zero row is explicit
data; a missing row is not zero. New rows start `OPEN`; saving is a draft, and
only explicit submission makes a declaration authoritative. Existing
class-total rows migrate as `SUBMITTED` with `legacy_saved` provenance and the
migration actor, preserving current report output without inventing an
individual submitter. The ledger stores only `OPEN` and `SUBMITTED`; it has no
stored `CLOSED` state.

The database also has `absence_reasons`, keyed by `student_id`, class name,
calendar month, and year, with student-level Sakit/Izin/Alfa integer fields and
entry metadata. It stores neither `academic_year_id` nor `class_id`. Current
TypeScript report, analytics, Student Profile, and export code reads this
table. No current TypeScript API writes it. Treat it as historical-only:
exclude it from consolidated totals and label any retained display as legacy.
Do not promote these rows to `PER_STUDENT`; their provenance, units, and
completeness are unknown. Any conversion requires a separate previewed
per-class-month operation. Several readers coalesce missing rows to zero, but
the table has no completion marker, so missing rows are not proven explicit
zero.

Each new class-month has exactly one explicit entry mode:

- `TOTALS_ONLY`: submitted class-level Student-Day totals are authoritative.
- `PER_STUDENT`: sparse student-month reason rows are authoritative; class
  totals are derived and never stored as editable values.

The modes are mutually exclusive. Changing mode requires reopening with a
reason. Prior values stay in append-only revision history but are not effective
under the new mode. Do not fabricate student-level reasons from totals.

The `attendance_periods` authority finalizes one `attendance_date`; its
reopen path uses the existing capability, version check, reason, and
append-only audit. Canonical daily attendance, imports, and corrections check
this lock. The monthly class-total save path does not. A class-month ledger is
locked when any finalized attendance date overlaps its calendar month. Reopen
removes the derived lock only when no finalized date still overlaps. Do not
store a third `CLOSED` ledger state. Before date finalization, warn and require
explicit acknowledgement when a class-month with no canonical coverage still
has a missing or `OPEN` ledger. This is a warning, not a hard block. A finalized
scope without a submitted ledger is `NOT_REPORTED`.

### Report source matrix

| Surface | Source authority and basis | Denominator and time scope | Class identity | Exports |
| --- | --- | --- | --- | --- |
| Attendance Analytics | `attendance` plus effective `attendance_overrides`, joined to date-effective Enrollment. Canonical recorded events only. | Recorded Presence Rate uses recorded `on-time`, `late`, `sakit`, `izin`, and `alfa`; date range plus Academic Year. It does not use Expected Student-Days. `hebTotal` is a separate sum of configured overrides. | `academic_class_id` when resolved. | Server-generated Excel from the same event aggregates. |
| Attendance Report | Canonical totals from Term Attendance plus a separate manual class-total projection from `absence_reason_class_entries`. Student detail is event-only. | Canonical totals use Expected Student-Days. Manual S/I/A values use Student-Days but remain a separate projection without basis or reconciliation. Period can be month, term, bimonthly, semester, year, or date range; manual data includes full intersecting months. | Term totals use class IDs and historical attribution. Student detail uses the selected-year enrollment join. Manual storage uses class-name strings. | Browser-generated CSV formats the server DTO without recomputing metrics. |
| Attendance Recap | `buildRekap` returns the Attendance Report's manual class-total section. | Manual calendar month(s); no attendance denominator. Missing class-months remain incomplete. | Request uses class ID; stored identity is class name plus calendar month/year. | Server-generated Excel and browser print. |
| Tardiness Report | Term Lateness event tally, effective attendance status/check-in, and current `jenjang_config` cutoff. Canonical attendance only. | Late Event Rate uses Expected Student-Days. Compatibility school-impact rate uses distinct dates with recorded attendance. Period can be month, term, or date range. Future cutoff authority is effective-dated history with an explicit backfill-assumption indicator. | Historical class attribution is resolved internally; the report projection groups by displayed class name. | Server-generated detail and management-summary Excel workbooks. |
| Monthly Management Report | `buildMonthly` reads monthly attendance events and the existing student-level `absence_reasons` table. The two sources remain separate; attendance rate is null. | Selected calendar month; population comes from the selected Academic Year enrollment snapshot, not date-effective monthly enrollment. No Expected Student-Day attendance denominator. | Selected-year enrollment/class mapping; filters accept class ID and legacy name. | Server-generated PDF and Excel. |
| Executive Reports | Monthly/annual `buildMonthly`/`buildAnnual` data, including attendance events and student-level `absence_reasons`. Attendance rate has no compatible denominator. | Selected month or Academic Year; annual values sum monthly report results. | Selected-year enrollment/class mapping. | Server-generated PDF and Excel. |
| Management Review Excel | Term Attendance and Term Lateness. Canonical attendance only. | Academic Year and configured term; Expected Student-Days for attendance and lateness rates. | Stable class IDs with historical class attribution; student identity uses master ID where available. | Server-generated Excel workbook. |

The current data paths and formulas are implemented in `apps/api/src/domains/attendance-analytics.ts`, `term-attendance.ts`, `term-lateness.ts`, `manual-absence.ts`, `attendance.ts`, `heb.ts`, `reports.ts`, and `management-review-attendance.ts`. Shared persistence shapes are in `packages/db/src/schema.ts`; manual request and response shapes are in `packages/contracts/src/reports/manual-absence.ts`.

Tests inspected include `attendance-calendar.test.ts` for exception
precedence and unknown dates, `term-attendance.test.ts` for expected-day
counts, overrides, and enrollment windows, and `term-lateness.test.ts` for
cutoff behavior and expected-day rates. `attendance-analytics.test.ts` covers
recorded-event analytics. The `reports.test.ts` case `keeps monthly class
absence entry separate and reconciles reports, Term, and export` verifies
missing versus saved-zero class-months, export totals, and no change to
canonical Term Attendance or Analytics totals after a manual save. The current
live metric reference is `docs/analytics/METRICS.md`.

## Proposed C1-C4 contract

These requirements implement the operator decisions recorded above.

Canonical attendance remains the authority for Hadir, Expected Student-Days,
Unrecorded, and lateness. The selected manual ledger may provide only the
manually declared Sakit/Izin/Alfa reason split. It must never write canonical
attendance or fabricate check-ins or lateness.

### C1 minimum persistence requirements

- Preserve both existing manual sources and their historical values.
- Use stable `(academic_year_id, class_id, month)` identity for new class-month
  records. Do not discard IDs received from the current form.
- Migrate existing class-total rows as `SUBMITTED`, with `legacy_saved` and
  migration actor provenance. Do not backfill per-student reasons.
- Resolve each existing class-name/month/year row to exactly one stable class
  and Academic Year using month overlap. Preflight must fail before writes if
  any row has no unique mapping. Preserve duplicate source rows as revisions;
  select the same latest effective value that current reports select.
- Store exactly one `TOTALS_ONLY` or `PER_STUDENT` mode per class-month. In
  `PER_STUDENT`, use sparse meaningful student-month reason rows and derive
  class totals without storing editable aggregate values.
- Validate each student's S/I/A Student-Days against known expected days; for
  `TOTALS_ONLY`, validate the class sum against known Expected Student-Days.
- Preserve the difference between missing data and explicit zero.
- New saves start `OPEN`; explicit submission changes state to `SUBMITTED`.
  Reopening a submitted ledger requires a reason and appends a revision.
- Do not store `CLOSED`. Derive the monthly lock when any finalized
  `attendance_periods.attendance_date` overlaps the calendar month. A period
  reopen removes the lock only when no finalized date still overlaps.
- Reuse attendance period authorization and audit patterns. Warn before date
  finalization when a class-month without canonical coverage has a missing or
  `OPEN` ledger; require acknowledgement but do not block finalization.
- Preserve prior entry-mode values in append-only revision history. Corrections
  while locked require the existing audited correction authority or period
  reopen, and each accepted change creates a revision rather than overwriting.
- Retain nonnegative-count validation, SQLite fresh-database parity, encrypted
  backup/restore coverage, and existing student-data access controls.
- If persistence changes, validate migration and rollback safety, fresh parity,
  foreign keys/indexes/uniqueness, completion and period-lock behavior, and
  backup/restore. Do not broaden student-level data exports.

### C2 resolver requirements

- One server-owned resolver composes Term Attendance, Term Lateness,
  Attendance Calendar, Enrollment, and the selected manual authority.
- `OBSERVED` means canonical daily evidence exists in the selected scope.
  Partial coverage remains `OBSERVED`; return expected, recorded, unrecorded,
  and coverage separately.
- `DECLARED` requires no canonical daily evidence and a completed declaration
  under the approved source and completion rules.
- `TOTALS_ONLY` declared values are submitted class-level Student-Days.
  `PER_STUDENT` values are submitted sparse student-month rows; class totals
  are derived from those rows.
- `NOT_REPORTED` means neither canonical evidence nor a completed declaration
  exists.
- `CONFLICT` is a separate flag, not a basis. Compare values only when units
  and scopes match. Never auto-resolve.
- For `DECLARED`, derive read-only presumed Hadir as known Expected
  Student-Days minus submitted S/I/A Student-Days. Reject values above the
  denominator; never persist presumed Hadir.
- Reconcile class-month totals only when units and scopes match. Compare
  `Expected Student-Days - Hadir` with declared S/I/A only when canonical
  expected coverage is complete and all expected statuses are resolved.
  Partial canonical coverage is not a conflict by itself. Missing rows never
  mean zero.
- Lateness stays canonical-only. A declaration without canonical arrival
  evidence has unavailable lateness, not zero lateness.
- Keep basis, coverage, and conflict fields in shared TypeBox DTOs. Do not add
  persisted rollups or thresholds.
- Add a narrow architecture check so future mixed-source Attendance reports
  use the resolver. Keep direct canonical service use available to unrelated
  callers.
- Cover complete and partial `OBSERVED`, submitted `DECLARED`, open and missing
  ledger states, matching/partial/conflicting declarations,
  mid-month enrollment, class transfer, HEB override, zero expected days,
  supported entry modes, approved corrections, and unavailable lateness.

### C3 input workflow requirements

- Move Monthly Recap Input under Attendance and keep `/config/absence-reasons`
  compatible.
- Show Academic Year, month, class, saved/completion state, expected-day
  context, canonical observations, editable S/I/A values, and read-only derived
  values.
- Show conflicts before submission. Never write manual values to canonical
  attendance or fabricate student-level reasons.
- Keep legacy `absence_reasons` data in a labeled, read-only legacy view and
  exclude it from consolidated totals.
- Keep direct UI entry unless a later phase proves an Excel template is useful.
- Cover the synthetic save, submit, resolve, reopen, audited edit, and
  updated resolver sequence for every approved state transition.
- Show a clear derived locked state when a finalized date overlaps the month.
  Verify the pre-finalization warning and acknowledgement for uncovered
  class-months.

### C4 destination and display requirements

- Consolidate Analytics, Report, Recap, and Tardiness as distinct views under
  Attendance. Keep legacy routes compatible.
- Keep `/analytics/attendance`, `/reports/attendance`,
  `/reports/rekap-absensi`, `/reports/tardiness`, and
  `/config/absence-reasons` compatible with their corresponding views or input
  workflow.
- Render only the active view. Remove duplicate navigation entries and
  redundant summary cards; retain charts only for distinct questions.
- Show basis at section or row level as appropriate. Partial `OBSERVED` data
  must show coverage and Unrecorded. Do not rely on color alone.
- Show conflict details with class-month, canonical value, declared value,
  delta, and explanation; do not auto-resolve.
- For `DECLARED` scopes without canonical arrivals, show lateness unavailable.
- Keep server-owned values and current useful exports in parity. Include basis
  in exports where it varies by row; use sheet metadata when one basis applies.
- Give shared filters one TanStack Query owner. Keep view-specific data queries
  separate.

## Resolved operator decisions

- Sakit/Izin/Alfa values use Student-Days. `TOTALS_ONLY` and `PER_STUDENT` are
  mutually exclusive per class-month. In `PER_STUDENT`, class totals are
  derived and never stored as editable values.
- Existing `absence_reasons` rows are historical-only, excluded from
  consolidated totals, and labeled legacy wherever retained. They are not
  promoted to `PER_STUDENT`.
- New saves are `OPEN`; submission is explicit. Existing class-total rows
  migrate as `SUBMITTED` with `legacy_saved` and the migration actor. The
  ledger has no stored `CLOSED` state.
- A finalized attendance date overlapping a month derives the ledger lock.
  Finalization warns for uncovered class-months with no submitted ledger and
  requires acknowledgement without blocking.
- Lateness uses an effective-dated cutoff. Migration adds a visible
  `BACKFILL_ASSUMED` record from each Jenjang's earliest attendance date using
  its current cutoff. No history is recomputed implicitly. This phase has no
  lateness grace field or behavior.
- Presumed Hadir is available only for a submitted `DECLARED` scope with known
  Expected Student-Days. Reconciliation requires compatible Student-Day units
  and complete canonical coverage; partial observed data stays `OBSERVED` and
  does not produce a false conflict.

These decisions close the C0 product gate. C1 begins only after this
documentation-only phase is validated and merged into `origin/main`.
