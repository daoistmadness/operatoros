# Python tooling Phase 3F: fresh DB and account fixtures

## Scope

Seven API test files now create fresh databases directly through `@operatoros/db`
or use the maintained account-only fixture: auth, admin recovery, data layer,
readiness, safety, tardiness display and E3-A pilot readiness. Their Python setup
subprocesses were removed after comparison. Product assertions and authentication,
backup/restore, recovery and other production implementations remain unchanged.

## Parity

Eight Python setup variants were captured before implementation, including auth
with and without users. Every TS output matches all 87 tables, schema version,
counts, deterministic values, foreign keys/zero violations and normalized logical
fingerprint. Active/inactive accounts, usernames, roles and password verification
match. Only bounded creation/update times and verified Argon2id salts are
normalized. There is no intentional fixture-data difference.

## Active scan and deferred work

These seven files no longer import/spawn Python. API tests and benchmarks have
zero golden Python seed imports. Fifteen custom API test setup callers and one
attendance benchmark remain, alongside E2E smoke seeding/inspection/port allocation/
backend assertions and Python infrastructure. The bridge remains until callers
are gone. Historical backend and golden Python stay frozen.

## Validation

Executed with `OPERATOROS_PYTHON` unset: the seven named API suites (33 pass,
246 assertions). API typecheck, root lint, architecture, both Bun documentation
checkers and `git diff --check` pass. Mandatory push checks run the fast tier.
The full-E2E weekday-save timeout and unchanged staff date-fixture CI failures
remain recorded blockers; full product/E2E CI is not claimed green.

## Safety

No protected DB was accessed or migrated. All tests use owned disposable synthetic
fixtures. No unrelated worktree was modified, architecture boundary weakened or
active behavior removed without replacement/coverage. No dependency was added.
User-owned `.rtk/` and `CLAUDE.md` remain untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
