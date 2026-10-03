# Python tooling Phase 3F: student fixtures

## Scope

Student-update and roster tests now use maintained `fixtures/students.ts` through
canonical DB APIs. Their Python bootstrap/custom-SQL setup was removed after
comparison. Existing import/conflict/rollback assertions and production behavior
remain unchanged.

## Parity

Both Python setups were captured before implementation. TS outputs match all 87
tables, schema version, counts, deterministic values, foreign-key relationships/
zero violations and normalized logical fingerprints. The update fixture's fixed
student UUID is exact. Roster UUID normalization verifies a single version-4
master UUID and its exact device identity/legacy student relationship. Only that
verified generated UUID, bounded creation/update times and verified password
salts are normalized. There is no intentional business-data difference.

## Active scan and deferred work

Both converted files have no Python import/spawn. Thirteen custom API test setup
callers and one attendance benchmark remain, alongside E2E smoke seeding/
inspection/port allocation/backend assertions and Python infrastructure. There
are no API golden Python seed callers. The bridge remains until all callers are
gone. Historical backend and golden Python remain frozen.

## Validation

Executed `env -u OPERATOROS_PYTHON bun test apps/api/tests/student-update.test.ts apps/api/tests/roster.test.ts`:
7 pass, 93 assertions. API typecheck, root lint, architecture, both Bun documentation
checkers and `git diff --check` pass. Mandatory push checks run the fast tier.
The full-E2E weekday-save timeout and unchanged staff date-fixture CI failures
remain recorded blockers. Full product/E2E CI is not claimed green.

## Safety

No protected DB was accessed or migrated. Only owned disposable synthetic data
was used. No unrelated worktree was modified, architecture boundary weakened or
active behavior removed without replacement/coverage. No dependency was added.
User-owned `.rtk/` and `CLAUDE.md` remain untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
