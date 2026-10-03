# Python tooling Phase 3F/G: maintained golden fixture foundation

## Scope

`apps/api/tests/fixtures/golden.ts` owns the academic and report fixture data still
required by current API tests. It consumes canonical fresh DB/connection APIs;
it contains fixture inserts, not copied schema, Python ORM models, or business
implementations. `grades.test.ts` and `academic-logic.test.ts` now call the
maintained academic fixture directly instead of the Python bootstrap/golden
bridge. Their behavior assertions remain unchanged.

No historical golden source was deleted or edited. The report fixture is covered
and ready for its remaining callers, which also require independent comparison
of their additional initialization/default data. This is the fixture foundation
and two simple caller cutovers, not a claim that every API bridge is retired.

## Parity

Before implementing the maintained fixtures, the two active families were pinned
from Python into owned disposable canonical DBs. TS generation then matched both
baselines: current S4.8, identical 87-table sets/counts, deterministic business
values, FK relationships/zero violations, normalized queries and logical hashes.
Academic linked/unlinked/ambiguous identities, ended/active enrollment dates and
class flags remain exact. Reports retain seven students/enrollments, 22 attendance
rows, manual absence values, and SMP/SD HEB values.

Normalization is limited to verified Argon2id salts and explicitly listed
generated ledger/creation/update/provisioning times within each measured fixture
window. Passwords must verify the intended synthetic account and reject wrong
input. Every other field, including nulls, IDs, dates, time storage, and migration
metadata, compares exactly. The logical helper retains raw fields by default.
No unexplained decision/output difference remains. Production authentication was
not changed.

## Active scan and deferred work

Neither converted test imports Python, spawns a subprocess, or imports migration
evidence. Ten other API test files and one benchmark still consume golden
academic/report functions, often alongside additional default data and custom
SQL fixtures. Other API fixtures/benchmarks, E2E smoke seeding/inspection/socket
allocation/backend assertions, historical-backend gates, and Python environment
infrastructure remain for later units. `apps/api/tests/python.ts` remains until
its callers are gone. Historical golden Python source stays frozen even after
the final active caller is retired.

## Validation

Checks executed:

- Pinned Python baselines preceded TS fixture implementation; both 87-table DB comparisons passed with matching normalized logical hashes.
- `env -u OPERATOROS_PYTHON bun test apps/api/tests/golden-fixtures.test.ts apps/api/tests/grades.test.ts apps/api/tests/academic-logic.test.ts`: eight passed.
- `bun --filter @operatoros/api typecheck`, `bun run lint`, and `bun run check:architecture`: passed, zero exceptions.
- Both Bun documentation checkers and `git diff --check`: passed.
- `mise run test:fast` with `TEST_CHANGED_FILES=apps/api/tests/grades.test.ts` and an owned disposable data override: passed, including five unchanged core API slices and API typecheck. Those deferred core fixtures still use Python.

Full E2E's weekday-save timeout and unchanged
staff API date-fixture CI failures remain recorded blockers. The owner authorized
continued tooling migration while recording the E2E blocker. Full product/E2E CI
is not claimed as passing.

## Safety

No protected operational DB was accessed or migrated. Fixtures/baselines use
owned temporary roots and synthetic data. No unrelated worktree was modified,
architecture boundary weakened, or active behavior removed without comparison
and coverage. No dependency was added. `.rtk/` and `CLAUDE.md` remain untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
