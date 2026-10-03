# Python tooling Phase 3F/G: attendance benchmark

## Scope

The attendance analytics benchmark now uses maintained TS fixture data in
`apps/api/tests/fixtures/attendance-benchmark.ts` through canonical DB APIs.
Its Python bootstrap/golden/custom-SQL subprocess was removed after comparison.
The benchmark queries, measurement loop and printed JSON fields remain unchanged.
`apps/api/package.json` test no longer injects `OPERATOROS_PYTHON`; it runs
plain `bun test` since no API test or benchmark caller remains.

## Parity

Original Python setup for 100, 500 and 1,000 students was pinned before
implementation. TS output matches all 87 tables, schema version, counts,
foreign-key relationships/zero violations and normalized logical fingerprint.
Benchmark admin, BENCH program/grade, ten `B1`–`B10` classes, student masters/
enrollments and all 2,000/10,000/20,000 attendance rows match, including the
`(student + day) % 17/53/71` late/sakit/alfa/on-time pattern over 2026-08-01
to 2026-08-20. Only bounded creation/update timestamps and verified password
salts are normalized. There is no intentional business-data or CLI-field
difference; benchmark timings are measurements.

## Active scan and deferred work

No API test or benchmark file imports/spawns Python after this unit. The
`apps/api/tests/python.ts` bridge remains only as dead code until its removal
unit. E2E smoke seeding/inspection/port allocation/backend assertions and
active Python infrastructure (`scripts/python-tooling-env.ts`, `mise run
python:bootstrap`, test tiers/fresh parity, `e2e/run-*.sh`) remain. Backend and
golden evidence stay frozen; historical retirement is separately authorized.

## Validation

Executed with `OPERATOROS_PYTHON` unset: `bun test
apps/api/tests/attendance-analytics.test.ts
apps/api/tests/attendance.test.ts` (11 pass, 103 assertions); `bun
apps/api/benchmarks/attendance-analytics.ts` completes all three sizes
(100/2,000, 500/10,000, 1,000/20,000 records) and prints preserved JSON
fields. API typecheck, root lint, architecture, both Bun documentation
checkers and `git diff --check` pass. `mise run test:fast` passes (30s tier,
including canonical DB tests and fresh-DB parity gate). Mandatory push checks
run the fast tier. The full-E2E weekday-save timeout in
`e2e/smoke/web/manual-absence-reporting.spec.ts` (`PUT
/api/attendance/calendar/weekdays`) and unchanged staff date-fixture CI
failures remain recorded blockers. Full product/E2E CI is not claimed green.

## Safety

No protected DB was accessed or migrated. All datasets and API requests use
owned disposable synthetic databases. No unrelated worktree was modified,
architecture boundary weakened or active behavior removed without
replacement/coverage. No dependency was added. `.rtk/` and `CLAUDE.md` remain
untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
