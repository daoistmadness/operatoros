# Documentation index

Source code and configuration define current behavior. This index links to every
maintained documentation page; drafts and historical references are labeled.
Dated session logs and the reusable session template are exempt from the index.

## Structure

- Architecture describes system ownership and boundaries.
- Guides give task-oriented setup, development, and review steps.
- Reference pages define contracts and lookup facts.
- Decisions record accepted choices and proposals.
- Runbooks describe operational procedures.
- Session logs are non-authoritative handoff records.
- Package-owned and generated docs remain beside their source.
- The protected Dapodik design remains at its required path.

## Architecture

- [Analytics architecture](architecture/analytics.md).
- [Backup Scheduler Architecture](architecture/backup-scheduling.md).
- [OperatorOS Change Safety & Feature Golden Path](architecture/change-safety-golden-path.md).
- [Database schema architecture](architecture/database-schema.md).
- [OperatorOS Excel architecture](architecture/excel.md).
- [First-Run Administrator Architecture](architecture/first-run-admin.md).
- [Frontend data architecture](architecture/frontend-data.md).
- [Frontend architecture](architecture/frontend.md).
- [Workspace boundaries](architecture/module-boundaries.md).
- [Architecture overview](architecture/overview.md).
- [UI and routing](architecture/ui-and-routing.md).
- [OperatorOS CSS and Component Architecture](architecture/ui-styling.md).

## Guides

- [Persistent development database](guides/development-database.md).
- [Development](guides/development.md).
- [Offline install and start](guides/offline-install.md) — Draft.
- [OperatorOS Real-Case Review Protocol](guides/real-case-review.md).
- [Tailscale HTTPS development](guides/tailscale-https-development.md).
- [Test strategy](guides/testing.md).

## Reference

- [Student Progression and Academic-Year Rollover](reference/academic-year-rollover.md).
- [Backup format and ownership](reference/backup-format.md).
- [CI performance](reference/ci-performance.md).
- [Dependency audit exceptions](reference/dependency-audit-exceptions.md).
- [Employee management](reference/employee-management.md).
- [Frontend performance baseline](reference/frontend-performance-baseline.md).
- [Frontend release validation](reference/frontend-release-validation.md).
- [Frontend release validation samples](reference/frontend-release-validation-samples.json).
- [TanStack Redact comparison samples](reference/tanstack-redact-comparison-samples.json).
- [First-Run Administrator Threat Model](reference/first-run-admin-threat-model.md).
- [Migration golden fixtures](reference/golden-fixtures.md) — Deprecated.
- [Identity and Authentication](reference/identity-authentication.md).
- [Legacy S4.3 migration source](reference/legacy-s43-migration-source.md) — Deprecated.
- [OperatorOS metric and filter contract](reference/metrics.md).
- [OperatorOS Product Terminology Glossary](reference/product-terminology.md).
- [Production origin and cookie profile](reference/production-profile.md) — Draft.
- [Risk Threshold Validation](reference/risk-threshold-validation.md).
- [Platform portability](reference/runtime-support.md).
- [Security model](reference/security-model.md).

### Student Data

- [Academic Mapping Contract](reference/student-data/academic-mapping-contract.md) — Draft.
- [Academic Master Contract](reference/student-data/academic-master-contract.md) — Draft.
- [Academic Roster Import Contract](reference/student-data/academic-roster-import-contract.md) — Draft.
- [Monthly Student Data Report Contract (S1 Frozen Draft)](reference/student-data/monthly-report-contract.md) — Draft.
- [Student Master Import Contract (S1 Frozen Draft)](reference/student-data/student-import-contract.md) — Draft.
- [Student master data](reference/student-master-data.md).
- [User Administration](reference/user-administration.md).

## Decisions

- [Attendance consolidation boundary](decisions/attendance-consolidation-boundary.md).
- [ADR: Bun-native frontend and tooling environment](decisions/bun-toolchain.md).
- [Documentation system](decisions/documentation-system.md).
- [Git history data remediation](decisions/git-history-data-remediation.md) — Deprecated.
- [Ingestion dependency strategy](decisions/ingestion-dependency-strategy.md).
- [Persistent development database](decisions/persistent-development-database.md).
- [TanStack Redact research](decisions/tanstack-redact-research.md).
- [Report artifact preservation](decisions/report-artifact-preservation.md) — Draft.
- [SQLite-only local runtime](decisions/sqlite-only-runtime.md).
- [ADR: Tauri v2 Desktop Architecture](decisions/tauri-desktop-architecture.md) — Deprecated.

## Runbooks

- [Backup and Restore Security](runbooks/backup-restore.md).
- [Granular school data reset](runbooks/data-reset.md).
- [Database operations](runbooks/database-operations.md).
- [Audit log rotation and retention](runbooks/log-rotation.md) — Draft.
- [Elysia Runtime Operations](runbooks/runtime-operations.md).
- [Secret rotation runbook](runbooks/secret-rotation.md).
- [Ubuntu server deployment and supervision (OperatorOS API)](runbooks/ubuntu-server-deployment.md) — Draft.

## Audits

- [Dependency optimization audit](audits/dependency-optimization.md).

## Session logs

- [Session logs](session/README.md).

## Protected reference

- [Dapodik roster import design](student-data/dapodik-roster-import-design.md) — protected source content, preserved at its required path.

The documentation index is checked in CI. Update it whenever a maintained page is added, moved, merged, or removed.
