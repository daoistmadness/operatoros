# Monthly Student Data Report Contract (S1 Frozen Draft)

## Purpose and population

The monthly student report is a point-in-time academic population report. Its denominator is not attendance presence.

```text
total_active_students(snapshot_date)
  = distinct stable student masters
    having an effective active enrollment on snapshot_date
```

Every report identifies:

- reporting month and explicit `snapshot_date`;
- academic year;
- generation time, generator version, filters, and source snapshot ID;
- whether it is an original generation or audited regeneration.

Default snapshot date is the final calendar day of the reporting month. A school policy may select another date, but the chosen rule is versioned and cannot vary silently between reports.

## Three distinct populations

1. **Attendance population:** distinct master-linked students with qualifying attendance rows in the selected period. Supporting metric only.
2. **Active academic population:** effective active enrollments on the snapshot date. Canonical denominator.
3. **Student master population:** every retained master record regardless of status or enrollment.

The UI and exports label these populations explicitly. A student can belong to the master population but not the active population, or to the active population without attendance during the month.

## Required dimensions and measures

For the active population, report:

- by normalized jenjang;
- by effective class assignment;
- by gender;
- by religion;
- by kelurahan;
- by program;
- by active enrollment status;
- new admissions effective during the month;
- transfers in/out during the month;
- withdrawals during the month;
- graduates/completions during the month;
- incomplete master/profile records;
- optional supporting attendance coverage/counts, clearly separated.

Every active student contributes exactly once to every single-valued reconciliation dimension. Missing values contribute to `Unknown / Not Recorded`, never disappear.

## Source precedence

| Report concept | Authoritative source |
|---|---|
| Person identity | stable student master |
| Academic year/program/jenjang | effective enrollment snapshot |
| Class | effective class assignment snapshot |
| Gender/religion/kelurahan | frozen profile values in monthly snapshot |
| Active status | effective enrollment status at snapshot date |
| Admissions/transfers/withdrawals/graduates | effective-dated enrollment events |
| Attendance metric | master-linked attendance in report period |

Legacy `students.jenjang` and `students.class_name` are never authoritative monthly-report fields. They may appear only as migration-quality evidence until a reviewed enrollment exists.

## Snapshot strategy decision

### Option 1: materialized row per student per month

Benefits: simple reproducibility and reconciliation, protects history from profile edits, easy export parity, practical for OperatorOS scale and SQLite. Costs: storage and explicit regeneration governance.

### Option 2: event-sourced reconstruction

Benefits: expressive history and fewer duplicated snapshot values. Costs: every profile/enrollment field needs complete effective-dated history; late corrections and query logic are substantially more complex; current models do not have that history.

### Recommendation

Implement **materialized row-per-active-student snapshots first**, while also recording effective-dated enrollment events. This is the safest initial design because current profiles and grades are mutable and historical profile event coverage does not exist.

## Proposed snapshot contract

### Snapshot header

- immutable `snapshot_id`;
- reporting month and `snapshot_date`;
- academic-year ID and optional scoped filters;
- unique idempotency key for `(month, academic_year, scope, generation_version)`;
- state: `generating`, `valid`, `invalid`, `superseded`;
- source/import batch watermarks;
- generator version and rule version;
- created by/at;
- regeneration reason and predecessor snapshot ID;
- totals and reconciliation outcome;
- source checksum/digest.

### Snapshot student row

One row for each included active enrollment/master pair, containing immutable copies of:

- master ID and safe display identifier;
- enrollment ID, program, jenjang, class, status, start/end dates;
- gender, religion, kelurahan or canonical unknown token;
- admission/transition flags for the month;
- completeness flags;
- optional attendance record/day metrics;
- source version IDs needed for audit.

A unique constraint prevents duplicate `(snapshot_id, master_id, enrollment_scope)` rows. If policy forbids concurrent programs, `master_id` alone is sufficient inside one snapshot; otherwise enrollment/program scope must be explicit and report rules must distinguish student headcount from enrollment count.

## Immutability and regeneration

- Valid snapshot rows are immutable.
- Profile edits affect future snapshots only.
- Regeneration never overwrites a valid snapshot. It creates a new version, records reason/actor, reconciles it, and marks the prior version superseded only after successful validation.
- Exports reference one immutable snapshot ID and include its generation metadata.
- Failed generation leaves no partial valid snapshot. Header/rows/reconciliation commit atomically.
- Concurrent generation for the same scope is prevented with a database uniqueness/idempotency guard, not only a process lock.

## Reconciliation rules

For every valid snapshot:

```text
total_active_students = sum(by_gender including Unknown)
total_active_students = sum(by_religion including Unknown)
total_active_students = sum(by_jenjang including Unknown if integrity permits)
total_active_students = sum(by_class including Unknown / Unassigned)
total_active_students = sum(by_program including Unknown if integrity permits)
total_active_students = sum(known kelurahan) + Unknown / Not Recorded
```

Additionally:

- no duplicate master within the defined headcount scope;
- every snapshot row references a retained master and effective enrollment;
- enrollment interval contains snapshot date;
- class assignment, when present, is effective on snapshot date;
- category totals are nonnegative integers;
- attendance population is never greater than linked masters with attendance unless explicitly reporting external/unresolved identities.

## Integrity severity

| Severity | Examples | Behavior |
|---|---|---|
| Warning | missing gender/religion/kelurahan categorized as Unknown | Generate, show banner, include quality section |
| Error | missing class where policy expects assignment, unresolved legacy link | Generate only if rule permits; prominent discrepancy and audit |
| Severe | duplicate active enrollment violating scope, totals do not reconcile, orphan master/enrollment | Fail generation; no valid snapshot/export |

Dashboard warnings and exports contain discrepancy codes and counts, not sensitive row details. Detailed resolution lists are admin-only. Every generation attempt and failure is logged.

## Monthly movement semantics

- **New admission:** first effective qualifying enrollment starts within the month with admission reason.
- **Transfer in:** qualifying enrollment/program/class begins within month due to transfer, as distinct from new admission.
- **Transfer out:** prior qualifying enrollment/assignment ends within month due to transfer.
- **Withdrawal:** active enrollment ends within month with withdrawal status/reason.
- **Graduate:** enrollment ends/completes within month with graduate/completed reason.

Movements are event counts and may not algebraically equal the point-in-time total without an opening balance. Reports show opening active, additions, removals, and closing active when event history is complete.

## Incomplete-record rules

Completeness is policy/version based. At minimum distinguish:

- missing stable school/national identity;
- missing required admission information;
- missing gender/religion/kelurahan;
- missing effective jenjang/class/program;
- missing required contact/document status.

Incomplete records remain in totals. They are never filtered from a category; applicable fields use `Unknown / Not Recorded`.

## Privacy and exports

- Monthly dashboard defaults to aggregates.
- Authorized drill-down may show full name and safe school identifier, never raw NIK or detailed health/contact data.
- PDF/Excel use a field allow-list; routine exports exclude full birth date, parent/emergency contact, documents, and health details.
- Small-cell suppression/masking should be policy-controlled for sensitive demographic combinations.
- Every export logs actor, snapshot ID, format, filters, purpose where required, time, and outcome.

## Current-data implication

The 107 attendance-registry students cannot yet generate a valid active-student monthly snapshot because `student_enrollments` is empty and no authoritative roster proves active status, class, program, or complete jenjang. Attendance analytics remain valid for their attendance population; they must not be relabeled as academic enrollment totals.

## Acceptance examples

- Editing a student's religion after June does not change the valid June snapshot.
- A student with missing religion appears under `Unknown / Not Recorded`; totals still reconcile.
- A student absent all month but actively enrolled remains in active headcount.
- A student with attendance but no active enrollment is excluded from active headcount and appears in an admin data-quality list.
- Missing from the latest import does not deactivate or remove a student.
