# Python tooling Phase 3F/G: academic benchmark

## Scope

The academic analytics benchmark now uses maintained TS fixture data in
`apps/api/tests/fixtures/academic-benchmark.ts` through canonical DB APIs.
Its Python bootstrap/golden/custom-SQL subprocess was removed after comparison.
The benchmark queries, measurement loop and printed JSON fields remain unchanged.

## Parity

Original Python setups for 100, 500 and 1,000 students were pinned before
implementation. Each TS output matches all 87 tables, schema version, counts,
foreign-key relationships/zero violations and normalized logical fingerprint.
Deterministic DNS UUID-v5 values are exact, generated with Node's existing SHA-1
primitive solely for synthetic identity compatibility. All 2,000/10,000/20,000
score rows, null slots and class assignments match. Only bounded creation/update
timestamps and verified password salts are normalized. There is no intentional
business-data or CLI-field difference; benchmark timings are measurements.

## Active scan and deferred work

API tests and benchmarks no longer import historical golden Python seeds.
Other custom API fixture/benchmark Python callers, E2E smoke seeding/inspection/
port allocation/backend assertions and active Python infrastructure remain.
The bridge remains until all callers are gone. Backend and golden evidence stay
frozen; historical retirement is separately authorized.

## Validation

The benchmark runs with `OPERATOROS_PYTHON` unset: the 100-student case completes
and prints the preserved JSON fields. The owned larger performance run was
stopped with SIGTERM after three minutes; full 500/1,000-student performance
execution is not claimed passing. Dataset parity passes for all three sizes.
API typecheck, root lint, architecture, both Bun documentation checkers and
`git diff --check` pass. Mandatory push checks run the fast tier. The full-E2E
weekday-save timeout and unchanged staff date-fixture CI failures remain recorded
blockers. Full product/E2E CI is not claimed green.

## Safety

No protected DB was accessed or migrated. All datasets and API requests use owned
disposable synthetic databases. No unrelated worktree was modified, architecture
boundary weakened or active behavior removed without replacement/coverage.
No dependency was added. `.rtk/` and `CLAUDE.md` remain untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
