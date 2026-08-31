# Risk Threshold Validation

Status: `OPERATOROS_RISK_THRESHOLD_VALIDATION_NEEDS_REAL_CASES`

This is the Stage 3 validation authority. It does not create `AT_RISK`, a
risk score, a risk level, alerts, interventions, recommendations, or persisted
student risk state. Candidate cutoffs are never production rules.

## Current gate

```text
THRESHOLD_VALIDATION_BASE_SHA: cc432d9b3926bb975df00ded3d1b35905578e4e6
REAL_CASES_PRESENT: NO
TOTAL_CASES: 0
FOLLOW_UP_WARRANTED: 0
NO_FOLLOW_UP_IDENTIFIED: 0
UNCERTAIN: 0
CASE_SELECTION_METHOD: UNKNOWN_SELECTION (no case set)
LABELS_FROZEN_BEFORE_THRESHOLD_REVIEW: NOT_APPLICABLE (required YES before analysis)
PROTECTED_DB_ACCESSED: NO
PRODUCTION_THRESHOLDS_ACTIVATED: NO
AT_RISK_IMPLEMENTED: NO
```

No authorized human-reviewed case set was supplied or found in repository
artifacts. Synthetic fixtures in the harness are `SOFTWARE_TEST_ONLY`; they
prove extraction and evaluation math, not usefulness, cutoffs, precision,
recall, or classification quality.

## Stage 2 registry used

The existing Stage 2 registry remains authoritative. The validation harness
does not define another indicator contract.

| Indicator | Unit | Denominator or source | Window | Missing value |
| --- | --- | --- | --- | --- |
| `attendance_rate` | percent | Present + Late over Present + Late + Sakit + Izin + Alfa | current | null when denominator is zero |
| `attendance_delta` | percentage points | current attendance rate minus previous attendance rate | current vs previous | null when either denominator is zero |
| `tardiness_rate` | percent | Late over Present + Late | current | null when attended count is zero |
| `tardiness_delta` | percentage points | current tardiness rate minus previous tardiness rate | current vs previous | null when either attended count is zero |
| `alfa_rate` | percent | Alfa over Present + Late + Sakit + Izin + Alfa | current | null when denominator is zero |
| `alfa_delta` | percentage points | current Alfa rate minus previous Alfa rate | current vs previous | null when either denominator is zero |
| `academic_average` | score | non-null score sum over non-null score count | academic year | null when no scored result exists |
| `academic_participation` | percent | scored result slots over expected result slots | academic year | null when expected slots are zero |

Attendance rates use effective status, so an attendance override replaces the
stored status. Attendance windows are the existing `rolling_4w` or configured
`term` windows. Academic values are current-only because grade rows have no
canonical date or term axis.

The Stage 2 registry also records Attendance override prevalence as rejected
diagnostic context, Data-quality issue count as rejected confidence context,
Mastery proportion as deferred without an existing student-level contract,
and Academic trend as `DEFER_NO_TIME_AXIS`.

## Human review protocol

Reviewers answer one fixed question, using only information available at the
review date:

> Would this student have warranted additional human follow-up regarding
> attendance or academic participation?

Record one neutral outcome:

- `FOLLOW_UP_WARRANTED`
- `NO_FOLLOW_UP_IDENTIFIED`
- `UNCERTAIN`

Record labels before showing any indicator values or candidate cutoffs. Keep
`UNCERTAIN` cases in the dataset, report them separately, and exclude them from
the primary binary confusion matrix. Do not force a binary label.

The review sample must state its selection method:
`BROAD_REVIEW_SAMPLE`, `TARGETED_CASE_REVIEW`, `CONVENIENCE_SAMPLE`, or
`UNKNOWN_SELECTION`. It should cover available SMP, SD, and applicable TK/KB
groups, jenjang, classes, and a range of attendance, tardiness, Alfa, and
academic participation values. Targeted or convenience samples cannot support
population-level performance claims.

Each case records a review date and the exact indicator window. Future records
are excluded. Any violation is `TEMPORAL_LEAKAGE` and invalidates the case.

The operational calibration procedure, case-intake template, reviewer
instructions, sourcing plan, privacy workflow, and staff/leadership explanation
are maintained in [Real-Case Review Protocol](REAL_CASE_REVIEW_PROTOCOL.md).
The preparation requires an initial 5–10-case exercise with two independent
reviewers, label-first review, retained reviewer-specific labels, explicit
disagreement discussion, and deliberate quiet-case sampling. It does not
collect real cases or expose candidate thresholds.

## Safe case format

Keep the identity mapping outside Git and outside committed fixtures. Use only
opaque IDs and the fields needed for review:

```json
{
  "caseId": "CASE-001",
  "jenjang": "SMP",
  "reviewDate": "2026-08-31",
  "reviewWindow": {
    "kind": "rolling_4w",
    "anchorDate": "2026-08-30",
    "currentStart": "2026-08-03",
    "currentEnd": "2026-08-30",
    "previousStart": "2026-07-06",
    "previousEnd": "2026-08-02"
  },
  "humanOutcome": "FOLLOW_UP_WARRANTED",
  "indicatorDataAvailability": {
    "attendance": "available",
    "comparison": "available",
    "academic": "available"
  },
  "indicators": {
    "attendance_rate": 80,
    "attendance_delta": -10,
    "tardiness_rate": 20,
    "tardiness_delta": 5,
    "alfa_rate": 10,
    "alfa_delta": 4,
    "academic_average": 70,
    "academic_participation": 50
  }
}
```

Do not include names, identifying student IDs, raw attendance histories,
grades, or identifying staff comments. For an external source, record only its
source type, extraction date, case count, and de-identification method.

## Canonical extraction and evaluation

Use the Stage 2 TypeScript `studentIndicatorInsights` response as the only
indicator source. `apps/api/src/analytics/risk-threshold-validation.ts`
maps its rows to `CASE-*` rows and removes student identity fields. It does not
reproduce formulas in a spreadsheet, notebook, or SQL query.

The harness evaluates each accepted indicator independently:

```text
attendance_rate
attendance_delta
tardiness_rate
tardiness_delta
alfa_rate
alfa_delta
academic_average
academic_participation
```

For each explicit, observed-case cutoff, record evaluable N, positive N,
negative N, TP, FP, TN, FN, precision, recall, specificity, negative
predictive value, prevalence, missing N, and uncertain N. Use a transparent
cutoff grid; do not optimize a hidden value. Lower-is-concerning and
higher-is-concerning directions are validation-tool semantics only.

Use linear-interpolation quartiles for descriptive distributions. Report N,
missing N, minimum, Q1, median, Q3, and maximum separately for the two binary
human outcomes. Zero denominators are `null`, never NaN or Infinity.

Do not create a weighted score. Simple AND/OR rules may be considered only if
single indicators are insufficient and the sample supports them. Do not search
hundreds of combinations; that is `RISK_VALIDATION_THRESHOLD_OVERFIT`.

## Current indicator decisions

No real-case evidence exists, so the accepted Stage 2 indicators remain
`DEFER_INSUFFICIENT_EVIDENCE`. Data quality remains context/confidence only,
not risk evidence. Academic trend remains `DEFER_NO_TIME_AXIS`; grade rows
still have no canonical date or term axis.

No threshold is validated. Stage 4 readiness is `NOT_READY_FOR_STAGE_4`.
The gate to issue now is:

```text
OPERATOROS_RISK_THRESHOLD_VALIDATION_NEEDS_REAL_CASES
```

Collect and independently review an authorized, de-identified case set before
any threshold exploration.
