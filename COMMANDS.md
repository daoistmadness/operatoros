# Commands

`mise tasks` is the current command index. Mise owns developer-facing
commands; the underlying tools retain their existing responsibilities.

## Install

- `mise install` — install the pinned Bun, hk, and Python tools.
- `bun install --frozen-lockfile` — install workspace dependencies from the repository root.
- `mise exec -- python -m venv backend/.venv` — create the retained Python tooling environment.
- `backend/.venv/bin/python -m pip install -r backend/requirements.txt` — install retained tooling.
- `mise run doctor` — verify the active checkout and toolchain.

Optional browser tooling is external to the workspace:

- `npm install -g agent-browser && agent-browser install`
- `agent-browser install --with-deps` — Linux / WSL2 browser dependencies.

## Development

- `mise run dev` — start the managed Elysia and Vite stack through `start-dev.sh`.
- `./start-dev.sh --check` — validate startup prerequisites without starting services.
- `make dev-db-status` — inspect the managed development database.
- `make dev-sessions-status` — inspect managed development sessions.

The default development root is resolved under `XDG_DATA_HOME` (or
`~/.local/share`) and uses `operatoros.sqlite`. A legacy-only
`operatoros-development.db` is migrated safely by startup after validation;
dual, invalid, busy, and unsupported layouts fail closed. Set
`OPERATOROS_DATA_DIR` only when an approved absolute override is intentional.

## Validation

- `mise run check:affected` — run Turbo `typecheck`, `test`, and `build` for packages affected since `origin/main`.
- `mise run check:affected -- --dry=json` — inspect Turbo's selected tasks without running them.
- `mise run test:fast` — run the changed-path-aware validation tier.
- `mise run check:full` — run the complete release-sensitive repository gate.
- `mise run db:fresh` — run fresh SQLite database parity.
- `python .github/scripts/check_markdown_links.py` — validate Markdown links.
- `python .github/scripts/check_current_developer_docs.py` — validate current command documentation.

The affected check requires a current `origin/main`; run `git fetch origin
main` first when the remote-tracking ref is stale or missing. Full PR and CI
validation remains authoritative even when affected checks pass.

## Lower-level ownership commands

- `bun run turbo:check` — run the full Turbo task graph.
- `bun run test:turbo` — verify Turbo invalidation behavior.
- `bun run check` — run the root Bun static and package-test authority.
- `make test-pr` — ordinary PR gate.
- `make test-release` — release, startup, script, and test-infrastructure gate.
- `./scripts/verify-browser.sh` — run the browser smoke test against a live local stack.

Git policy remains owned by hk. Worktree lifecycle remains owned by Worktrunk
and Git. Normal application startup remains owned by `start-dev.sh`.
