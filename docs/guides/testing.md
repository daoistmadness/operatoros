---
status: current
last_reviewed: 2026-10-26
---

# Test strategy

Ordinary tiers run against disposable SQLite databases and require neither
Docker nor PostgreSQL. Database configuration, startup, path-safety, and schema
changes escalate through the classifier to the PR or release tier; migration
sensitivity also selects fresh parity and duplicate backend passes.

`mise run test:fast` is the iterative, changed-path-aware gate. It is the
normal gate for documentation-only work. `mise run check:full` delegates to
`make test-release`, the complete release-sensitive authority. The underlying
`make test-pr` and `make test-release` targets remain the implementation
authority. `mise run db:fresh` delegates to `make fresh-db-parity`.

`mise run check:affected` is a separate Turbo package check. It uses the
current `origin/main` remote-tracking ref through `TURBO_SCM_BASE` and does not
replace the classifier or the full PR/release gate. Use
`mise run check:affected -- --dry=json` to inspect selection without running.

Workspace and launcher CLI typechecks use the root-pinned TypeScript 7.0.2
compiler. CI also runs Bun 1.4.4's `bun check` across its six workspaces. The
TypeScript 5.9.3 package remains for compiler-API and TypeScript 5 peer
consumers; it is not the CLI typecheck compiler.

The single repository-owned CI workflow runs API, frontend, and complete
browser/API smoke checks on every PR, merge group, and supported branch push.
There are no documentation or tooling path exclusions. The browser job runs
`make e2e-smoke` without a scenario filter; Turbo in `api` owns all package
unit/integration/security/migration tests, typechecks, and the production build.
The always-running PR aggregate rejects failed, cancelled, skipped, or missing
E2E results. The same suites are not replayed through `make e2e-full` afterward.
Monday runs the dependency audit; Wednesday and manual dispatch run the full
release tier. See [CI operations](../../.github/CI.md) for exact checks and
schedules. Concurrency cancels superseded PR runs only.

The classifier fails safe for unknown paths. It marks database, contract,
migration, bootstrap, fixture, E2E, and test-infrastructure paths as
schema-sensitive; mapped application paths use their focused selections. The
schema-sensitive fast path runs the relevant safety and database checks,
including fresh-schema parity on a disposable database; it does not
automatically run the PR or release tier. All tests are not run after every
small edit because selection preserves feedback speed without weakening release
coverage.

Every test tier clears inherited database and backup path overrides and points
`XDG_DATA_HOME` at a unique temporary directory. The tier removes that directory
on success and failure. Database, startup, path-safety, and schema tests must use
disposable synthetic SQLite fixtures. Fresh-schema parity and Playwright create
their own temporary databases; Playwright also generates its XLSX fixtures,
uses dynamic ports and readiness checks, and removes successful run artifacts.
Failure artifacts are retained for diagnosis. Protected-path guards are tested
with synthetic path strings; no tier reads, hashes, snapshots, or copies the
protected S4.3 database.

Turbo tasks run with a strict environment. `TMPDIR` is passed through so test
helpers that use Node's `tmpdir()` follow the caller's value. Before running
tests, ensure that path exists, is writable, and has enough available space and
applicable quota. Backup-retention API fixtures create private roots there and
remove only those roots.

Historical orchestration evidence remains in Git history.

## Staging SSH VM boundary

Staging is a deployment-specific target; no staging SSH host, account, endpoint,
service unit, or remote E2E command is defined by this repository. Before using
one, verify the VM host key against a separately trusted inventory, confirm the
authorized account and test scope, and match the deployed commit and artifact
SHA-256 to the approved release receipt. Confirm the service configuration and
data path point to a disposable synthetic S5.0 database, with no protected or
production database mounted. Obtain an approved restart window before any
service restart.

Within that verified scope, tests may cover read-only health, authentication
and logout using a synthetic account, browser E2E, security tests, SQLite
bootstrap/validation, and restore of a synthetic fixture to a separate
disposable destination. A disposable fresh database should report
`BOOTSTRAPPED 20261027_s50` and `VALID 20261027_s50`. Never restore an
operational snapshot to staging or use real student data. Do not infer a remote
test command from the local suite: `make e2e-smoke` creates and owns its own
local stack, temporary database, credentials, ports, and cleanup; it is not a
remote staging runner. A staging browser test needs an independently reviewed
harness and synthetic test account scoped to that VM.

Keep evidence to sanitized command results, the approved source/artifact
identifiers, and SHA-256 manifests of permitted evidence files. Do not export
credentials, cookies, student data, database copies or hashes, or unredacted
logs. Staging access does not authorize production checks, migration, or
restart outside the approved window.

## Audit execution policy

For direct Bun runs by an agent, use `AGENT=1`, `--dots`, and `--parallel` for
file-level suites proven to be independent. `--concurrent` is reserved for
tests whose in-file concurrency has been separately audited. Use
`--randomize --seed=<value>` to reproduce ordering issues and
`--rerun-each=<n>` for focused flake investigation; retries must not hide a
failure.

The API suite remains serial in the normal gate. Attendance-import and
Excel-heavy tests create disposable SQLite databases with process-unique
filenames. The API suite timed out under Bun worker contention during a
parallel audit, so keep it serial until a new audit confirms that parallel
workers stay within the CI timeout and use isolated resources. The small
contracts, database, Excel, UI, architecture, and boundary suites passed the
parallel audit.

Tests that allocate worker-sensitive resources should use `BUN_TEST_WORKER_ID`
when process identity alone is insufficient. Current API tests use unique
process/time paths, and each E2E run owns its own data root, ports, browser
session, and output directory; no shared worker allocation is currently
required.

Coverage is diagnostic evidence, not an arbitrary repository-wide percentage
gate. Keep reports temporary unless a machine consumer is justified. The API
coverage baseline is collected with Bun's text reporter; Web remains on Vitest
because its React Testing Library, happy-dom, and Vite transform setup is
material to the tests. No Web coverage provider or test-runner migration is
added without a concrete consumer and reproducibility evidence.

E2E remains serial (`workers: 1`) because one run owns the application stack and
evidence directory. The launcher creates a unique disposable data root,
selects runtime ports, polls readiness, records process ownership, and cleans
successful output; failure logs, JUnit, screenshots, and traces are retained
only for diagnosis. Browser assertions should wait on semantic UI or network
state rather than fixed sleeps.

## Three-tier feedback model

Tier 1 is fast local iteration. `mise run test:fast` selects the smallest
relevant work from changed files: focused Bun or Vitest files, the matching
package typecheck (API typecheck included), and the matching lint and boundary
checks. It never launches Playwright and never runs the full API suite for an
isolated edit. A documentation-only change exits immediately. Measure an
ordinary API-domain loop in the low tens of seconds.

Tier 2 is pre-PR readiness. `mise run check:affected` runs the cached Turbo
typecheck, unit-test, and web-build tasks affected since `origin/main`. Add
`make e2e-critical` only when the change affects cross-layer user behavior.
Do not run the full regression before every commit.

Tier 3 is full regression. `mise run check:full` delegates to
`make test-release` and remains the only authoritative broad gate, alongside
the E2E full workflow in CI. Run it for release-sensitive, schema-sensitive,
or difficult changes, and before merge when Tier 2 cannot cover the risk.

## Local resource policy

Tiers already execute serially: one heavyweight lane at a time. Do not run a
Turbo check, a full API suite, a production build, and Playwright
simultaneously on the modest development host. Full API stays serial;
lightweight independent package tests (contracts, DB, Excel, UI, architecture
and boundary checks) keep their proven file-level parallelism.

`make test-fast`, `make test-pr`, and `make test-release` take a nonblocking
per-worktree lock and fail with exit 75 if another tier is already running in
that worktree. Direct E2E or Turbo commands do not take this lock and must still
follow the one-heavyweight-lane policy.

`turbo run typecheck test build` accepts an `OPERATOROS_TURBO_CONCURRENCY`
override and defaults to `4`, which CI keeps. Forced full-graph measurement on
the reference host showed no wall-time difference between concurrency `4` and
`2` (4m43s versus 4m44s); the graph is dependency-bound and saturation comes
from inner runners (Vitest workers, Bun, Vite). Export
`OPERATOROS_TURBO_CONCURRENCY=2` locally only if process pressure, not elapsed
time, is the observed problem.
