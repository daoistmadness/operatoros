# Python tooling Phase 2B/C: development DB and protected snapshot

## Scope

The existing `packages/db/src/dev-db-cli.ts` owns `ensure`, `status`, `path`,
`reset`, `candidates`, and `adopt`. Makefile status/reset/candidate/adoption and
mise doctor's DB inspection now invoke Bun. Startup and Ubuntu disposable
bootstrap already did. Canonical data-path resolution, bootstrap, schema
validation, and current migrations remain in `@operatoros/db`.

`packages/db/src/protected-snapshot-cli.ts` replaces the narrow immutable
inspection CLI. Its only active callers were isolation tests, now Bun tests.
After the final caller scan, the two Python implementations and their two Python
test files were removed. The temporary parity runner retains only test scope.
No dependency was added. SQLite URI mode, filesystem/crypto built-ins, existing
`lsof`, and Linux `flock` suffice.

## Parity

Before removal, the expanded DB/scope gate passed **52 comparisons: 47 exact,
five intentional differences, zero unexplained**. All 37 scope cases matched.
DB comparisons covered status/path, creation, candidates/adoption, reset
preconditions, and schema acceptance, including stdout diagnostics, exit codes,
permissions, metadata, schema objects, ledger, sorted rows, and sidecar effects.

| Difference | Reason |
| --- | --- |
| Fresh ensure and confirmed reset | Python's obsolete bootstrap creates S4.7 and exits `2` with `PERSISTENT_DEVELOPMENT_DATABASE_INITIALIZATION_FAILED`. TS creates the canonical validated S4.8 fresh DB. Both have empty business tables. Exact legacy ledger/sidecars were pinned; TS retains owner-only permissions and clean closed state. |
| Current status and schema validity | Canonical TS validation accepts current fingerprints; the old Python inspector incorrectly hashes Python `repr` instead of canonical JSON. |
| Current adoption | TS retains owner-only permissions. |

Normal commands never migrate S4.2/S4.3 or legacy filename layouts. The owner's
intentional refusal policy remains in force. Read-only status/path can describe
older state; mutations preserve it and refuse. The completed S4.3 one-shot wrapper
remains archived as evidence, with no new migration command.

Confirmed reset may replace an unreadable managed DB only after metadata/path,
sidecar, and open-handle checks; live locks still refuse. Separate SQLite calls
preserve the actual first error instead of a secondary rollback error.
Git-local environment variables cannot redirect explicit repository identity.

Seven snapshot safety scenarios passed against both Python and TS before Python
removal. They cover absence, registered-worktree selection, exact hash/stat fields,
immutable SQLite inspection, path/symlink/name refusals, sidecars, open handles,
held migration locks, and invalid state. Only synthetic disposable databases and
an injected fixture lock were used. CLI output retains integer nanoseconds without
floating-point rounding. The production CLI cannot override the migration lock.
Missing/failing inspection tools now fail closed with explicit diagnostics;
noncanonical lexical path spellings are also refused. JSON order/spacing and
usage filename changes are not machine APIs.

## Active scan and deferred work

No execution caller remains for either removed DB Python implementation.
Remaining filename mentions are historical Phase 13 evidence and a negative
assertion that release gates must not invoke snapshots. Python remains active in
test-scope parity, E2E helpers/inline shell, API/golden fixtures/benchmarks, retained
test gates, and Python environment infrastructure. Phase 4's zero-caller gate has
not been met. Historical backend/schema/migration evidence stays frozen.

## Validation

Checks executed:

- Final pre-removal Python/TS DB/scope parity: 52 cases passed as detailed above; snapshot Python oracle: seven passed.
- `bun --filter @operatoros/db test`: 46 passed, including 13 DB CLI and seven snapshot tests.
- `bun --filter @operatoros/db typecheck`, `bun run lint`, `bun run check:architecture`: passed, zero architecture exceptions.
- Both Bun documentation checkers and `git diff --check`: passed.
- `mise run doctor` with an owned disposable data-root override: passed; Python remains required for deferred tools.
- `mise run test:fast` with `TEST_CHANGED_FILES=packages/db/src/dev-db-cli.ts` and disposable data override: passed, including 55 tooling, 46 DB, contracts/UI, and ten fresh DB tests.
- Remaining scope-only oracle: 37 exact matches after DB retirement.

Full E2E CI's
`manual-absence-reporting.spec.ts` weekday-save timeout remains unresolved; the
owner instructed continuing migration while recording it. Runtime CI also failed
two unchanged staff API fixtures whose fixed October 2 dates precede their new
October 3 rows. These product failures are outside this tooling unit and are not
claimed as passing.

## Safety

No protected operational DB was accessed or migrated. Inspection fixtures use
owned temporary Git repositories and synthetic `backend/attendance.db` paths;
their bytes, metadata, and sidecars remain unchanged. No unrelated worktree was
modified. No architecture boundary was weakened or active behavior removed
without replacement coverage. User-owned `.rtk/` and `CLAUDE.md` remain untouched.

PYTHON TOOLING PHASE 2 PASS — active callers migrated as scoped
