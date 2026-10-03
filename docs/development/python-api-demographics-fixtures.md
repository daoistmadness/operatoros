# Python tooling Phase 3F: demographics fixtures

## Scope

Data-quality and recapitulation tests now use maintained `fixtures/demographics.ts`
through canonical DB APIs and existing fixture defaults. Their Python setup
subprocesses were removed after comparison. Production student/staff analytics
and existing assertions remain unchanged.

## Parity

Both Python setups were pinned before implementation. TS matches all 87 tables,
schema version, counts, deterministic values, foreign-key relationships/zero
violations and normalized logical fingerprints. Null demographic fields, orphan
active master, graduated enrollment, staff status, education and jenjang coverage
remain exact. UUID normalization verifies each named master's exact enrollment
relationship and re-sorts rows. Other normalization covers bounded generated
timestamps, verified password salts and parsed report-template JSON values.
Compact JSON whitespace intentionally differs; parsed values and API-visible
behavior match.

## Active scan and deferred work

API tests now have zero Python import/spawn dependencies. One attendance benchmark
still uses the bridge; it remains until that caller is migrated. E2E smoke seeding/
inspection/port allocation/backend assertions and Python infrastructure remain
active. No API caller imports golden Python seeds. Historical backend and golden
evidence stay frozen.

## Validation

Executed with `OPERATOROS_PYTHON` unset: data-quality and recapitulation suites
(18 pass, 109 assertions). API typecheck, root lint, architecture, both Bun
documentation checkers and `git diff --check` pass. Mandatory push checks run the
fast tier. The full-E2E weekday-save timeout and unchanged staff date-fixture CI
failures remain recorded blockers. Full product/E2E CI is not claimed green.

## Safety

No protected DB was accessed or migrated. Only owned disposable synthetic data
was used. No unrelated worktree was modified, architecture boundary weakened or
active behavior removed without replacement/coverage. No dependency was added.
User-owned `.rtk/` and `CLAUDE.md` remain untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
