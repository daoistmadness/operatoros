# Commands

`mise tasks` is the current command index. Mise owns developer-facing
commands; the underlying tools retain their existing responsibilities.

## Install

- `mise install` — install the pinned Bun, hk, and Node tools.
- `bun install --frozen-lockfile` — install workspace dependencies from the repository root.
- `mise run doctor` — verify the active checkout and toolchain.

Optional browser tooling is external to the workspace:

- `npm install -g agent-browser && agent-browser install`
- `agent-browser install --with-deps` — Linux browser dependencies on
  `oprserver`.

## Development

- `mise run dev` — start the managed Elysia and Vite stack through `start-dev.sh`.
- `./start-dev.sh --check` — validate startup prerequisites without starting services.
- `make dev-db-status` — inspect the managed development database.
- `make dev-sessions-status` — inspect managed development sessions.

The default development root is resolved under `XDG_DATA_HOME` (or
`~/.local/share`) and uses `operatoros.sqlite`. A legacy-only
`operatoros-development.db`, older schema, dual layout, invalid state, or busy
database fails closed; startup does not migrate or rename existing data.
Use the separately authorized procedure in
[database operations](docs/runbooks/database-operations.md).
Set `OPERATOROS_DATA_DIR` only when an approved absolute override is intentional.

## Validation

- `mise run check:affected` — run Turbo `typecheck`, `test`, and `build` for packages affected since `origin/main`.
- `mise run check:affected -- --dry=json` — inspect Turbo's selected tasks without running them.
- `mise run test:fast` — run the changed-path-aware validation tier.
- `mise run check:full` — run the complete release-sensitive repository gate.
- `mise run db:fresh` — run fresh SQLite database parity.
- `bun .github/scripts/check-markdown-links.ts` — validate Markdown links.
- `bun .github/scripts/check-current-developer-docs.ts` — validate current command documentation.

The affected check requires a locally available `origin/main`; run `git fetch
origin main` first when the remote-tracking ref is stale or missing. It captures
base and head commit SHAs once. A clean tree uses that exact commit range;
staged, unstaged, untracked, deleted, renamed, or configuration changes select
the full Turbo graph. Full PR and CI validation remains authoritative even when
affected checks pass. The pre-push hook fetches once, captures one merge base,
and supplies the same base/head SHAs to all affected local checks.

## Formatting

There is no repository-wide formatter command or automatic formatting hook.
`bun run lint`, `hk check --all`, and `mise run check` do not format files.
Keep formatting edits scoped to files being changed and follow their existing
style; do not run a whole-repository formatter.

## Production deployment

- `scripts/docker-deploy.sh verify <candidate-archive.tar> <source-sha>` — verify release archive digest, manifest, SBOM, scan, and attestation.
- `scripts/docker-deploy.sh migrate <candidate-archive.tar> <source-sha> <target-schema>` — execute fail-closed operational migration and release activation under continuous lock and writer exclusion, with attachment-aware encrypted backup and disposable restore verification.
- `scripts/docker-deploy.sh deploy <candidate-archive.tar> <source-sha>` — deploy verified release artifact with schema validation, protected pre-deploy SQLite snapshot, atomic symlink switch, and healthcheck validation.
- `scripts/docker-deploy.sh rollback` — rollback to recorded previous release.
- `scripts/docker-deploy.sh status` — report current Docker Compose container status.

## Lower-level ownership commands

- `bun run turbo:check` — run the full Turbo task graph.
- `bun run test:turbo` — verify Turbo invalidation behavior.
- `bun run check` — run the root Bun static and package-test authority.
- `make test-pr` — ordinary PR gate.
- `make test-release` — release, startup, script, and test-infrastructure gate.
- `./scripts/verify-browser.sh` — run the browser smoke test against a live local stack.

Git and merge policy is owned by [AGENTS.md](AGENTS.md) and
[CONTRIBUTING.md](CONTRIBUTING.md); hk provides local feedback. Worktree
lifecycle remains owned by Worktrunk and Git. Normal application startup remains owned by `start-dev.sh`.
