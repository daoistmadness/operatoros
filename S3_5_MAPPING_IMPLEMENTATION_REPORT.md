# S3.5 Mapping Implementation Report

## Root cause

All 117 authoritative legacy student rows have both `students.jenjang` and `students.class_name` set to null. Therefore the original enrollment result was not a spelling mismatch: there is no source academic value to match.

The evidence supports:

- **A — confirmed:** every legacy jenjang value is empty.
- **B — not applicable:** there are no nonblank legacy values to compare.
- **C — partially confirmed:** canonical `jenjangs` contains only `Primary`; it has no active/status, level, or code columns. Completeness for the full school population cannot be established.
- **D — confirmed:** attendance ingestion preserves scanner identity and attendance fields but its workbook contract has no jenjang/class columns, so the 10 Term 4 identities correctly received no academic assumptions. The earlier 107 runtime students were also already blank.
- **E — historical evidence only:** the non-authoritative reference database analysis found class/jenjang additions, but database merging is prohibited and those values are not authoritative runtime mappings.

## Implementation

- Added `student_academic_mapping_rules` with typed targets, review status, creator/approver evidence, uniqueness, and restrictive jenjang foreign keys.
- Added additive SQLite and PostgreSQL migrations.
- Added admin-only `POST /api/student-enrollments/mapping-preview`.
- Added classifications for empty, unmatched, matched, normalized-review, ambiguous, and approved-rule outcomes.
- Updated enrollment preview to accept exact canonical jenjang values, require approval for normalized jenjang transformations, and require an approved rule for class values.
- Imported the model during runtime initialization; no compatibility table or existing data was rewritten.

No rules were created because both source fields are blank. Creating a blank-source rule would silently assign all students and violate the contract.

## Runtime verification

Authenticated mapping preview returned:

| Classification | Count |
|---|---:|
| Total | 117 |
| Empty jenjang | 117 |
| Unmatched jenjang | 0 |
| Matched jenjang | 0 |
| Empty class | 117 |
| Unmatched class | 0 |
| Matched class | 0 |
| Approved mapping rules | 0 |

Safety verification:

- Attendance fingerprint unchanged
- Student-master fingerprint unchanged
- Enrollment rows before/after: 0/0
- SQLite integrity: `ok`
- Foreign-key violations: 0
- Ambiguous normalized jenjang test: blocked
- Administrator authorization test: passed

## Decision

Academic mapping is unresolved. A trusted academic roster or reviewed source containing per-student jenjang and class is required. The system must not derive those values from the Term 4 SMP filename or scanner IDs.

