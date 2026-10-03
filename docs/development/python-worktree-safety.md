# Python tooling Phase 1E: worktree safety

`scripts/worktree-safety.ts` replaces the Python wrapper with Git's own branch
and worktree checks. Current development documentation now uses Bun. The legacy
Python test's cleanup case is replaced by five Bun tests; its runtime/launcher
tests remain for their separate cutover.

Before deleting the implementation, four disposable fixture scenarios ran against
Python and matched the same pinned exit codes and diagnostics as TS: primary and
unknown paths, dirty paths, merged cleanup, and branch refusal/deletion. The TS
suite also covers intentional safety differences: a primary checkout cannot
be removed when invoked from a secondary checkout, and clean unmerged worktrees
are refused, and `--main` cannot bypass protection of the `main` branch. Git hook environment variables are removed before inspecting the
explicit repository. No force deletion is available.

Verification: Python oracle fixtures 4 passed; Bun tests 5 passed; targeted strict
TypeScript validation passed; lint, architecture, Markdown-link and whitespace
checks passed. The repository scan found zero callers of the removed Python
wrapper after replacing its test and documentation. Other Python runtime, DB,
E2E, API/benchmark fixtures, parity oracles, and legacy pytest tasks remain active.
Historical backend/migration evidence remains frozen.

All Git mutations were confined to owned disposable test repositories. No
protected DB was accessed or migrated, no unrelated worktree was modified, no
architecture boundary was weakened, and no active behavior was removed without
replacement coverage. Original `.rtk/` and `CLAUDE.md` entries remain untouched.
