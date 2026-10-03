# Python tooling Phase 3F: reset-test fixture

## Scope

`system.test.ts` now uses maintained `fixtures/reset.ts` through canonical DB
APIs and the existing account fixture. Its Python setup subprocess was removed
after comparison. Reset implementation, safeguards and product assertions remain
unchanged.

## Parity

The original Python setup was pinned before implementation. TS matches all 87
tables, schema version, counts, deterministic values, foreign-key relationships/
zero violations and normalized logical fingerprint. Enrollment, grade, intervention,
attendance, calendar, scheduler, report branding/template and staff mapping rows
remain exact. Only bounded generated timestamps, verified password salts and the
verified version-4 synthetic master UUID are normalized. UUID normalization checks
the exact student 71001 enrollment relationship first. No intentional business-data
difference exists.

## Active scan and deferred work

This caller no longer imports/spawns Python. Twelve custom API test setup callers
and one attendance benchmark remain, alongside E2E smoke seeding/inspection/port
allocation/backend assertions and Python infrastructure. No API caller imports
golden Python seeds. Historical backend and golden evidence remain frozen.

## Validation

Executed `env -u OPERATOROS_PYTHON bun test apps/api/tests/system.test.ts`:
6 pass, 93 assertions. API typecheck, root lint, architecture, both Bun documentation
checkers and `git diff --check` pass. Mandatory push checks run the fast tier.
The full-E2E weekday-save timeout and unchanged staff date-fixture CI failures
remain recorded blockers. Full product/E2E CI is not claimed green.

## Safety

No protected DB was accessed or migrated. Reset tests operate only on owned
synthetic fixtures. No unrelated worktree was modified, architecture boundary
weakened or active behavior removed without replacement/coverage. No dependency
was added. User-owned `.rtk/` and `CLAUDE.md` remain untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
