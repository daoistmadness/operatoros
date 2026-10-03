# Python tooling Phase 1A/1B: documentation checkers

## Scope and parity

Bun replacements for the Markdown-link and current developer-doc checkers use
only existing platform APIs: `Bun.Glob`, filesystem/path APIs, and `Bun.TOML`.
They preserve checked files, historical exclusions, diagnostic ordering and
channels, and failure exit `1`. The TOML rules retain Python truthiness for empty
strings/collections, false, and zero; no parser dependency was added.

Before retirement, `bun test scripts/tests/docs-checkers.test.ts` compared Python and TS CLIs using
controlled repositories. Three cases pass with identical exit/stdout/stderr:
valid inputs; mixed relative/remote/query/fragment/image links with exclusions;
and developer task/command failures including quoted TOML task names. Both TS
checkers also pass on this checkout.

The CI docs job now invokes the TS checkers. `AGENTS.md` and `COMMANDS.md` point
to those commands. The [PR #180 docs job](https://github.com/daoistmadness/operatoros/actions/runs/37059186468/job/111011272344)
successfully executed both TS commands. A repository-wide caller scan then found
only the temporary fixture oracle. That oracle is now TS-only regression coverage
with pinned exit codes, complete stdout/stderr, and diagnostic ordering; the two
Python checker implementations were removed. CI also runs this Bun test suite.
No active caller of the removed checkers remains. No parity difference was required.

## Verification

- `bun test scripts/tests/docs-checkers.test.ts`: 3 passed.
- `bun .github/scripts/check-markdown-links.ts`: passed.
- `bun .github/scripts/check-current-developer-docs.ts`: passed.
- Targeted TypeScript validation of both scripts: passed.
- CI docs job on the TS caller cutover: passed; retirement follow-up awaits CI.
- `git diff --check`: passed.

## Safety and remaining Python

Only checker source, the CI docs caller, and current command references changed.
No protected DB or unrelated worktree was accessed or modified. No active
behavior or architecture safeguard was removed. Existing `.rtk/` and `CLAUDE.md`
entries remain untouched. Python still runs in other CI/tooling, DB/session
commands, E2E, API fixtures/benchmarks, and migration parity tests. Historical
backend/migration evidence remains frozen; S4.3 archival was the preceding,
separately documented policy change.

Full Phase 1 also includes test-scope caller cutover, worktree safety, and eventual
config-helper retirement. Those are separate units and are not completed by this
checker change.
