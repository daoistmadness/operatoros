# Python tooling Phase 3F: attendance read fixtures

## Scope

Attendance CRUD, attendance analytics and correction-review tests now use maintained
`fixtures/attendance-reads.ts` through canonical DB APIs and existing fixture
defaults. Their Python setup subprocesses were removed after comparison.
Production attendance behavior and existing assertions remain unchanged.

## Parity

All three Python setups were pinned before implementation. TS matches all 87
tables, schema version, counts, deterministic values, foreign-key relationships/
zero violations and normalized logical fingerprints. Original hierarchy/default
IDs, status/absence flags, historical dates, override history, HEB and teacher
assignment remain exact. UUID normalization verifies every named master's exact
enrollment relationship and re-sorts rows. Other normalization covers bounded
generated timestamps, verified password salts and parsed report-template JSON.
Compact JSON whitespace intentionally differs; parsed values and API-visible
behavior match.

## Active scan and deferred work

These three files no longer import/spawn Python. Two custom API test setup callers
and one attendance benchmark remain, alongside E2E smoke seeding/inspection/port
allocation/backend assertions and Python infrastructure. No API caller imports
golden Python seeds. Historical backend and golden evidence stay frozen.

## Validation

Executed with `OPERATOROS_PYTHON` unset: attendance, attendance analytics and
correction-review suites (14 pass, 121 assertions). API typecheck, root lint,
architecture, both Bun documentation checkers and `git diff --check` pass.
Mandatory push checks run the fast tier. The full-E2E weekday-save timeout and
unchanged staff date-fixture CI failures remain recorded blockers. Full product/
E2E CI is not claimed green.

## Safety

No protected DB was accessed or migrated. Only owned disposable synthetic data
was used. No unrelated worktree was modified, architecture boundary weakened or
active behavior removed without replacement/coverage. No dependency was added.
User-owned `.rtk/` and `CLAUDE.md` remain untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
