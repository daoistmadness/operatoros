# Development

Use `mise run dev` for normal development. The task delegates process
supervision to `./start-dev.sh`. Verified commands are maintained in
[`COMMANDS.md`](../../COMMANDS.md); architecture and operations authorities are indexed in
[`MEMORY.md`](../../MEMORY.md).

Install the repository-pinned tools with `mise install`; the active Bun runtime
is 1.4.4. Workspace and launcher CLI typechecks use TypeScript 7.0.2. The
TypeScript 5.9.3 package remains for compiler-API and TypeScript 5 peer
consumers. See the [toolchain decision](../architecture/decisions/BUN_TOOLCHAIN.md).

Use `mise run test:fast` for Tier 1, `mise run check:affected` for Tier 2 Turbo
checks against `origin/main`, and `mise run check:full` for the Tier 3
release-sensitive gate. Use `mise run doctor` for read-only environment
diagnostics.

Linux developers may optionally run `./scripts/podman-dev.sh` with rootless
Podman. It uses the same `start-dev.sh` launcher, binds only the frontend to
host loopback (default port 5174), keeps the API inside the container, and
stores isolated development data in the `operatoros-podman-dev-data` volume.
Set `OPERATOROS_PODMAN_PORT` to use another host port from 1024 to 65535.
`Ctrl+C` stops the container while retaining that volume. This is a local
development convenience, not a production or hosted deployment profile.

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

The managed Bun API currently runs without a watcher. A live Bun watch reload
restarted the API before its previous instance released the SQLite operation
lock, so the new process failed with `BACKUP_OPERATION_LOCKED`. Backend reload
remains manual until that lifecycle is safe. Normal launcher shutdown closes
the API's SQLite handle, and the database remains persistent across restarts.
Managed startup disables Bun and Vite environment-file loading for child
processes and supplies the selected loopback bind, origin, cookie, HMR, and
proxy settings explicitly. `backend/.env` is inspected only for a stale
`DATABASE_URL` warning; it does not configure the managed API process.

The canonical primary checkout is `$HOME/code/repos/operatoros`.
Set `OPERATOROS_PRIMARY_CHECKOUT_PATH` only when an installation uses another
absolute path. The launcher compares resolved Git top-level paths with this
value. It never infers the primary role from a folder name.

On primary `main`, startup fetches only `origin/main` without pruning other
remote refs and refuses to run while the checkout is behind, dirty and behind,
diverged, detached, or on another branch.
If it is behind, review and update it manually before rerunning the launcher;
the launcher does not move the branch. Secondary worktrees report freshness
as `N/A (secondary)`.

Session records are mirrored under `operatoros-dev-sessions` inside the shared
Git common directory. Each checkout retains its `.runtime/operatoros-dev/`
files. The shared record includes the common directory, worktree path and role,
branch, commit, process IDs, ports, start time, and status. When a worktree is
removed, a later launcher prunes only its registry entry and never signals its
old process IDs.

Secondary worktrees automatically select alternate ports when another active
worktree session owns the defaults. Use `--fixed-port` to fail instead of
shifting. Run `./stop-dev.sh` from the worktree shown as the owner. Use
`bun scripts/worktree-safety.ts delete-branch` only for a branch already merged
into `main`. Fetch `origin` and verify merged-main first. Its `remove-worktree`
command accepts only clean registered secondary paths whose HEAD is merged into
`main`; it never uses force deletion or removes the primary checkout.

## Backend skill workflow

Load the `elysiajs` skill before Elysia backend implementation, debugging,
review, or explicitly requested migration work with
`bun run skills:load @operatoros/agent-skills#elysiajs`. Read only the
references the task needs.
Inspect `apps/api/package.json`, `bun.lock`, existing routes, and installed
types first. The current backend uses Elysia 1.4.29; the generic skill
describes v2, so use
[v1 documentation](https://elysiajs.com/llms.txt) and v1-compatible examples.
A skill's new-project defaults do not authorize dependency, schema, transport,
authentication, or runtime migrations. See [AGENTS.md](../../AGENTS.md).

The workspace Intent config explicitly allowlists this package and excludes
`@tanstack/intent` guidance. Its scanner reads installed package metadata and
static Markdown without executing package code. Editor hooks are optional
convenience signals, not a security boundary.

## HTTPS development proxy

Choose a verified-unused HTTPS port, then use
`./start-dev.sh --tailnet-origin https://<node>.<tailnet>.ts.net:$DEV_HTTPS_PORT`
for the managed Tailscale HTTPS path. Setup, route ownership, diagnostics, and
its WebSocket limitation are documented in [Tailscale development](tailscale.md).
Local mode stays on loopback without requiring Tailscale.
