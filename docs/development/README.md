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
Secondary worktrees, including detached secondary worktrees, can still run. A
detached primary or stale primary `main` checkout fails with a specific
remediation message. Comparisons use freshly fetched `origin` refs on primary
startup.

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

The canonical primary checkout is `$HOME/projects/absensi/school-attendance-analytics`.
Set `OPERATOROS_PRIMARY_CHECKOUT_PATH` only when an installation uses another
absolute path. The launcher compares resolved Git top-level paths with this
value. It never infers the primary role from a folder name.

On primary `main`, startup fetches `origin` and refuses to run while the
checkout is dirty and behind, diverged, detached, or on another branch. A
clean fast-forward uses `git merge --ff-only` and appears in the success
banner. Secondary worktrees report freshness as `N/A (secondary)`.

Session records are mirrored under `operatoros-dev-sessions` inside the shared
Git common directory. Each checkout retains its `.runtime/operatoros-dev/`
files. The shared record includes the common directory, worktree path and role,
branch, commit, process IDs, ports, start time, and status. When a worktree is
removed, a later launcher prunes only its registry entry and never signals its
old process IDs.

Secondary worktrees automatically select alternate ports when another active
worktree session owns the defaults. Use `--fixed-port` to fail instead of
shifting. Run `./stop-dev.sh` from the worktree shown as the owner. Use
`python3 scripts/operatoros-worktree-safety.py delete-branch` only for a branch
already merged into `main`; its `remove-worktree` command accepts clean paths
only and never uses force deletion.
