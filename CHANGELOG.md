# Changelog

Notable user-facing changes are recorded here.

## [Unreleased]

- Refresh runtime qualification, recovery, and cutover readiness evidence after Phase 7, with the unresolved SQLite and independent-recovery gates recorded.
- Bind the embedded Bun/SQLite CycloneDX inventory to the exact OCI image and source, and reject release evidence with an unqualified runtime. (#381)
- Gate release images on embedded Bun/SQLite evidence before signing and provide a nonpublishing candidate qualification path.
- Disable the D1 and rehearsal Caddy admin listeners to avoid conflicts with the existing Caddy service. (#379)
- Allow the pinned D1 Caddy image to start with only its required `net_bind_service` capability while retaining `NoNewPrivileges` and dropping all others. (#378)
- Pin the host deployment profile to the isolated D1 root, UID 1002, measured capacity reserves, first-admin setup token, and approved loopback ports; keep rehearsal and host Quadlet validation distinct and allocate subordinate IDs deterministically (#377).
- Record a public summary of the read-only host integration findings and the missing attested release for the reviewed main baseline (#363).
- Report and fail closed on an invalid rootless Podman storage context in `operatoros-deploy status`, so a default-store listing cannot be mistaken for the deployed stack (#364).
- Document the two ingress candidates with an evidence-backed container recommendation, the deployment-root/data/container-mount distinction, and Tailscale route ownership (#364).
- Accept GitHub Actions runs whose workflow path has no ref suffix when verifying a release artifact, while still rejecting foreign workflows and non-main refs (#365).
- Add a provenance-verifying single-server deployment command with application-only rollback and interrupted-transaction reporting.
- Prepare a manually confirmed, run-isolated Ubuntu 24.04 deployment rehearsal for the retained verified release artifact.
- Pin the rehearsal to the approved attested release, record its provenance and checksums, and verify WAL-safe SQLite preservation, lock isolation, restart recovery, and SPA cache behavior (#366).
- Pin Podman storage and metadata to the rehearsal workspace and separate JSON output from warnings.
- Retain stable, sanitized failure codes and cleanup status when private Podman-context qualification fails (#367).
- Report the last completed guard accurately for private Podman-context rejection (#368).
- Use the standard private XDG storage config for rehearsal Podman and keep failure summaries synchronized with the rejected guard (#369).
- Prevent duplicate synthetic data-directory creation and retain sanitized deployment and cleanup phase results in rehearsal evidence (#370).
- Bootstrap the synthetic database before creating backups and report setup operations and cleanup-log creation accurately (#371).
- Preserve typed synthetic schema-rejection results and remove only validated read-only workspace directories during rehearsal cleanup (#372).
- Preserve safe Podman failure categories in synthetic schema-validation evidence and redact executable paths from command errors (#373).
- Use the verified private Podman context for synthetic schema validation (#374).
- Preserve SQLite file identity across application transitions without treating normal WAL/SHM lifecycle changes as database replacement, and report rollback failures by operation (#375).
- Verify post-backup SQLite preservation and report interrupted recovery failures by phase in the synthetic deployment rehearsal (#376).
- Scan validated OCI layouts with pinned Trivy and retain safe diagnostics when release builds or scans fail (#358).
- Tear down the isolated release consumer's rootless Podman store safely, inspect rootless mounts correctly, and preserve cleanup failures (#359).

- Align class conflict resolution with Tailwind CSS 4 and share the class utility between the web app and UI package (#357).
- Build checksummed, attested API and static SPA release bundles through manual main-only CI, with verification before container import (#355).

- Add unified `./scripts/dev`, `./scripts/check`, `./scripts/doctor`, and `./scripts/stop` commands with Git worktree-integrity diagnostics, protected-listener preflight guidance, and verified session shutdown.
- Ignore stale Grade Ledger responses so changing assessment sessions cannot discard score edits.
- Add a rootless Podman API image, Quadlet/Caddy configuration, source-tree provenance checks, and a synthetic local deployment harness.
- Keep the dashboard heading available during analytics loading and synchronize E2E checks on relevant page readiness.
- Use the Asia/Jakarta school date for effective-date checks, age and tenure calculations, report defaults, and due status.
- Reject non-standard SQLite schema objects in restore and migration preflight before reading database rows.
- Build local Podman validation artifacts from a clean committed source snapshot with canonical Git file modes.
- Record C6 release, security, and rehearsal blockers with current local validation results.

- Vendor trimmed SheetJS fork and implement lazy legacy XLS parsing in @operatoros/excel (#352).
- Pin affected minimatch dependency paths to the patched release and test their current consumers under Bun and Node.
- Migrate the web app to TanStack Start SPA mode while preserving the standalone Elysia API and same-origin proxy (#351).
- Make attendance conflict-retry commits idempotent across exact and concurrent replays without duplicate audit entries (#350).
- Reject committed attendance-import retries that change the selected rows (#349).
- Include the disposable data-reset scenario in focused pull-request E2E validation (#348).
- Document optional UPP report and student IOM upload-size limits and defaults (#347).
- Align CI documentation with the seven status checks enforced on `main` (#345).
- Document configurable session timeout and account lockout settings (#346).
- Correct the documented SQLite schema head and migration target to S5.4.
- Document the file-based TanStack Router setup and authorization boundaries in the README.
- Align roster and student import validation across the API and web app.
- Reduce repeated score processing in academic analytics summaries (#341).
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
