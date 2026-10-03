# Python tooling Phase 2A: development runtime cutover

The existing `scripts/operatoros-dev-runtime.ts` is the only active session
authority. Makefile session status and DB reset's no-active-session guard now use
Bun; the launcher and stop script already did. The Python runtime and config
helper were removed after replacing their three Python test files with maintained
Bun coverage and verifying zero callers. No parallel runtime implementation or
dependency was added.

## Parity and behavior

Before retirement, the Phase 0 gate passed all 21 runtime cases across the 13
required commands: status, classification, cleanup, allocation, initialization,
registration, marking, finalization, active-session refusal, stopping, owned
shutdown, checkout identity, and registry path. Exit codes, structured output,
registry/filesystem effects and error classifications were compared. The existing
TS owner-only modes and native Linux launcher label remain documented intentional
differences from Python.

The final live-process oracle run passed ten scenarios against Python, using the
same pinned decisions/assertions as Bun: active lifecycle, PID reuse, stale cleanup,
sibling protection, partial state and optional-repo mark, removed-checkout metadata,
two-group/descendant shutdown, fallback PIDs, and both frontend/backend discovery
across current, linked, and independent repositories. Fixture listeners close
before exiting to avoid a Python socket-close timing race. Human signal log
formatting is not compared byte-for-byte; machine classifications and shutdown
summary fields are stable.

The port restores optional `--repo` marking and cross-checkout identity fields,
and handles missing listener-discovery executables. Safety remains stricter where
appropriate: backend ownership requires the exact entrypoint, shared pruning
requires a matching owner marker, and cleanup rechecks process identity before
each signal. Legacy arbitrary commands in an app directory cannot become owned
service groups merely by mentioning `server.ts`. Session-root symlinks are refused,
live owned records block finalization, and session-owned database paths remain
protected. No error classification change is being used to bypass a safety gate.

The maintained suite includes 19 Bun tests. Launcher fixtures exercise primary
freshness, dirty/diverged/detached refusal, secondary behavior, sanitized banners,
foreign listeners, legacy DB refusal, and auto-port allocation. Synthetic launchers
use only disposable Git registries/data roots; dependency/package symlinks are
read-only references to installed checkout code. All test mutations and signals
are confined to owned fixtures.

## Scan, safety, and deferred work

Validation executed for this cutover:

- `bun test scripts/tests/dev-runtime.test.ts scripts/tests/worktree-safety.test.ts scripts/tests/test-scope.test.ts scripts/tests/docs-checkers.test.ts`: 55 passed.
- Temporary live Python oracle: 10 scenarios passed before deletion.
- `bun run typecheck:launcher` and strict targeted TypeScript checks of the runtime tests and remaining parity gate: passed.
- `bun packages/db/scripts/python-tooling-parity.ts`: remaining 50 DB/scope cases passed (47 exact matches, three documented canonical-validator/permission differences).
- `mise run doctor` with an owned disposable data root: passed; still requires Python for deferred DB tooling.
- `mise run test:fast` with `TEST_CHANGED_FILES=scripts/operatoros-dev-runtime.ts` and a disposable data override: passed, including 55 tooling tests, DB/contracts/UI suites, and ten fresh DB data-layer tests.
- `bun run lint`, `bun run check:architecture`, both Bun documentation checkers, shell syntax and `git diff --check`: passed.
- Full E2E CI has the recorded timeout; it is not claimed as passing for this unit.

The pre-deletion scan found no execution caller after Makefile and test cutovers
and retirement of the temporary runtime oracle. Remaining mentions are frozen
Phase 13 documentation. The dedicated parity runner now retains only
test-scope comparisons after the subsequent [DB cutover](python-dev-db.md);
the original runtime evidence remains in Phase 0's
report and Git history. Python DB/snapshot commands, E2E, API/golden fixtures and
benchmarks, other parity oracles, and runtime infrastructure remain for later units.
Historical backend and migration source remains frozen.

No protected DB was accessed or migrated. No unrelated worktree was modified. No
architecture boundary or ownership safeguard was weakened, and replacement
coverage preceded removal. User-owned `.rtk/` and `CLAUDE.md` remain untouched.

Full E2E CI's manual-absence-reporting timeout while saving weekdays remains an
unresolved blocker. The owner authorized continuing this tooling migration while
recording it; this unit does not change product behavior or the test timeout.
