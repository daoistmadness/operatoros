# Python tooling Phase 3F: attendance import fixtures

## Scope

Attendance import and machine preview tests now use maintained functions in
`fixtures/attendance-imports.ts` through canonical DB APIs. Their Python setup
subprocesses were removed after comparison. Import, preview, identity safeguards
and all product assertions remain unchanged.

## Parity

Original Python setups were pinned before implementation, including machine
preview with and without cutoff policy. All three TS outputs match all 87 tables,
schema version, counts, deterministic values, foreign-key relationships/zero
violations and normalized logical fingerprints. Ambiguous device identifiers,
source distinctions, calendar/term rules, missing-policy state and original
attendance remain exact. Generated import UUIDs are normalized only after
verifying each named master's exact legacy/device relationship, then re-sorting
rows. Other normalization covers bounded generated timestamps and verified
password salts. No intentional business-data difference exists.

## Active scan and deferred work

These two files no longer import/spawn Python. Five custom API test setup callers
and one attendance benchmark remain, alongside E2E smoke seeding/inspection/port
allocation/backend assertions and Python infrastructure. No API caller imports
golden Python seeds. Historical backend and golden evidence stay frozen.

## Validation

Executed with `OPERATOROS_PYTHON` unset: attendance import and machine preview
suites (27 pass, 164 assertions). API typecheck, root lint, architecture, both Bun
documentation checkers and `git diff --check` pass. Mandatory push checks run the
fast tier. The full-E2E weekday-save timeout and unchanged staff date-fixture CI
failures remain recorded blockers. Full product/E2E CI is not claimed green.

## Safety

No protected DB was accessed or migrated. Only owned disposable synthetic data
was used. No unrelated worktree was modified, architecture boundary weakened or
active behavior removed without replacement/coverage. No dependency was added.
User-owned `.rtk/` and `CLAUDE.md` remain untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
