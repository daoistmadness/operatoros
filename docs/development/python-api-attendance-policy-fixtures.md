# Python tooling Phase 3F: attendance policy fixtures

## Scope

Calendar and class-attendance contract tests now use maintained
`fixtures/attendance-policy.ts` through canonical DB APIs. Their Python setup
subprocesses were removed after comparison. Production calendar/deadline behavior,
contracts and existing assertions remain unchanged.

## Parity

Both Python setups were pinned before implementation. TS matches all 87 tables,
schema version, counts, deterministic values, foreign-key relationships/zero
violations and normalized logical fingerprints. Calendar and contract accounts,
cutoff policy, hierarchy, enrollment and attendance fields remain exact. The
calendar's generated version-4 master UUID is normalized only after verifying its
exact student 1001 enrollment relationship. Other normalization covers bounded
generated timestamps and verified password salts. There is no intentional
business-data difference.

## Active scan and deferred work

These files no longer import/spawn Python. Ten custom API test setup callers and
one attendance benchmark remain, alongside E2E smoke seeding/inspection/port
allocation/backend assertions and Python infrastructure. No API caller imports
golden Python seeds. Historical backend and golden evidence remain frozen.

## Validation

Executed `env -u OPERATOROS_PYTHON bun test apps/api/tests/attendance-calendar.test.ts apps/api/tests/class-attendance-contract.test.ts`:
14 pass, 89 assertions. API typecheck, root lint, architecture, both Bun documentation
checkers and `git diff --check` pass. Mandatory push checks run the fast tier.
The full-E2E weekday-save timeout and unchanged staff date-fixture CI failures
remain recorded blockers. Full product/E2E CI is not claimed green.

## Safety

No protected DB was accessed or migrated. All fixtures are owned disposable
synthetic data. No unrelated worktree was modified, architecture boundary weakened
or active behavior removed without replacement/coverage. No dependency was added.
User-owned `.rtk/` and `CLAUDE.md` remain untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
