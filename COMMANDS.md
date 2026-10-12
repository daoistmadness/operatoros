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
- `mise run podman:doctor` — inspect Podman version, rootless mode, storage, and cgroups.
- `mise run podman:build` — build production API/static-web OCI images and the optional development image from `containers/Containerfile`.
- `mise run podman:smoke` — run production images on a private Podman network with loopback-only publication and disposable S4.8 data.
- `mise run podman:dev:smoke` — check rootless containerized API/Vite, the real tailnet HTTPS/WSS route, API proxy, host rejection, and restart behavior.
- `mise run podman:quadlet:check` — validate repository Quadlets through Podman 5.7's generator and `systemd-analyze verify`.
- `mise run podman:quadlet:plan` — show the complete host installation diff without changing Quadlet files.
- `mise run podman:quadlet:install -- --apply` — install reviewed Quadlets after host configuration and external secrets are ready; differing installed files are backed up first.
- `mise run podman:up`, `podman:down`, `podman:restart`, `podman:rebuild`, `podman:status`, and `podman:logs` — manage only the OperatorOS development Quadlet services. `down` and `rebuild` preserve named volumes.
- `mise run podman:security` — scan local API/web images for embedded secrets and HIGH/CRITICAL vulnerabilities and write CycloneDX SBOMs.
- `mise run podman:verify` — run production image smoke, live development/Tailscale smoke, and Quadlet generation checks.
- `mise run deploy:check` — check rootless Podman and canonical schema prerequisites.
- `OPERATOROS_DEPLOY_ENV=staging OPERATOROS_RELEASE_MANIFEST=<file> OPERATOROS_DEPLOY_HOST=<host> mise run deploy:plan` — validate a non-mutating digest-pinned release plan.
- `mise run deploy:apply` — remains blocked until the host infrastructure owner approves a target and adapter.
- `mise run deploy:verify` — verify built OCI images using disposable S4.8 data.
- `mise run deploy:rollback` — fault-inject a local digest failure and verify prior-image recovery with disposable data.
- [Podman and release integration](docs/deployment/PODMAN_INTEGRATION.md) — host configuration ownership, promotion, CI, publication, and deployment limits.
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
- `bun .github/scripts/check-markdown-links.ts` — validate Markdown links.
- `bun .github/scripts/check-current-developer-docs.ts` — validate current command documentation.

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
and Git. Native application startup remains owned by `start-dev.sh`; optional
persistent container startup is owned by rootless Quadlet and systemd.
