# S3.7 Academic Master Audit

## Academic years

| ID | Name | Start | End | Status | Default |
|---:|---|---|---|---|---|
| 1 | 2025/2026 | 2025-07-01 | 2026-06-30 | active | yes |

No duplicate year labels or invalid dates were found. The record is still marked active after its end date; governance review should close it before activating a later year.

## Jenjang

| ID | Name | Code | Level | Active |
|---:|---|---|---|---|
| 1 | Primary | missing | missing | true after additive compatibility default |

Primary is structurally incomplete because code and level were never governed. No duplicate name exists. Secondary and early-years levels are absent, but cannot be inserted without an approved structure source.

## Subjects

| ID | Name | Jenjang ID | Jenjang | Sumatif | Formatif |
|---:|---|---:|---|---|---|
| 1 | Language | 1 | Primary | yes | yes |

The foreign key is valid and restrictive. No duplicate `(name, jenjang_id)` exists. Subject coverage is clearly incomplete for a full school curriculum but no subject additions are authorized in this phase.

## Assessment components

| ID | Name | Type | Subject ID |
|---:|---|---|---:|
| 1 | kuis | sumatif | global/null |
| 2 | tes | sumatif | global/null |
| 3 | total | sumatif | global/null |
| 4 | total | formatif | global/null |

All assessment types satisfy the database constraint. Null subject IDs are permitted global defaults, not invalid references. No duplicate component key exists.

## Integrity findings

- Duplicate masters: none detected in the four audited tables.
- Invalid foreign references: none.
- Explicit inactive rows: none.
- Missing levels: jenjang code/level incomplete; Secondary/early-years hierarchy unavailable.
- Missing program and class masters: both tables were absent before S3.7 and now exist empty.
- Enrollment remains zero.

No existing academic value was edited during preparation.

