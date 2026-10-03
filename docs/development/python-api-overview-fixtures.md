# Python tooling Phase 3F/G: overview fixtures

## Scope

Class and management overview tests now call `fixtures/overview.ts`, which
extends the maintained academic fixture through canonical DB APIs. Their Python
bootstrap/golden/custom-SQL subprocess setup was removed after comparison.
Existing product assertions remain unchanged. No production code, schema,
authentication, or historical Python source was edited.

## Parity

Both Python setup baselines were pinned before TS implementation. TS outputs
match current schema, all 87 table sets/counts, deterministic values, FK
relationships/zero violations, normalized results and logical hashes. The shared
grade of 88, linked enrollment, two attendance rows and fixed historical override
are exact. Class scope additionally retains the homeroom assignment and second
class. Generated creation/update times and verified password salts are the only
normalized values; historical attendance/override dates remain exact.

## Active scan and deferred work

The two converted files no longer import or spawn Python or load golden evidence.
Eight API callers now use maintained TS fixtures. Four golden test consumers and
one benchmark remain, alongside other custom API fixtures/benchmarks, E2E smoke
seeding/SQL inspection/socket allocation/backend assertions, historical-backend
gates, and environment infrastructure. Historical golden/default sources remain
frozen, and `apps/api/tests/python.ts` is retained until all callers are gone.

## Validation

Executed: `env -u OPERATOROS_PYTHON bun test apps/api/tests/class-overview.test.ts apps/api/tests/management-overview.test.ts` (6 pass, 29 assertions),
`bun run --filter @operatoros/api typecheck`, `bun run lint`,
`bun run check:architecture`, both Bun documentation checkers, and
`git diff --check` (all pass). `mise run test:fast` with
`TEST_CHANGED_FILES=apps/api/tests/class-overview.test.ts` and an owned disposable
data root passes API typecheck and all five selected core tests.

The E2E weekday-save timeout and unchanged
staff API date-fixture CI failures remain recorded blockers. The owner authorized
continued tooling migration while recording the E2E blocker. Full product/E2E CI
is not claimed as passing.

## Safety

No protected DB was accessed or migrated. All setup/inspection/API tests use
owned disposable synthetic fixtures. No unrelated worktree was modified,
architecture boundary weakened, or behavior removed without comparison and
coverage. No dependency was added. `.rtk/` and `CLAUDE.md` remain untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
