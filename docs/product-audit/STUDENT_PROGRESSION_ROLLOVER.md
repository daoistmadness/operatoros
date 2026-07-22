# Student Progression and Academic-Year Rollover

## Scope and preserved foundations

Student progression is a preview-first workflow built on the existing canonical `StudentMaster`, effective-dated `StudentEnrollment`, class-history, lifecycle-audit, role-capability, and academic-master ledgers. It never rewrites a source enrollment into a new academic year. Promotion, retention, and cross-Jenjang placement create a distinct destination enrollment; historical attendance, grades, interventions, reports, imports, and identifiers remain attached to their original records.

The workflow supports `PROMOTE`, `RETAIN`, `GRADUATE`, `CROSS_JENJANG`, `WITHDRAW`, `EXCLUDE`, and `MANUAL_REVIEW`. Device identity remains optional because academic identity is owned by `StudentMaster`.

## Mapping and preview contract

Mappings resolve in this order:

1. Explicit operator override.
2. An approved `StudentProgressionMappingRule` keyed by source and destination IDs.
3. The next active grade sequence in the same program and Jenjang.
4. Graduation from an active terminal grade.
5. Manual review.

Class labels are display data only. Destination validation uses academic-year, class, grade, program, and Jenjang IDs; inactive configuration is rejected. Cross-Jenjang movement is never inferred from a grade name.

`POST /api/student-progression/previews` stores a deterministic, versioned batch with source fingerprints, proposed destination IDs, outcomes, warnings, conflicts, creator, and checksum. Preview creation changes neither enrollments nor lifecycle history. The read API supports pagination and filters for outcome, Jenjang, grade, class, and conflict. Row overrides and revalidation increment the preview version and checksum, so a stale client cannot commit an earlier payload.

## Atomic commit and idempotence

Commit requires the exact preview version, the destination academic-year start date, and an outcome-specific confirmation token. The service locks destination scope, rechecks source fingerprints and destination uniqueness inside one transaction, then either applies every row or rolls the whole batch back.

Destination-bearing decisions create a new active enrollment and its first class-history interval. The source enrollment is effective-dated closed with an appended lifecycle-audit record; its identity and primary key are retained. Each applied decision appends a `student_progression_audit` record containing the source and destination contexts, mapping source, reason, actor, and resulting enrollment link. Database triggers make this audit table append-only on SQLite and PostgreSQL.

A committed batch stores its result. Repeating the same commit returns that result without creating another enrollment. An unresolved, stale, or concurrently conflicting batch is rejected without partial application.

## Graduation, retention, and cross-Jenjang rules

Graduation is valid only for a configured terminal grade, creates no destination enrollment, and marks the source enrollment `GRADUATED`. The canonical student is marked graduated only when no other active enrollment exists. The stronger `COMMIT_GRADUATION_PROGRESSION` token and graduation capability are required.

Retention is an explicit decision with a reason code. It keeps the same grade ID and creates a new-year enrollment in an explicitly selected destination class. Retention is counted and audited separately from promotion.

Cross-Jenjang movement requires explicit destination Jenjang, program, grade, and class IDs, an operator override or approved mapping rule, the dedicated capability, and `COMMIT_CROSS_JENJANG_PROGRESSION`. The destination enrollment retains the same `StudentMaster` identity.

## Authorization and API surface

The canonical router is mounted under `/api/student-progression`. Capabilities separate preview viewing, preview creation, mapping override, batch commit, graduation, retention, and cross-Jenjang execution. Ordinary staff have read-only preview access; unauthenticated and unauthorized mutations return 401 and 403 before writes occur. Service errors expose stable progression codes and safe messages rather than ORM or SQL details.

## Management workflow and readiness

Academic Management includes a responsive Progression tab covering year selection, preview generation, summaries, filters, bulk class assignment, per-row review, confirmation, atomic application, and committed results. Graduation, retention, and cross-Jenjang decisions have distinct visual treatment. The confirmation dialog traps keyboard focus, duplicate submission is disabled, errors are sanitized, and the layout avoids page-level horizontal overflow from 390 through 1366 pixels.

Readiness now reports whether a destination year and active future-year classes exist. Open progression batches remain visible for operator follow-up, while preview rows stay outside operational rosters and reports until commit.

## Verification and protected-data evidence

Synthetic unit, migration, authorization, API, browser, and E2E fixtures cover deterministic non-mutating previews; promotion, retention, graduation, manual review, and cross-Jenjang decisions; stale rejection; idempotence; authorization; append-only audit; preservation of source records; and injected transactional rollback. Migration tests use isolated databases and verify publication safety and idempotence.

The production-like `backend/attendance.db` is excluded from all initialization, migration, API, and E2E paths. Verification is limited to its SHA-256 and an immutable read-only SQLite connection. The protected-path guard remains active, and generated synthetic databases and evidence are removed after validation.

## Deferred work

Incorrect graduation or progression is not silently reversed. A dedicated authorized corrective workflow using `reverse_progression_error` is intentionally deferred. Advanced capacity planning is also deferred until academic classes expose an authoritative capacity contract; current validation enforces configuration compatibility and uniqueness only.
