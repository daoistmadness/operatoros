# Python tooling migration: Phase 0 evidence

This section records the Phase 0 baseline. The subsequent [runtime cutover](python-dev-runtime.md)
retired the runtime/config Python oracle after live-process comparisons and Bun
regression coverage. The [DB/snapshot cutover](python-dev-db.md) retired those
Python implementations after controlled comparisons. The subsequent
[workspace/scope cutover](python-e2e-workspace.md) retired the final 37-case
test-scope Python oracle and its temporary runner;
the original 71-case evidence below remains the cutover baseline.

Phase 0 establishes the Python behavior oracle and TypeScript candidates before
caller cutover. The Ubuntu compatibility workflow's disposable DB bootstrap is
the only active caller switched in this unit. No active Python implementation
has been removed.

## Scope

- [Historical parity gate](https://github.com/daoistmadness/operatoros/blob/13fe51448bb44740e2971b9147ae3b321bf51074/packages/db/scripts/python-tooling-parity.ts): controlled Python/TS runtime, DB, and changed-file comparisons, retained in Git after retirement.
- [Test-scope candidate](../../scripts/test-scope.ts) and [Bun coverage](../../scripts/tests/test-scope.test.ts): preserve the existing path map, decisions, rename/deletion handling, and Git hook environment isolation.
- [Existing TS runtime](../../scripts/operatoros-dev-runtime.ts): restore JSON status/cleanup/owned-stop output, allocation exit `4`, checkout identity, shared port metadata marking, and compatibility worktree-role fields.
- [Existing DB CLI](../../packages/db/src/dev-db-cli.ts): implement `ensure`, `status`, `path`, `reset`, `candidates`, and `adopt` using canonical bootstrap and schema validation.
- [DB CLI coverage](../../packages/db/tests/dev-db-cli.test.ts): 12 synthetic tests covering current creation/adoption, reset preconditions, open handles, corrupt state, symlinks, protected-looking paths, and S4.2/S4.3 preservation/refusal.
- Ubuntu compatibility CI now bootstraps its disposable DB with the TS CLI. Its Python `ensure` step failed with `PERSISTENT_DEVELOPMENT_DATABASE_INITIALIZATION_FAILED`; the TS bootstrap is covered by the focused CLI and canonical DB tests.

The [historical S4.3 wrapper](../migration/legacy-tooling/s43_migration.py) was
archived byte-for-byte after the owner's clarification. The
[archive rationale](../migration/legacy-tooling/README.md) records why current
main does not support that completed operation. No replacement command was added.

## Parity

Historical Phase 0 commands, recorded before the oracle's retirement:

```sh
bun test scripts/tests/test-scope.test.ts packages/db/tests/dev-db-cli.test.ts
bun packages/db/scripts/python-tooling-parity.ts
```

The dedicated migration gate still needs the retained Python tooling environment.
It exits `0` when every comparison matches or has the specifically documented
intentional difference, `1` for an unexplained difference, and `2` for an
unavailable oracle or broken fixture. It does not replace normal repository checks.

All repositories, registries, DBs, and metadata are synthetic and live below an
owned temporary root. Cleanup stops only the launcher created by the gate and
removes only that root. A harness-created loopback listener tests refusal with
`--no-clean`; the operational database is never opened.

Comparisons retain exit codes, structured output, diagnostic channels, file
contents, permissions, and registry effects. JSON key order and wall-clock
metadata are normalized. SQLite schema objects and sorted logical rows are
compared, excluding only migration-ledger application timestamps. Invalid SQLite
fixture bytes are fingerprinted rather than treated as valid databases.

The initial gate found 23 differences. After candidate repairs it reports **71
cases, 67 exact matches, four documented intentional differences, and zero
unexplained differences**. All 37 test-scope fixtures match. The remaining
intentional differences are narrowly checked; unrelated changes in those same
cases still fail:

| Case | Intentional difference |
| --- | --- |
| Runtime initialization | Retain TS owner-only permissions and native Linux launcher metadata instead of the compatibility `wsl` label. |
| Current DB status | The canonical validator accepts the current checksum; the old Python inspector incorrectly hashes Python `repr` rather than canonical JSON. |
| Current DB adoption | Retain TS owner-only permissions on the copied DB. |
| Canonical schema validity | The canonical TS validator, rather than the Python inspector, owns checksum acceptance. |

These are preparatory comparisons. Active service termination and all adversarial
process-ownership cases still require dedicated regression coverage before the
runtime's remaining callers and Python implementation can be retired.

## Legacy database policy

The owner authorized retaining refusal in normal commands. `ensure`, confirmed
`reset`, and `adopt` must preserve and refuse older schema heads, including S4.2
and S4.3. Legacy filename layouts are not automatically migrated. Read-only
`path` and `status` report the canonical target and compatibility;
`candidates` labels older sources incompatible.

The current forward migrator supports fingerprint-approved S4.6/S4.7 sources;
S4.2→S4.3 is a completed historical operation. S4.2 rollback pairs with
`maintenance/s42-rollback`. Any future supported legacy migration requires a
separate, fingerprint-gated TS command before Python retirement. It cannot be
added to ordinary DB commands or startup.

The DB CLI also retains metadata ownership checks and rejects symlinks. Adoption
publishes without overwriting a concurrent destination. Reset requires `RESET`,
rejects sidecars/open handles, and checks an exclusive SQLite lock. No schema
fingerprint, bootstrap SQL, or forward-migration implementation was duplicated.
DB diagnostics retain the Python machine-consumed stdout channel and exit `2`;
this also lets the existing startup caller display the captured failure code.

## Active Python scan and deferred work

Python remains active in Make/mise, CI, test tiers/fresh parity, E2E helpers and
inline shell code, API test/benchmark bridges, retained tooling tests, and this
temporary parity oracle. Python infrastructure cannot yet be removed.
Historical source in `backend/` and `docs/migration/` remains frozen; existing
active fixture imports must be replaced before retirement. The scan is not the
final per-match Phase 4 classification.

Remaining low-risk ports, caller cutovers, protected snapshots, E2E, API fixtures,
and infrastructure removal are subsequent independent units. Root analyst and
workbook deletion decisions have not been made. Historical backend retirement
remains separately unauthorized.

## Validation

Checks executed for this unit:

- `bun install --frozen-lockfile`: passed; lockfile unchanged.
- `bun test scripts/tests/test-scope.test.ts packages/db/tests/dev-db-cli.test.ts`: 38 passed.
- Retained tooling Python, `-m pytest scripts/tests/test_test_scope.py -q`: 39 passed.
- `bun packages/db/scripts/python-tooling-parity.ts`: passed with the four documented differences above.
- `bun run typecheck:launcher` and `bun --filter @operatoros/db typecheck`: passed.
- Targeted `bunx tsc --noEmit --target ESNext --module ESNext --moduleResolution bundler --types bun --typeRoots packages/db/node_modules/@types --strict --skipLibCheck scripts/test-scope.ts scripts/tests/test-scope.test.ts packages/db/scripts/python-tooling-parity.ts`: passed before the latest candidate changes; repeated validation accompanies subsequent units.
- `bun run check:architecture`: passed with candidate repairs; zero exceptions.
- `bun run lint`: passed.
- `git fetch origin main`; `mise run check:affected`: passed, including 268 API tests and all eight selected graph tasks.
- Retained Python Markdown-link and current developer-doc checks: passed before candidate repairs.
- `mise run doctor`, with a disposable data-root override: passed.
- `mise run test:fast`, with the changed candidate paths and disposable data-root override: passed, including canonical DB tests and the 10-test fresh DB parity gate.
- `git diff --check`: passed, including staged new files.

No protected DB or unrelated worktree was accessed or modified. No architecture,
authentication, or schema boundary was weakened. Existing `.rtk/` and `CLAUDE.md`
entries remain untouched. E2E has not been run. Remote CI is running on draft
PR #179; its original Ubuntu bootstrap failure prompted the scoped TS caller
fix above. Full CI success is not yet established.
