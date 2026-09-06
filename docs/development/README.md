# Development

Use `mise run dev` for normal development. The task delegates process
supervision to `./start-dev.sh`. Verified commands are maintained in
[`COMMANDS.md`](../../COMMANDS.md); stable decisions are maintained in
[`MEMORY.md`](../../MEMORY.md).

Use `mise run doctor` for read-only environment diagnostics,
`mise run check:affected` for Turbo checks against `origin/main`, and
`mise run check:full` for the complete release-sensitive gate.

## Identify the running checkout

`./start-dev.sh` prints the repository path, branch, commit, working-tree
status, and upstream ahead/behind counts before checking the environment.
Detached HEAD is supported. Dirty or behind checkouts can still run.
A stale primary `main` checkout gets a visible warning. Comparisons use local
Git refs; run `git fetch origin` to refresh them.

Git worktrees share a Git common directory, but each checkout stores its
session state under `.runtime/operatoros-dev/`. TCP ports are machine-global.
Only one checkout can normally use frontend port 5173 and backend port 8000.
A conflict message identifies the running checkout when process evidence is
available. Run `./start-dev.sh --auto-port` in another worktree to select and
print alternate ports. A second launcher in the same checkout reports the
existing session and URLs, then exits with the existing preflight code 2.

Run `make dev-sessions-status` from a checkout to inspect its managed session.
Run `./stop-dev.sh` from the checkout that owns that session. Other worktrees,
unrelated processes, and unverifiable listeners are never stopped to claim
ports. `./start-dev.sh --verbose` includes ownership diagnostics without raw
process arguments or environment values, which can contain secrets.

The launcher prints the resolved development data root and database path.
Development data may be shared across worktrees because the default data-root
hash uses the Git common directory. Alternate ports do not isolate data.
Use an explicit disposable `OPERATOROS_DATA_DIR` for tests. The data-root
hashing scheme is unchanged. Never point development tooling at protected
operational databases.
