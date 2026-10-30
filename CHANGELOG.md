# Changelog

Notable user-facing changes are recorded here.

## [Unreleased]

- Clear protected page state after identity or permission changes and cancel superseded follow-up and analytics reads.
- Add an isolated TanStack Redact research build and document its compatibility and performance results while keeping React as the production renderer.
- Record consolidated frontend release validation against a corrected production-mode baseline and fix mobile navigation focus and cross-browser E2E assumptions.
### Changed
- Defer the Management Overview attendance chart until it approaches the viewport and enforce production page-chunk budgets.
- Add a versioned browser preference for the desktop sidebar, standardize shared state colors, and keep the mobile navigation drawer full width.
- Modernize the Management Overview attendance distribution with Unovis while retaining the exact-value table and Chart.js for other charts.
- Use TanStack Table for attendance follow-up lists and virtualize large result sets.
- Add a TanStack Form pilot for staff profiles with TypeBox validation, mapped API errors, and dirty-navigation protection.
- Revalidate the session before refetching protected queries, apply domain freshness and cancellation policies, and avoid caching authenticated API responses.
- Enforce generated route-policy coverage, discard reserved search keys, and add an opt-in local frontend baseline.
- Add a route-policy-filtered navigation registry, command search, breadcrumbs, and shell page titles.
- Retry transient mise tool downloads and cache checksum-verified archives in CI (#338).
- Run changelog, Markdown, and agent-skill maintainer checks before API and browser E2E jobs, with matching local pre-push checks.
- Migrate web routes to file-based TanStack Router while preserving authorization and legacy route behavior (#335).
- Permitted TanStack Router for web routing in AGENTS.md (#334).
- Reorganized and indexed the project documentation (#324)

### Added
- Manage versioned school units and dated staff assignments with explicit PTK applicability, audited cancellation, and calculated profile age.
- Filter Student Management and CSV exports by whether NISN has been entered (#326).
- Track monthly PTK processing by school unit, month, and year with eligibility snapshots, operator confirmation, history, and exports.
- Track NIK/KK identity verification, DAPODIK registration status, and IOM documents on the student administration profile and management filters (#330).
- Archive and track monthly UPP report workbooks per school unit and month with version replacement and submission tracking.
- Show an operational dashboard, an annual BOSP cut-off reminder, and a cross-module operator work queue with type filters and actionable navigation (#331).

### Fixed
- Require a strong authentication secret at startup, bound archive extraction, reject stale imports atomically, and batch sensitive roster exports (#333).

### Removed
- Remove redundant dependencies and replace simple Dashboard motion with CSS, reducing emitted production JavaScript by 110 kB raw.
