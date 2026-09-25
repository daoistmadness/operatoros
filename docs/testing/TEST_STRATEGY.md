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

The classifier fails safe for unknown paths and automatically escalates schema,
migration, startup, and test-infrastructure work. All tests are not run after
every small edit because selection preserves feedback speed without weakening
release coverage. Playwright uses disposable databases and dynamic ports; it
uses observable readiness rather than arbitrary sleeps and removes successful
run artifacts. Each tier snapshots the protected S4.3 database before and after
the run using immutable read-only SQLite; it rejects handles, sidecars, invalid
schema state, or any mutation during that run without treating a live checksum
as a permanent repository constant. Historical orchestration evidence remains in Git history.

## Audit execution policy

For direct Bun runs by an agent, use `AGENT=1`, `--dots`, and `--parallel` for
file-level suites proven to be independent. `--concurrent` is reserved for
tests whose in-file concurrency has been separately audited. Use
`--randomize --seed=<value>` to reproduce ordering issues and
`--rerun-each=<n>` for focused flake investigation; retries must not hide a
failure.

The API suite remains serial in the normal gate. Its attendance-import and
Excel-heavy tests use disposable per-process databases and spawn the retained
Python tooling, but the suite timed out under Bun worker contention during the
audit. It is not safe to enable API `--parallel` until that resource and timing
boundary is repaired and remeasured. The small contracts, database, Excel, UI,
architecture, and boundary suites passed the parallel audit.

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

`turbo run typecheck test build` accepts an `OPERATOROS_TURBO_CONCURRENCY`
override and defaults to `4`, which CI keeps. Forced full-graph measurement on
the reference host showed no wall-time difference between concurrency `4` and
`2` (4m43s versus 4m44s); the graph is dependency-bound and saturation comes
from inner runners (Vitest workers, Bun, Vite). Export
`OPERATOROS_TURBO_CONCURRENCY=2` locally only if process pressure, not elapsed
time, is the observed problem.
