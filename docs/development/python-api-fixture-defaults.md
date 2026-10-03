# Python tooling Phase 3F/G: API fixture defaults

## Scope

Four API test files now use maintained TS fixtures: core CRUD, data portability,
admin accountability, and report builder. Their old setup invoked historical
Python initialization in addition to golden seeds. `fixtures/defaults.ts` now
owns only the fixture data needed by these tests: the default year/subject,
assessment components, four report presets, and branding. It installs no schema
and is not runtime startup or migration authority.

The golden fixture exposes two explicit default-bearing variants, preserving
before-academic and after-report insertion order. IDs/relationships come from
canonical SQLite inserts. No test assertion, production service, schema,
authentication code, or historical Python source was changed.

## Parity

All four Python setup baselines were pinned before implementation. Their TS
databases match current S4.8, all 87 table sets/counts, deterministic values,
relationships and zero FK violations, normalized query results, and logical
hashes. The initial default year/jenjang IDs and report-year insertion order are
retained, including data used by existing API request filters.

Normalization is limited to verified Argon2id salts, explicitly listed generated
timestamps bounded by each fixture's creation window, and parsed JSON in the six
report-template fields. JSON whitespace differs between Python and TS storage;
the parsed arrays, keys, booleans, defaults and exported API values match.
No unexplained differences remain. Schema fingerprints are validated by the
canonical package and are not duplicated in fixture code.

## Active scan and deferred work

The four converted files no longer import Python, subprocess setup, historical
golden seeds, or backend initialization/patch functions. Together with the prior
unit, six API callers now consume TS-owned fixtures. Six other API test files and
one benchmark still consume golden seeds with custom data. Other Python-backed
API fixtures/benchmarks, smoke seeding/inspection/socket allocation/backend
assertions, historical-backend gates and infrastructure remain. The bridge
`apps/api/tests/python.ts` cannot yet be removed. Historical golden/default
sources stay frozen.

## Validation

Checks executed:

- Four pinned Python setup baselines compared against TS: all 87-table contents/normalized logical hashes and FK checks matched.
- `env -u OPERATOROS_PYTHON bun test` for golden fixtures, core, portability, accountability, report builder, grades and academic logic: 20 passed across seven files.
- API typecheck, lint, architecture, both Bun docs checkers and `git diff --check`: passed, zero architecture exceptions.
- `mise run test:fast` with `TEST_CHANGED_FILES=apps/api/tests/core.test.ts` and an owned disposable data override: passed, including API typecheck and five now-TS-only core slices.

The E2E weekday-save timeout and unchanged
staff date-fixture CI failures remain recorded blockers. The owner authorized
continuing tooling migration while recording the E2E blocker. Full product/E2E
CI is not claimed as passing.

## Safety

No protected DB was accessed or migrated. All database setup, snapshots and API
tests use owned disposable synthetic fixtures. No unrelated worktree was
modified, architecture boundary weakened, or behavior removed without parity and
coverage. No dependency was added. `.rtk/` and `CLAUDE.md` remain untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
