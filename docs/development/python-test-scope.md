# Python tooling Phase 1D: test scope caller cutover

`Makefile:test-scope` and `scripts/test-tier.sh` now use `scripts/test-scope.ts`.
The existing mise tiers delegate to these callers. The classifier preserves the
Python changed-path decisions; 37 deterministic parity cases passed in Phase 0.
The shell report retains its field names, ordering, yes/no flags, and selection
reasons. Simple JSON extraction now uses Bun. No TS classifier spawns Python.

The Bun suite covers 28 decisions and Git fixtures, including rename/deletion,
multiple paths, preserved user entries, hook-environment isolation, exact report
lines, and release safety gates. The Node regression checker excludes the TS
classifier for the same reason as its Python predecessor: it recognizes a
historical lockfile name as a changed-path trigger.

Verification: focused Bun tests and strict targeted TypeScript validation passed;
shell syntax, Node regression checks, and `git diff --check` passed. The docs-only
fast tier passed. The schema-sensitive fast tier is also required before this
unit is published; its result is recorded in the PR.

Python remains in the dedicated Phase 0 parity oracle, the mise legacy pytest
task, API fixture bootstrap, and release protected-data isolation tests. Therefore
`test_scope.py` and its Python tests remain until those callers are retired. This
unit switches active tier selection without falsely claiming zero Python callers.
Other active DB/session, E2E, safety, and benchmark Python paths remain for their
own cutovers. Frozen backend and migration evidence remains unchanged.

All fixtures are disposable synthetic data. No protected DB was accessed or
migrated, no unrelated worktree was modified, and no architecture boundary or
release gate was weakened. Original `.rtk/` and `CLAUDE.md` entries remain untouched.
