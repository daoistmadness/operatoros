# Python tooling Phase 3H: E2E seeding and inspection

## Scope

`e2e/helpers/seed-test-database.ts` replaces the Python smoke seeder with
canonical `@operatoros/db` inserts and `Bun.password` hashing. Base users,
academic metadata, students/masters/devices, attendance, synthetic learners,
enrollments, and grades are ported row-for-row. Upload-conflict fixtures are
seeded as direct `attendance_import_batches/rows` (`CONFLICT`,
`DEVICE_IDENTITY_UNMATCHED` for `991001`/`991002`) and
`student_import_sessions` + `academic_roster_import_batches`
(`POSSIBLE_DUPLICATE` for `RESOLVE-001`) rows satisfying the TS
`upload-conflicts` list queries, instead of driving backend Python services
and `openpyxl` generation. Startup-only `E2E_GATE_ONLY` identities are still
created, then removed after readiness.

`e2e/helpers/choose-port.ts` replaces the Python socket-bind port picker.
`e2e/helpers/db-snapshot.ts`, `db-gate-cleanup.ts`, and `db-verify.ts`
replace the three inline `<<'PY'` SQLite blocks (before fingerprint, gate
cleanup, after verification) in `e2e/run-smoke.sh`. `e2e/run-smoke.sh`,
`e2e/start-elysia-test-stack.sh`, and `e2e/run-full.sh` no longer resolve or
export `OPERATOROS_PYTHON` except for one isolated backend-smoke pytest
invocation. `e2e/README.md` documents the Bun-native flow.

## Parity

The Python seeder was pinned before implementation. On disposable bootstrapped
databases the TS seeder reproduces users (3), students/masters (78),
devices (82), attendance (76), enrollments (76), zero foreign-key violations,
and the conflict preflight (`991001`/`991002` attendance conflicts,
`POSSIBLE_DUPLICATE` roster row, checksums present). The live TS
`/api/upload-conflicts` queue returns two `ATTENDANCE`
`DEVICE_IDENTITY_UNMATCHED` items and one `ROSTER` `POSSIBLE_DUPLICATE`
item, matching the Python `FIXTURE_PREFLIGHT_PASSED` asserts. Before/after
snapshot and verification JSON preserve counts, checksums, enrollment
fingerprints (array-row `sha256`), the `LINK_MASTER` onboarding allowance,
and reset/FK failure semantics. Only password salts, UUIDs, checksums, and
wall-clock attendance dates vary by design.

## Active scan and deferred work

No E2E seeder, inspector, verifier, or port picker imports/spawns Python.
The isolated `e2e/smoke/backend/` pytest gate still runs on the retained
venv until its Bun port lands; it is the only remaining E2E Python caller.
Toolchain plumbing (`scripts/python-tooling-env.ts`, `mise run
python:bootstrap`, test tiers/fresh parity, `turbo.json` passthrough, CI
bootstrap) remains for the final teardown phase. Backend and golden evidence
stay frozen; historical retirement is separately authorized.

## Validation

Executed on disposable synthetic roots (no protected DB): TS seeder exits
`0` with `FIXTURE_PREFLIGHT_PASSED`; queue check via in-process Elysia app
returns the three expected conflict items; `db-snapshot`, `db-gate-cleanup`,
`db-verify`, and `choose-port` complete; `bun build` passes for all five new
helpers; `bash -n` passes for the three edited runners; `make e2e-validate`
passes. API typecheck, root lint, architecture, both Bun documentation
checkers, and `git diff --check` pass. `mise run test:fast` passes.
`make e2e-smoke` (browser, ~300s) was not run here. The full-E2E
weekday-save timeout in `e2e/smoke/web/manual-absence-reporting.spec.ts`
(`PUT /api/attendance/calendar/weekdays`) and unchanged staff date-fixture
CI failures remain recorded blockers. Full product/E2E CI is not claimed
green.

## Safety

No protected DB was accessed or migrated. All datasets use owned disposable
synthetic roots; guards reject non-absolute, escaping, symlinked, and
protected-looking paths before opening files. No unrelated worktree was
modified, architecture boundary weakened, or active behavior removed without
replacement/coverage. No dependency was added. `.rtk/` and `CLAUDE.md`
remain untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
