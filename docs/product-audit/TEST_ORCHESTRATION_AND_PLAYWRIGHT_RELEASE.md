# Test Orchestration and Playwright Release Scenarios

## Decision

`ESTABLISH_DETERMINISTIC_RELEASE_SCENARIOS_WHILE_SEPARATING_FAST_PR_AND_RELEASE_TEST_GATES`

This change adds orchestration only. It does not change product behavior, APIs,
payloads, database schema, authorization, or routes, and it does not remove,
skip, or weaken tests.

## Previous topology and measured baseline

Before this change, contributors directly composed pytest, Vitest, build,
fresh-parity, and E2E commands. The canonical release coverage repeated the
complete backend suite twice and ran both Node and Bun frontend tests/builds.
The accepted baseline was:

| Gate | Result | Elapsed |
| --- | --- | ---: |
| Fresh database parity | 15 passed | 9.5s |
| Backend complete pass 1 | 676 passed, 30 skipped | 803s |
| Backend complete pass 2 | 676 passed, 30 skipped | 809s |
| Frontend Node and Bun gates | 292 tests per runtime, both builds passed | 125s |
| Canonical E2E | backend 7, web 14 | 136s |
| Approximate release total | complete coverage | 1,883s |

The repeated backend run is valuable for schema and startup changes, but was
duplicate work during ordinary frontend iteration and PR validation.

## Authoritative commands

```sh
make test-fast
make test-pr
make test-release
```

All commands print the changed paths, risk categories, selected tests and
browser scenarios, selection reasons, backend-pass count, and elapsed time.
Set `TEST_BASE_REVISION` and optionally `TEST_HEAD_REVISION` for a revision
comparison, or newline-delimit paths in `TEST_CHANGED_FILES`. With neither,
tracked and untracked working-tree changes are classified.

### FAST

`make test-fast` is changed-path-aware. It runs focused tests, required static
checks, parity for schema-sensitive changes, and a single build only when
routing/import/generated/build inputs changed. It does not run complete browser
or duplicate complete runtime suites.

Examples:

```sh
TEST_CHANGED_FILES=frontend/src/features/readiness/index.ts make test-fast
TEST_CHANGED_FILES=backend/src/services/readiness.py make test-fast
TEST_CHANGED_FILES=backend/src/migrations/example.py make test-fast
TEST_CHANGED_FILES=docs/example.md make test-fast
```

### PR

`make test-pr` runs classifier tests, boundary/API/type checks, the complete
Node suite and Node build once, one complete backend pass for backend or
high-risk changes (a focused readiness test for frontend-only changes), and
domain-selected Playwright scenarios. Bun tests are not duplicated. A Bun
build runs only for frontend runtime, import, route, dependency, or build
changes.

### RELEASE

`make test-release` retains fresh parity, complete backend, Node and Bun tests
and builds, frontend safety gates, deterministic Playwright scenarios,
canonical E2E validation/smoke, protected-path verification, and cleanup. It
runs the backend twice for models, migrations, bootstrap/schema registration,
database fixtures, E2E lifecycle infrastructure, unknown paths, or
`RELEASE_DOUBLE_BACKEND=1`. Without a reliable base revision it fails safe and
runs twice.

## Classifier and mapping

`scripts/test_scope.py` contains the version-controlled path-to-test map and 19
risk categories. It reads both sides of renames, retains deleted paths, and
includes untracked files. Unknown paths become `UNKNOWN_HIGH_RISK`; source code
cannot silently select no category. The deliberately unrelated
`PROJECT_CONTEXT.md`, `f22`, and optional Dapodik design draft are excluded.
Classifier tests also fail when a mapped test is renamed or deleted.

## Playwright release model

The manifest `e2e/release-scenarios.json` defines ten independently selectable
groups:

`auth`, `readiness`, `configuration`, `attendance`, `corrections`,
`operator-queue`, `uploads`, `reports`, `error-recovery`, and `fresh-install`.

Run all groups through `make e2e-release`, or select one against an already
started E2E stack with:

```sh
cd frontend
npm run e2e:release -- --grep @attendance
```

The canonical harness creates a fresh temporary database from the current
fresh-schema path, seeds only synthetic data, allocates dynamic backend and
frontend ports, uses a fresh browser context, polls observable process
readiness, and never configures `backend/attendance.db`. Playwright has no
`waitForTimeout` calls.

The worker count remains one. Parallel safety has not been proven at the
per-worker process-stack level, so parallel execution is intentionally not
enabled. Invocation-level workspaces, databases, ports, logs, and browser
contexts are isolated. This avoids claiming unsupported concurrency.

Screenshots are failure-only, traces are retained only on failure, and video is
disabled. Successful runs remove runtime directories, databases, downloads,
logs, JUnit output, and Playwright artifacts. Failed runs report the retained
artifact path. Backend and frontend readiness use bounded observable polling;
browser readiness uses locators, responses, URLs, and application state.

## Safety and retained coverage

Each tier records and rechecks the protected database checksum and rejects
sidecars. The E2E engine path must resolve inside
`.runtime/operatoros-e2e`; the production database path is rejected. The
release tier preserves complete backend and frontend runtime coverage plus
fresh database and browser coverage. Test selection reduces iteration and
ordinary-PR duplication, never release coverage.

Measured post-change timings:

| Representative invocation | Elapsed | Reduction vs. 1,883s baseline |
| --- | ---: | ---: |
| FAST docs-only | 0.47s | 99.98% |
| FAST backend unit | 4.14s | 99.78% |
| FAST frontend feature | 36.10s | 98.08% |
| FAST migration/parity | 12.71s | 99.32% |
| PR frontend-only | 194.32s | 89.68% |
| PR backend change | 1,044.26s | 44.54% |
| RELEASE ordinary frontend change | 1,098.58s | 41.66% |

The schema-sensitive two-pass release timing is recorded in the merge report.
Durations are observations, not brittle pass/fail thresholds.
