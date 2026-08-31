# OperatorOS Real-Case Review Protocol

Status: `OPERATOROS_REAL_CASE_REVIEW_CALIBRATION_PREPARATION`

This is an operational preparation guide for the Stage 3 human-review
calibration. It does not validate thresholds, activate classifications, or
create `AT_RISK`, alerts, interventions, predictions, or persisted risk state.
No real cases were accessed for preparing this document.

## Review question and labels

Use this question without broadening it:

> Based on information available to the school at the review date, would this
> student have warranted additional human follow-up regarding attendance or
> academic participation?

Reviewers select exactly one outcome:

- `FOLLOW_UP_WARRANTED`: a human conversation or check would have been
  reasonable. This does not mean the student is failing, problematic, or at
  risk, and it does not mean an intervention was mandatory.
- `NO_FOLLOW_UP_IDENTIFIED`: with adequate information available at that
  review date, the reviewer did not identify a need for additional follow-up.
  “Never discussed” alone is not sufficient evidence for this outcome.
- `UNCERTAIN`: information is insufficient, conflicting, or too context-bound
  to make either judgment. Keep it; do not force binary agreement.

This is a human-review outcome, not a machine-generated student status.

## Initial calibration exercise

After separate school authorization, select 5–10 real cases and assign two
appropriate staff reviewers per case. The local workflow determines the
pairing; possible roles include wali kelas/homeroom staff and BK/counselor or a
school leader familiar with follow-up. Do not hardcode roles across programs.

Reviewers work independently. Reviewer A cannot see Reviewer B’s label, and
vice versa. Neither reviewer sees indicator values, candidate thresholds, or
machine output during labeling. Record each label before canonical indicator
extraction.

Retain `reviewerAOutcome` and `reviewerBOutcome` separately. After both labels
are locked, discuss disagreements using the review question, not threshold
values. Record only a structured reason category when needed:

- `ATTENDANCE_PATTERN_INTERPRETED_DIFFERENTLY`
- `KNOWN_FAMILY_CONTEXT`
- `TEMPORARY_EVENT`
- `ACADEMIC_PARTICIPATION_INTERPRETATION`
- `INSUFFICIENT_INFORMATION`

Do not record identifying narrative comments. A school may record a
post-discussion consensus separately, but it must not overwrite either
original label.

Report the calibration set using these unambiguous counts:

- `exactAgreementN`: both reviewers selected the same outcome, including both
  selecting `UNCERTAIN`;
- `disagreementN`: the two outcomes differ;
- `uncertainInvolvedN`: at least one reviewer selected `UNCERTAIN`;
- `percentAgreement`: `exactAgreementN / caseN`, or `N/A` when there are no
  pairs.

Report raw counts first. There is no magic agreement threshold. Qualitative
terms such as strong, moderate, or low practical alignment require explicit
school-leadership definitions before use.

For later Stage 3 threshold validation, the prepared reference-label policy
is: use `POST_DISCUSSION_CONSENSUS` only when the discussion produces an
explicit recorded consensus; unresolved disagreements remain separate and
are excluded from the binary reference set or retained as `UNCERTAIN`.
Original reviewer labels remain immutable. The school owner must confirm this
policy before real-case threshold analysis begins.

## Sourcing and sampling

Do not create a new teacher reporting burden where an existing decision can be
reused. Before any access, inventory only the source type, custodian, period,
case count, approval, and de-identification method. Potential existing-
workflow sources are:

- BK/counselor case discussions;
- wali kelas meetings;
- parent-conference preparation;
- attendance follow-up records;
- academic follow-up records; and
- documented student-support discussions.

A positive retrospective candidate requires independent evidence that staff
actually considered additional follow-up warranted at the historical review
date. A negative candidate should be independently reviewed, or have had
adequate opportunity for review with no follow-up need identified. A student
who was never discussed is not automatically negative; if such cases are
used, record the limitation and do not treat them as confirmed negatives.

The calibration and later validation sample must deliberately include quiet,
ordinary-looking cases. Do not select only known absence, behavior, escalated,
or already prominent cases. Prefer `BROAD_REVIEW_SAMPLE`; classify a
retrospective decision sample as `TARGETED_CASE_REVIEW`, a readily available
sample as `CONVENIENCE_SAMPLE`, and an unknown process as
`UNKNOWN_SELECTION`. Do not claim population-level performance from targeted
or convenience samples.

Where available, record sampling strata across program, jenjang, class,
follow-up history, and ordinary/random selection. Equal counts are not
required. Treat SMP and SD as separate populations for review. TK/KB may be
included for descriptive review only when the indicators have a locally
meaningful interpretation; by default TK/KB is `EXCLUDED_FROM_THRESHOLD_VALIDATION`.
Any future TK/KB threshold requires a separate review model and cannot be
inferred from SMP/SD. No developmental metric is invented here.

## Time and indicator scope

Every case requires `reviewDate` and an exact `reviewWindow`. Use only data
available on or before the historical review context. For example, September
attendance cannot explain an August decision, and later grades cannot validate
an earlier judgment. Any violation is `TEMPORAL_LEAKAGE`; exclude the case
until corrected.

Use the existing Stage 2 TypeScript extraction authority for all eight
accepted indicators. Do not reproduce formulas in spreadsheets, notebooks,
or ad hoc SQL. Academic trend remains `DEFER_NO_TIME_AXIS`; do not manufacture
a historical trend. Current or historical academic values are usable only
when their temporal scope is genuinely supported by the canonical source.

After labels are frozen, extraction may attach:

`attendance_rate`, `attendance_delta`, `tardiness_rate`, `tardiness_delta`,
`alfa_rate`, `alfa_delta`, `academic_average`, and
`academic_participation`.

## Privacy and access workflow

1. The school data custodian holds the identifiable source and the separate
   mapping from a real student to `CASE-*`.
2. Only authorized reviewers and the minimum named operators receive access
   to identifiable source material needed for the human judgment.
3. A de-identification operator assigns opaque IDs such as `CASE-001` and
   removes names, identifying student IDs, addresses, phone numbers, parent
   data, and free-text identifying notes.
4. The mapping stays outside Git, committed fixtures, generated repository
   reports, and broad reviewer exports. The de-identified working set contains
   only the fields below.
5. Before export, perform a manual and automated check for names, identifiers,
   raw histories, grades, and identifying comments. If found, classify
   `RISK_VALIDATION_PII_EXPOSURE` and stop the export.

Use “de-identified for analysis,” not “anonymous.” No legal or consent claim
is made by this protocol.

## Label-first intake template

The first form contains only case and review fields. Indicator values are
attached later, after both independent labels are locked.

```text
caseId: CASE-001
program: SMP | SD | TK | KB
jenjang: <local value or null>
reviewDate: YYYY-MM-DD
reviewWindow: <exact canonical window or source reference>
sourceType: <inventory category>
selectionStratum: <program/class/history/quiet-case category>
reviewerAOpaqueId: <non-identifying reviewer code>
reviewerAOutcome: FOLLOW_UP_WARRANTED | NO_FOLLOW_UP_IDENTIFIED | UNCERTAIN
reviewerAReason: <optional structured category>
reviewerBOpaqueId: <non-identifying reviewer code>
reviewerBOutcome: FOLLOW_UP_WARRANTED | NO_FOLLOW_UP_IDENTIFIED | UNCERTAIN
reviewerBReason: <optional structured category>
consensusOutcome: <blank until after independent labels and discussion>
temporalIntegrity: PASS | TEMPORAL_LEAKAGE
indicatorDataAvailability: <canonical availability summary, added later>
```

The retained de-identified validation row may then contain `caseId`, safe
program/jenjang metadata, review scope/date, the two original outcomes, an
optional consensus outcome, structured reason categories, availability, and
the canonical Stage 2 indicator values. Do not add long free-text narratives.

## Plain-language explanation

### Staff and leadership

> OperatorOS is evaluating whether existing attendance and academic
> measurements are useful for helping staff notice cases that may deserve
> human attention. The system is not currently deciding whether a student is
> at risk. It does not generate automated intervention or disciplinary action.
> Human staff remain responsible for interpretation. The calibration uses a
> limited, de-identified case set and two independent reviewers. Any future
> candidate cutoff remains inactive unless separate evidence and approval are
> completed.

### Parent or foundation-board answer

> OperatorOS uses attendance and academic data to provide authorized school
> staff with operational reports and descriptive measurements. For this
> calibration, a limited set of information is de-identified for analysis
> using case codes; the separate identity mapping remains with authorized
> custodians and is not committed to Git. OperatorOS is not currently labeling
> students as at risk or automatically generating interventions or discipline;
> school staff remain responsible for any human follow-up.

## Preparation gate

```text
REAL_CASES_ACCESSED: 0
REAL_CASE_THRESHOLD_EVIDENCE: 0
PRODUCTION_THRESHOLDS: 0
AT_RISK: 0
ALERTS: 0
INTERVENTIONS: 0
PREDICTIONS: 0
PERSISTED_RISK_STATE: 0
PROTECTED_DB_ACCESSED: NO
PERSISTENT_DEV_DB_MODIFIED: NO
```

This preparation does not resume Stage 3 threshold validation. The next
authorized action is the 5–10-case independent calibration exercise, followed
by agreement review and only then a broader de-identified real-case sample.
