# Documentation index

## Getting started

- [Repository README](../README.md) — current setup and project overview.
- [Development notes](development/README.md) — current local workflow.

## Development workflow

- [Contributing](../CONTRIBUTING.md) — current Git, validation, and PR rules.
- [Test strategy](testing/TEST_STRATEGY.md) — current fast, PR, and release tiers.

## Architecture

- [Database schema architecture](architecture/DATABASE_SCHEMA_ARCHITECTURE.md) — current S4.2 baseline and S4.3 runtime model.
- [Frontend architecture](architecture/FRONTEND_ARCHITECTURE.md) — TypeScript, lazy routes, boundaries, and OpenAPI workflow.
- [Phase 14 monorepo architecture](architecture/phase-14-monorepo.md) — workspace ownership and modernization boundaries.
- [Platform portability](architecture/PLATFORM_PORTABILITY.md) — current SQLite-only local runtime contract.
- [SQLite-only desktop ADR](architecture/decisions/SQLITE_ONLY_DESKTOP_RUNTIME.md) — accepted database and deployment decision.
- [Ingestion dependency strategy](architecture/INGESTION_DEPENDENCY_STRATEGY.md) — current pandas/openpyxl decision and benchmark criteria.

## Operations

- [Database operations](operations/DATABASE_OPERATIONS.md) — current protected-database, backup, migration, and rollback safeguards.

## Product references

- **Data Recapitulation** (`/analytics/recapitulation`) gives school management descriptive, server-computed summaries of canonical student and staff data (gender, religion, jenjang, class/rombel, age bands, enrollment status; staff employment status, job title, education, jenjang assignment). Missing values surface as explicit "Unknown" categories. Excel exports require `export_student_data` / `export_staff` and mirror the active filters.
- **Data Quality** (`/analytics/data-quality`) turns missing and unmapped canonical master data into management information: field completeness with explicit applicability, class/rombel breakdowns, paginated issue drilldowns, and a derived Resolution workspace. Findings remain read-only and source-derived; editable findings link to the existing student or staff editor only when the actor has its write capability. No issue rows, automatic fixes, or fake “mark resolved” state are stored. Students require `view_student`, staff `view_staff`; exports require `export_student_data` / `export_staff`.
- The Class Attendance Entry page (`/attendance/class-entry`) offers **Export Excel Bulanan** (capability `export_assigned_class_attendance`): staff export attendance for their assigned classes only, admins for any class. The API applies attendance overrides as the effective status and builds the workbook server-side with a per-student recap and daily detail for the chosen month.
- Attendance Correction Review (`/attendance/override-review`) is a bounded, read-only projection of current canonical attendance overrides. It shows original and effective status, recorded correction metadata, authorized scope, and controlled links to the existing attendance, Student 360, and Class 360 workflows. It does not store issue rows, infer staff judgment, or replace the canonical correction editor.
- Student profiles (`/students/:id`) offer an **Export attendance history** action (capability `export_student_data`, linked identity required): the API builds an Excel workbook server-side with a monthly recap and the selected month's daily breakdown, applying attendance overrides as the effective status.
- Student profiles (`/students/:id`) are the integrated per-student operational view: current identity and enrollment compose the canonical Attendance Analytics, Academic Analytics, Student Trends, and Data Quality authorities. Missing metrics remain unavailable rather than being converted to zero; grade trend remains unavailable until a trustworthy time axis exists. The overview is read-only and contains no automated classification or follow-up decision.

- [Product terminology glossary](product-audit/PRODUCT_TERMINOLOGY_GLOSSARY.md) — canonical product terms.
- [Student progression and rollover audit](product-audit/STUDENT_PROGRESSION_ROLLOVER.md) — progression rules referenced by the migration tooling.
- Completed milestone audits, releases, and reports remain available in Git history.
