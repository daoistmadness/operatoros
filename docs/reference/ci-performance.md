---
status: current
last_reviewed: 2026-10-26
---

# CI performance

[CI operations](../../.github/CI.md) owns current workflows, required check
names, schedules, and cache policy. This document records the execution model
and measured duplication removed. Historical Phase 18/19 benchmarks remain in
Git history.

## Execution model

One repository-owned workflow, `.github/workflows/ci.yml`, runs on PRs,
merge groups, and supported branch pushes. GitHub-managed CodeQL and dependency
workflows remain separate. All runners in the repository-owned workflow use
`ubuntu-26.04`; there is no separate compatibility canary or docs job.

- `api`: frozen install, dependency audit, tooling tests, hk lint/architecture, Turbo package typechecks/tests/build with the TypeScript 7.0.2 CLI, launcher typecheck, the separate Bun 1.4.4 `bun check`, Turbo invalidation proof, disposable runtime health, TypeBox, architecture fixtures, and contract boundaries.
- `frontend`: dependency consistency, package-manager regression checks, UI/web boundaries, OpenAPI drift, and documentation checks.
- `E2E full regression`: complete unfiltered browser/API smoke suite, synthetic reset/enrollment verification, and diagnostic artifacts. It starts alongside package checks.
- `Select E2E scope` and `E2E regression result`: preserve stable required-check names; selection always requires the full browser suite, and the aggregate rejects skipped, failed, cancelled, or missing runs.

Package tests and the web production build run through Turbo instead of being
replayed after the browser suite. The full API suite already includes security,
auth, and backup/restore tests. The Monday dependency audit and Wednesday full
release schedules remain; manual CI dispatch runs release validation and the
browser/API smoke suite. There are no PR path exclusions.

## Measured optimization

Merged-main E2E run `39458747765` took `6m22s` inside `make e2e-full`, including
`4m06s` for its browser/API smoke suite. The remaining `2m16s` repeated API
unit tests, web unit tests, and a production build already enforced by `api`.

After consolidation, [PR #252's CI run](https://github.com/daoistmadness/operatoros/actions/runs/39462804410)
measured `4m02s` inside the smoke command: 50 browser tests and eight API smoke
tests passed. That command was `2m20s` faster than the prior full wrapper,
about 37%. The E2E job including setup took `4m35s` on the PR and `4m41s` on
[merged main](https://github.com/daoistmadness/operatoros/actions/runs/39463785324).
These are observed runs, not a guaranteed latency target; runner queues and
setup affect total PR wait.

## Cache and resource safeguards

Frozen installation and validation still run after cache restore. Only trusted
main push, schedule, or manual runs save setup/browser/task caches. Caches must
never include application databases, records, backups, logs, or credentials.

Turbo defaults to concurrency four. API, DB, and Excel stateful tests remain
uncached; Playwright remains serial within its owned disposable stack. The
local host should run one heavyweight validation lane at a time. Deterministic
cached tasks rely on content hashing and `bun run test:turbo` invalidation
proofs. Cache misses cannot change pass/fail behavior.

The workflow retains `.turbo` cache instrumentation; its effective benefit
must be measured from current run logs rather than assumed. Failed or missing
required checks block merging. No failure is converted to success for speed.
