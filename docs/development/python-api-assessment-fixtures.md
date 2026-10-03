# Python tooling Phase 3F/G: assessment fixtures

## Scope

Academic analytics and assessment operations tests now use maintained
`apps/api/tests/fixtures/assessments.ts` through canonical DB APIs. Both Python
bootstrap/golden/custom-SQL subprocess setups were removed after comparison.
Existing product assertions, production code and historical Python remain unchanged.

## Parity

Both Python baselines were captured before implementation. Both TS databases
match all 87 tables, schema version, row counts, deterministic values, foreign-key
relationships/zero violations and normalized logical fingerprints. Null and zero
scores, unassigned/outside-class enrollments, all assessment sessions and KKM
thresholds remain exact. Only bounded generated creation/update times and verified
password salts are normalized. No intentional business-data difference exists.

## Active scan and deferred work

The converted files have no Python spawn/import or golden-source dependency.
Ten API callers now use maintained TS fixtures. Two golden test consumers and one
benchmark remain, along with other custom API fixtures/benchmarks, E2E smoke
seeding/inspection/port allocation/backend assertions and Python infrastructure.
The Python bridge remains until all callers are gone. Backend and migration
Python remain frozen; retirement is separately authorized.

## Validation

Executed `env -u OPERATOROS_PYTHON bun test apps/api/tests/academic-analytics.test.ts apps/api/tests/assessment-operations.test.ts`:
9 pass, 60 assertions. API typecheck, root lint, architecture checks, both Bun
documentation checkers and `git diff --check` pass. The mandatory push gate also
runs the fast tier. The E2E weekday-save timeout and unchanged staff date-fixture
CI failures remain recorded blockers. Full product/E2E CI is not claimed green.

## Safety

No protected DB was accessed or migrated. Only disposable synthetic data was
used. No unrelated worktree was modified, architecture boundary weakened or
active behavior removed without replacement/coverage. No dependency was added.
User-owned `.rtk/` and `CLAUDE.md` remain untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
