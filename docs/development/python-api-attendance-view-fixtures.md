# Python tooling Phase 3F: attendance view fixtures

## Scope

Daily attendance, assigned-class export and student-attendance export now use
maintained `fixtures/attendance-views.ts` through canonical DB APIs and existing
fixture defaults. Their Python setup subprocesses were removed after comparison.
Production authorization/report behavior and existing assertions remain unchanged.

## Parity

All three Python setups were pinned before implementation. TS matches all 87
tables, schema version, counts, deterministic values, foreign-key relationships/
zero violations and normalized logical fingerprints. Teacher assignments,
attendance/overrides, historical absence timestamps and HEB values remain exact.
The assigned-class fixture retains its original Primary hierarchy references and
SMP legacy labels. Generated UUID normalization verifies each named master's
exact enrollment/device relationship and re-sorts normalized rows. Other
normalization covers bounded generated timestamps, verified password salts and
parsed report-template JSON values. Compact JSON storage whitespace differs
intentionally; parsed values and API-visible behavior remain identical.

## Active scan and deferred work

These three files no longer import/spawn Python. Seven custom API test setup
callers and one attendance benchmark remain, alongside E2E smoke seeding/inspection/
port allocation/backend assertions and Python infrastructure. No API caller imports
golden Python seeds. Historical backend and golden evidence stay frozen.

## Validation

Executed with `OPERATOROS_PYTHON` unset: daily attendance, assigned-class export and
student-attendance export suites (13 pass, 70 assertions). API typecheck, root
lint, architecture, both Bun documentation checkers and `git diff --check` pass.
Mandatory push checks run the fast tier. The full-E2E weekday-save timeout and
unchanged staff date-fixture CI failures remain recorded blockers. Full product/
E2E CI is not claimed green.

## Safety

No protected DB was accessed or migrated. Only owned disposable synthetic data
was used. No unrelated worktree was modified, architecture boundary weakened or
active behavior removed without replacement/coverage. No dependency was added.
User-owned `.rtk/` and `CLAUDE.md` remain untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
