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

Canonical OPRSERVER production roots reside on LUKS2-encrypted storage (`OPERATOROS_DEPLOY_DIR=/var/lib/operatoros/deploy`, `OPERATOROS_DATA_DIR=/var/lib/operatoros/data`). Because `scripts/docker-deploy.sh` retains legacy `/mnt/podman-data/operatoros/...` defaults when omitted, production invocations MUST export `OPERATOROS_DEPLOY_DIR` and `OPERATOROS_DATA_DIR` explicitly (see [Ubuntu server deployment runbook](docs/runbooks/ubuntu-server-deployment.md)):

- `scripts/docker-deploy.sh verify <candidate-archive.tar> <source-sha>` — verify release archive digest, manifest, SBOM, Trivy scan, and runtime evidence.
- `scripts/docker-deploy.sh migrate <candidate-archive.tar> <source-sha> <target-schema> [deploy-dir]` — execute fail-closed operational migration and release activation under continuous `.deploy.lock` and `.maintenance_lock` writer exclusion, with `scripts/verify-writer-quiescence.py`, attachment-aware encrypted backup, and disposable restore verification.
- `scripts/docker-deploy.sh deploy <candidate-archive.tar> <source-sha> [deploy-dir]` — deploy a schema-compatible verified release artifact with SQLite validation, protected pre-deploy snapshot in `.snapshots/`, atomic symlink switch, and healthcheck verification.
- `scripts/docker-deploy.sh rollback [deploy-dir]` — roll back to the recorded previous release after schema-compatibility verification (`scripts/verify-rollback-schema.py`).
- `scripts/docker-deploy.sh status [deploy-dir]` — report current Docker Compose container status.

## Release qualification and database CLI

- `gh workflow run ci.yml --repo daoistmadness/operatoros --ref main -f docker_qualification=true` — run GitHub-hosted Docker candidate build, scans, isolated consumer check, and provenance attestation (see [CI release bundles](docs/runbooks/release-bundles.md)).
- `gh attestation verify operatoros-docker-candidate.tar --repo daoistmadness/operatoros --signer-workflow daoistmadness/operatoros/.github/workflows/ci.yml --source-ref refs/heads/main --source-digest <source-sha> --deny-self-hosted-runners` — verify SLSA provenance on a downloaded candidate archive.
- `python3 scripts/docker-candidate-release.py verify <candidate-archive.tar> <source-sha>` — verify archive digest, image config digests, SBOMs, Trivy scans, and SPA manifest.
- `bun packages/db/src/db-cli.ts <bootstrap|migrate-existing|validate> --data-dir <absolute-directory>` — disposable database bootstrap, synthetic upgrade (OS temp root only), or read-only validation (`migrate-operational` requires `scripts/docker-deploy.sh migrate`; see [database operations](docs/runbooks/database-operations.md)).
- `OPERATOROS_DATA_DIR=<absolute-directory> bun apps/api/src/backup-cli.ts <backup|restore-disposable <backup-file> <empty-temp-dir>>` — create an attachment-aware AES-256-GCM backup or verify an independent disposable restore (see [Backup and Restore Security](docs/runbooks/backup-restore.md)).
- `bun scripts/check-backup-dir.ts <data-dir>/backups` — read-only containment check for complete encrypted backup pairs and audit files.

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
