# Python tooling Phase 3A: workspace guard and scope retirement

## Scope

`e2e/helpers/create-test-workspace.ts` replaces the lexical pre-open database-path
guard. The smoke runner and Elysia test-stack caller use Bun. Workspace layout,
ownership, port metadata, and cleanup remain governed by existing runners.
Validation uses maintained Bun tests instead of Python syntax compilation for
this helper.

The release isolation assertions moved from Python to
`scripts/tests/e2e-workspace.test.ts`. They still scan frozen backend safety
evidence without opening a DB, require removal of guard-only environment values,
and now include TS in the E2E source scan. The test-scope suite also retains the
release-manifest/tag/no-fixed-sleeps check. CI and tier callers run the Bun tests.

After caller cutover and parity, the Python workspace helper, `test_scope.py`,
both remaining Python tooling test files, and the temporary Phase 0 parity runner
were removed. The obsolete Node-regression exclusion for `test_scope.py` was
removed. Original parity implementations remain available in Git history.

## Parity

Before deletion, ten controlled workspace CLI cases matched exit codes, selected
path, and validation diagnostic. Cases cover absolute/nonabsolute paths, lexical
normalization, escapes, sibling prefix, protected-looking synthetic path, and
runtime-root equality. Python argparse's usage wrapper is not byte-identical to
the Bun diagnostic; the semantic message and exit `2` remain stable. The helper
never accesses the selected database file.

The final scope oracle passed all 37 representative single/multiple-file
comparisons exactly. The maintained scope suite covers path decisions, Git
rename/deletion/untracked discovery, hook isolation, stable tier report output,
and release gates. There is no new TS helper that invokes Python.

## Active scan and deferred work

No execution caller remains for the removed guard, classifier, or isolation
tests. Remaining mentions record migration evidence. Python E2E seeders,
summaries/inline shell, API/golden fixtures/benchmarks, historical-backend active
test gates, and toolchain infrastructure remain for separate units. No
historical backend or golden Python source was edited or removed.

## Validation

Checks executed:

- Python/TS workspace oracle: ten semantic matches; final scope oracle: 37 exact matches before deletion.
- `bun test scripts/tests/test-scope.test.ts scripts/tests/e2e-workspace.test.ts`: 34 passed (29 scope, five workspace/isolation).
- Strict targeted `bunx tsc --noEmit` for the helpers/tests and shell syntax checks: passed.
- `make e2e-validate`: passed, including runner-cleanup and maintained workspace safety tests.
- Both Bun docs checkers, `bun scripts/check-node-regressions.mjs`, `bun run check:architecture`, and `git diff --check`: passed.
- `mise run test:fast` with `TEST_CHANGED_FILES=e2e/helpers/create-test-workspace.ts` and an owned disposable data override: passed, including all tooling tests, DB/contracts/UI, and ten fresh DB cases.

Full E2E CI's weekday
save timeout remains a known blocker, as do the two unchanged staff API fixtures
with fixed October 2 dates. The owner instructed continuing tooling migration
while recording the E2E blocker. Full E2E is CI-only and is not claimed as passing.

## Safety

No protected operational database was accessed or migrated. Path-only fixtures
stay under owned synthetic temporary names; guards reject before opening files.
No unrelated worktree was modified or architecture boundary weakened. Existing
behavior and safety coverage preceded Python removal. `.rtk/` and `CLAUDE.md`
remain untouched. No dependency was added.

PYTHON TOOLING PHASE 3 PASS — active callers migrated as scoped
