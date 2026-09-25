# OperatorOS CI performance

Status: Phase 18 implementation.

## CI_EXECUTION_GRAPH_BEFORE

The accepted main CI workflow used three parallel jobs. The `api` job ran
`bun run turbo:check` with `--concurrency=1`. Turbo covered the package
typechecks and tests, plus the web build. The same job then ran direct
contracts, DB, UI, and API typecheck and test commands. The `frontend` job
also ran the web typecheck, test, and build commands.

The duplicate audit identified eleven equivalent package commands:

- four API-job package typechecks;
- four API-job package tests;
- web typecheck;
- web test;
- web build.

Security, hk, runtime health, TypeBox, lint, architecture, fixture,
contract-boundary, UI-boundary, OpenAPI, and documentation checks were not
removed. E2E remained a separate uncached workflow.

The latest accepted main run measured `api` at `184 s`, `frontend` at `39 s`,
and `docs` at `6 s`. The local forced serial Turbo baseline measured
`164.82 s`. These values are labelled `MEASURED`.

## CI_EXECUTION_GRAPH_AFTER

The `api` job now runs setup, security checks, hk checks, one dependency-aware
Turbo command, invalidation proofs, runtime health, TypeBox, lint,
architecture, boundary, and OpenAPI-related checks. Turbo runs with
`--concurrency=4`.

The API job no longer repeats package commands already covered by Turbo. The
frontend job keeps dependency deduplication, UI boundaries, web boundaries,
and OpenAPI drift checks. Turbo remains the required path for web typecheck,
web tests, and the production web build.

The docs job remains independent. The full E2E workflow remains independent,
stateful, and uncached. No required validation category became orphaned.

## Cache strategy

GitHub Actions uses `actions/cache@v5` for:

- Bun's `~/.bun/install/cache`;
- pip's `~/.cache/pip`;
- the API job's `.turbo` directory.

Bun cache keys include Ubuntu and Bun `1.4.2` plus `bun.lock`. Python keys
include Ubuntu, Python `3.12.3`, and `backend/requirements.txt`. Turbo keys
include Ubuntu, Turbo `2.11.4`, `bun.lock`, toolchain files, and global
architecture inputs. Restore keys permit safe reuse. The cache is an
optimization only. Frozen installation still runs.

The Turbo task policy keeps API, DB, and Excel package tests uncached. Those
tests create or mutate disposable state. E2E, runtime, backup, restore,
scheduler, and database migration operations remain uncached. Deterministic
typechecks, contract/UI tests, web tests, and builds remain cacheable.

## Concurrency and isolation

The selected Turbo concurrency is `4`. `--concurrency=1`, `4`, and `8`
completed representative forced runs. Concurrency `4` was selected because
it reduced the serial baseline without relying on maximum runner pressure.
The API test suite stayed in one process. No API test isolation change was
needed. Repeated API and Turbo runs had zero observed flakes, path conflicts,
port conflicts, or environment contamination.

The jobs remain separate. This preserves parallel startup and keeps docs and
frontend failures visible as independent required checks.

## Observability and proof

`bun run turbo:check` prints Turbo task duration and cache summaries. The API
workflow also prints `[CI timing] Turbo check: <seconds>s`. `bun run
test:turbo` proves dependency invalidation for contracts, DB, UI, Excel,
architecture inputs, and `bun.lock`. The proof restores every temporary
mutation.

Measured local results:

| Run | Tasks | Cached | Duration |
| --- | ---: | ---: | ---: |
| Forced serial baseline | 13/13 | 0 | 164.82 s |
| Forced concurrency 4 | 13/13 | 0 | 118.21 s |
| Repeat concurrency 4 | 13/13 | 10 | 84.35 s |

The final GitHub Actions timing is recorded after the PR and merged-main
runs. It must not be inferred from local timings.

## Phase 19 assessment measurement

Phase 19 changed only UI assessment documentation. It changed no workflow,
package, test, or Turbo task. It therefore reintroduced no duplicate
validation and did not change the Phase 18 CI graph.

The Phase 19 PR CI run `33227235892` measured about `1m45s` overall. The API
job took `1m42s`, frontend took `17s`, and docs took `10s`.

The merged-main CI run `33227420488` measured about `1m56s` overall. The API
job took `1m53s`, frontend took `17s`, and docs took `11s`.

The Phase 18 merged-main baseline was `2m00s`. The Phase 19 result has no
material regression. Turbo concurrency remains `4`. New duplicate expensive
validation is `0`.

Because documentation-only changes match the E2E workflow path exclusions,
the full E2E workflow was dispatched manually. PR run `33227247699` passed in
`3m25s`. Merged-main run `33227435136` passed in `3m30s`.

## Safety rules

- `--frozen-lockfile` remains mandatory.
- Cache misses must not change pass or fail results.
- Security and architecture checks remain required.
- No `continue-on-error` hides validation failures.
- No secrets, operator data, runtime databases, backups, or logs enter CI
  caches.
- The protected operational database remains out of scope.
- Provider-managed history cleanup remains pending and unverified.

## Runner baseline

Required Linux CI uses `ubuntu-24.04` explicitly. This keeps production
validation deterministic during GitHub's staged `ubuntu-latest` migration to
Ubuntu 26.04. The separate `Ubuntu 26.04 compatibility canary` runs on
relevant CI and toolchain changes, plus scheduled and manual runs. Its failures
remain visible; required CI is migrated only after the canary is proven stable.

## Test feedback optimization

The required PR path ran three checks twice with equivalent inputs. The
`api` job ran `hk check --all` (lint plus semantic architecture) and then ran
`bun run lint` and `bun run check:architecture` again; it also ran
`bun run check:ui` while the `frontend` job ran the identical command. Each
duplicate is removed: the `api` job keeps the single `hk check --all`
invocation for lint and architecture, keeps its distinct TypeBox, fixture,
contract, runtime, and Turbo steps, and leaves UI boundaries to the
`frontend` job. The `frontend` and `docs` jobs no longer assert an `hk`
version they never execute.

The full E2E workflow no longer triggers on pushes to the main branches. The
pre-merge PR run plus `workflow_dispatch` remain. Post-merge push runs
protected no distinct invariant, and branch protection is not configured, so
the push trigger only duplicated the release regression. Direct pushes still
run the `api`, `frontend`, and `docs` jobs. The workflow keeps ignoring
documentation-only changes and now also ignores `.github/**` and `hk.pkl`,
neither of which can alter application behavior.

`turbo run typecheck test build` keeps `--concurrency=4` by default and
accepts `OPERATOROS_TURBO_CONCURRENCY` for a local-only override. Forced
full-graph measurement on the reference host measured `4m43s` at concurrency
`4` and `4m44s` at concurrency `2` with all tasks recomputed; the graph is
dependency-bound, so the default is unchanged and CI concurrency is untouched.

Turbo cache behavior was audited: repeat runs inside one daemon lifetime hit
cache, but no `.turbo` directory is ever written in the repository, so the
usefulness of the CI `.turbo` cache step is UNKNOWN rather than proven. It is
preserved unchanged pending deeper proof; cache misses must not change pass
or fail results either way.

The fast tier gained API typecheck for backend changes (about `10 s`
measured), closing the asymmetry with the frontend fast path, which already
typechecks. A synthetic API-domain change selects one focused test file plus
typecheck and completes in about `22 s` end to end.

Check classification after this change:

- fast local: `test:fast`, staged lint, docs-only instant exit;
- pre-PR: `check:affected`, plus `e2e-critical` for cross-layer changes;
- required CI: `api`, `frontend`, `docs` jobs plus full E2E on
  non-documentation PRs;
- full regression: `check:full` locally and the E2E full workflow in CI;
- release-only: `@release` E2E scope, the weekly security audit, and the
  canary schedule.

Intentional repeats are kept and named: per-runner installs and Python
bootstraps (runner isolation), unit re-runs inside the full E2E regression
(release evidence), layered boundary enforcement (Phase 14.7 design), and the
checker plus its fixture tests. No test retries were found or added.
