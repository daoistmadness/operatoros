# Python tooling Phase 3B: readiness seeder

## Scope

`e2e/helpers/seed-readiness-database.ts` replaces only the small readiness seed.
The runner invokes it with its owned temporary root and validates the lexical
path before canonical bootstrap. Validation and CI use maintained Bun tests.
The Python seeder was removed after caller cutover and parity. The larger smoke
seeder remains for a separate independently validated unit.

The seeder uses `@operatoros/db`'s existing connection and transaction APIs;
schema creation remains the existing canonical bootstrap caller. The new
`db-fingerprint.ts` reads sorted logical contents and uses the existing canonical
schema fingerprint, validator, and current version. It never copies SQL schema or
fingerprint logic. Its CLI and the seeder require an explicit disposable root,
an existing regular DB file, and rejection of symlink components before opening.
The lexical workspace CLI remains file-access-free.

An explicit root `@operatoros/db` development dependency is necessary to resolve
public package exports from E2E tooling. Built-ins cannot provide the canonical
schema/bootstrap authority. It adds one maintained workspace edge, with no
external package or upgrade; root lock metadata changes only that declaration.

## Parity

Two disposable Python/TS database comparisons passed: canonical fresh state and
pre-existing first-admin state. Both have current S4.8, identical **87-table**
sets and per-table counts, matching deterministic fixture values and foreign-key
relationships, zero violations, identical normalized query results and logical
fingerprints. All unrelated tables and migration metadata match.

Only salted password bytes and generated user/provisioning times are normalized.
Both hashes must be Argon2id, verify the same intended synthetic password, and
reject a wrong password. User creation/update times must agree and all normalized
times must fall within the measured fixture creation window. Hash cost/salt
representation follows Bun's maintained fixture API; production auth was not
changed. No row, nullability, or relationship mismatch is hidden.

The old seeder updates an existing first-admin row but does not create one when
absent; both cases remain covered. Duplicate provisioning now rolls back as one
transaction. Additional safety refusals for missing/aliased/outside-root inputs
are intentional. No CLI prints credentials or database rows.

Logical fingerprints preserve all raw fields by default. The comparison oracle
explicitly justified its limited normalization; the helper does not silently
ignore timestamps/password columns. A maintained test verifies SQLite `VACUUM`
does not alter the logical fingerprint while a business-field change does.

## Active scan and deferred work

No execution caller remains for `seed-readiness-database.py`; the readiness
runner itself no longer resolves Python. Its stack wrapper still uses Python
socket allocation. Python smoke seeding/SQL inspection/backend assertions,
API/golden/benchmark fixtures, historical-backend active gates and environment
infrastructure remain. Historical backend and migration evidence stay frozen.

## Validation

Checks executed:

- Pre-removal Python/TS disposable DB comparisons: both fresh and existing-state cases passed across 87 tables, normalized contents/fingerprint, schema and FK checks.
- `bun test scripts/tests/readiness-seeder.test.ts`: five passed.
- Strict targeted `bunx tsc --noEmit`, shell syntax, and `git diff --check`: passed.
- Offline install updated only the workspace dependency declaration; `bun install --frozen-lockfile`: passed.
- `make e2e-validate`, both Bun docs checkers, lint and architecture: passed.
- `mise run test:fast` with `TEST_CHANGED_FILES=e2e/helpers/seed-readiness-database.ts` and an owned disposable data override: passed, including tooling, DB/contracts/UI, and ten fresh DB cases.

Full E2E's weekday-save timeout and
the two unchanged staff API date-fixture failures remain known blockers. The
owner authorized continued tooling migration while recording the E2E blocker.
Full product/E2E CI is not claimed as passing.

## Safety

No protected DB was accessed or migrated. Every seeded or inspected DB was a
synthetic fixture under an owned temporary root. No unrelated worktree was
modified, architecture boundary weakened, or active behavior removed without
replacement coverage. `.rtk/` and `CLAUDE.md` remain untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
