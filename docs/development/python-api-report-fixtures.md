# Python tooling Phase 3F/G: report fixture

## Scope

`reports.test.ts` now consumes maintained `fixtures/reports.ts` through canonical
DB APIs. Its Python bootstrap, grade-default, golden and custom-SQL setup was
removed after comparison. Shared fixture defaults now expose their existing grade
data separately; the reports golden fixture derives parent IDs so defaults can
precede it. Existing production code and report assertions remain unchanged.

## Parity

The original Python report setup was pinned before implementation. All 87 tables,
schema version, row counts, deterministic values, foreign-key relationships/zero
violations and normalized logical fingerprint match. Grade defaults precede
report data, preserving year/jenjang IDs without adding presets or branding.
Calendar rules, cutoff policies, Hana enrollment and grade scores remain exact.
Only bounded generated timestamps, verified password salts and Hana's verified
version-4 UUID are normalized. UUID normalization verifies the single matching
master and its exact student/class enrollment relationship before replacement.
There is no intentional business-data difference.

The shared-fixture change also passes complete comparisons against all six earlier
Python baselines: plain academic/reports and the four default-bearing callers.

## Active scan and deferred work

No API test imports golden Python seeds now; one academic benchmark still does.
Twelve API callers use maintained TS fixtures. Other custom API Python fixtures,
benchmarks, E2E seeding/inspection/port allocation/backend assertions and runtime
infrastructure remain active. The Python bridge remains until all its callers
are gone. Historical backend and golden Python stay frozen.

## Validation

Executed with `OPERATOROS_PYTHON` unset: the report, golden, core, portability,
accountability, report-builder, grades and academic-logic suites (30 pass, 634
assertions), followed by the expanded golden suite (5 pass). API typecheck, root
lint, architecture, both Bun documentation checkers and `git diff --check` pass.
The mandatory push gate runs the fast tier. The recorded full-E2E weekday-save
timeout and unchanged staff date-fixture CI failures remain blockers; full product
CI is not claimed green.

## Safety

No protected DB was accessed or migrated. Only owned disposable synthetic fixtures
were used. No unrelated worktree was modified, architecture boundary weakened or
active behavior removed without replacement/coverage. No dependency was added.
User-owned `.rtk/` and `CLAUDE.md` remain untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
