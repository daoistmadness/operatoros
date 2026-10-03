# Python tooling Phase 3D/E: summaries and JSON reads

## Scope

The two E2E summary writers now use Bun. A shared narrow JUnit reader preserves
suite selection, count arithmetic, failed-case ordering, and missing-file
diagnostics. Smoke/full runner callers and syntax-validation paths use the TS
writers and maintained Bun tests. Both Python writers were removed only after
the final caller scan and output parity passed.

Smoke/readiness URL, fingerprint, reset-count, and test-stack PID JSON reads now
use trivial `bun -e` expressions. Stop-test-stack no longer resolves Python.
Database inspection, seeding, socket allocation, and backend smoke remain for
separate units. No large inline TS program was added.

## Dependency decision

JUnit contains XML-escaped names, CDATA, comments, namespaces, and malformed-input
failure requirements. Bun/Node do not provide an XML parser. `saxes@5.0.1` was
already installed and locked through ExcelJS; an explicit root development
dependency reuses that exact version instead of maintaining a custom XML parser.
The lockfile adds only this direct declaration. Maintenance is limited to a small
event API and version pin; there is no parser upgrade or new production
dependency. Parser differences remain guarded by maintained tests and the
pre-removal Python comparison.

## Parity

Before removal, **26 comparisons matched** exit codes, stdout, summary file
bytes (including final newline), and presence of diagnostics. Controlled cases
cover root/multiple/nested suites, descendant test cases, direct failure/error
children, escapes/Unicode, comments/CDATA, namespace behavior, defaults, repeated
explicit failures/evidence, prerequisite failure ordering, missing files,
malformed XML/counts, and invalid CLI arguments. Actual Bun, Vitest and Playwright
JUnit from the disposable CI E2E run also matched.

The full writer intentionally retains Python's status decision from failed-case
names and prerequisites, rather than silently changing it to count arithmetic.
Human parser/argument tracebacks differ; stable summary lines and failure exit
codes do not. DTD declarations, absent from repository-generated JUnit, now fail
closed explicitly instead of supporting internal custom entities. This narrow
input-policy difference is intentional and tested.

## Active scan and deferred work

No active caller remains for either removed Python writer. Remaining Python is
E2E seeders, SQL inspection and socket allocation heredocs, backend smoke, API
test/golden/benchmark fixture bridges, historical-backend test gates, and Python
environment infrastructure. The Phase 4 zero-caller gate has not been reached.
Historical backend and migration evidence remain frozen.

## Validation

Checks executed:

- Pre-removal Python/TS summary gate: 26 comparisons passed with identical stdout/file output and exit codes.
- `bun test scripts/tests/e2e-summaries.test.ts`: eight passed.
- Strict targeted `bunx tsc --noEmit`, shell syntax, and `git diff --check`: passed.
- Offline Bun install updated only the root lockfile declaration; `bun install --frozen-lockfile`: passed.
- `make e2e-validate`, both Bun docs checkers, `bun run lint`, and `bun run check:architecture`: passed.
- `mise run test:fast` with `TEST_CHANGED_FILES=e2e/helpers/write-summary.ts` and an owned disposable data override: passed, including tooling, DB/contracts/UI, and ten fresh DB cases.

Full E2E CI's weekday-save timeout
remains unresolved; the owner instructed continuing tooling migration while
recording it. The two unchanged staff API date fixtures also remain failing in
current CI. Full E2E and the full product graph are not claimed as passing.

## Safety

No protected DB was accessed or migrated. Summary fixtures and comparisons used
owned temporary files and synthetic CI JUnit. No unrelated worktree was modified,
architecture boundary weakened, or active behavior removed without coverage.
User-owned `.rtk/` and `CLAUDE.md` remain untouched.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
