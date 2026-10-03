# Python tooling Phase 3F/G: attendance review fixture

## Scope

Management Review attendance export now uses maintained
`apps/api/tests/fixtures/attendance-review.ts` through canonical DB APIs.
Its Python bootstrap/golden/custom-SQL setup was removed after comparison.
Existing product assertions and all historical Python remain unchanged.

## Parity

The original Python fixture was captured before implementation. The TS database
matches all 87 tables, schema version, counts, deterministic values, foreign-key
relationships/zero violations and normalized logical fingerprint. Class-transfer
history, exact effective dates, weekday expectations, late-only enrollment,
recorded cutoff policy and corrected check-ins remain exact. Only bounded
creation/update/change timestamps and verified password salts are normalized.
No intentional business-data difference exists.

## Active scan and deferred work

This caller has no Python spawn/import or historical golden-source dependency.
Eleven API callers now use maintained TS fixtures. One golden test consumer and
one benchmark remain, alongside other custom API fixtures/benchmarks, E2E smoke
seeding/inspection/port allocation/backend assertions and Python infrastructure.
The bridge remains until its callers are gone. Historical backend/migration
Python stays frozen; retirement requires separate authorization.

## Validation

Executed `env -u OPERATOROS_PYTHON bun test apps/api/tests/management-review-attendance-export.test.ts`:
1 pass, 67 assertions. API typecheck, root lint, architecture, both Bun documentation
checkers and `git diff --check` pass. The mandatory push gate runs the fast tier.
The full-E2E weekday-save timeout and unchanged staff date-fixture CI failures
remain recorded blockers. Full product/E2E CI is not claimed green.

## Safety

No protected DB was accessed or migrated. All fixtures are disposable synthetic
data. No unrelated worktree was modified, architecture boundary weakened or active
behavior removed without replacement/coverage. No dependency was added.
User-owned `.rtk/` and `CLAUDE.md` remain untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
