---
status: draft
last_reviewed: 2026-10-26
---

# Offline install and start

Draft procedure for a network-isolated or cache-primed host. No offline drill
is claimed. Reproduce each step with a disposable data root and verify the
current network behavior before relying on this guide.

> Unverified: no isolated-network install and runtime drill has run against the
> current lockfile.

The supported runtime is loopback-only and makes no outbound calls while
serving. The first install, the development launcher, and the doctor task are
the network-sensitive parts; the sections below isolate each.

## What works offline and what does not

- Runtime: the API and frontend read only local files and the SQLite database.
  No registry, CDN, or remote API is used while serving.
- `./start-dev.sh` in the PRIMARY checkout fetches only `origin/main` with
  `git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main` in its
  freshness preflight and fails closed without network
  (`PRIMARY_CHECKOUT_REFRESH_FAILED`, `start-dev.sh`). On a SECONDARY worktree
  the freshness check is skipped. The launcher checks that dependencies are
  installed and still runs its loopback `curl` readiness checks; it does not
  install dependencies.
- `mise run doctor` requires a resolvable `origin/main` ref (`git fetch origin
  main` on a fresh clone) and the pinned toolchain.
- `mise install` needs network unless the exact tools are preinstalled or the
  mise tool cache is already populated.
- `bun install --offline` resolves and installs only from the local cache; an
  incomplete cache fails the install instead of using the network.

## Prerequisites

- Native Linux Bun 1.4.4, preinstalled (`bun --version` prints `1.4.4`) or
  provided by a pre-populated mise tool cache. Never a Windows/WSL-interop
  binary.
- The checkout with `bun.lock` and `mise.lock` (the lockfile authorities).
- A primed Bun install cache for the same OS, architecture, and package set.
  Prime it on a connected machine with the exact lockfile. Run from the
  repository root and replace the cache path with its absolute location:

  ```bash
  bun install --frozen-lockfile --cache-dir "/absolute/path/to/primed-cache"
  ```

  `bun install --help` prints `--cache-dir=<val> Store & load cached data from
  a specific directory path`. Copy the primed cache to the offline host.
  The deployment unit candidate sets `BUN_INSTALL_CACHE_DIR` to the same purpose for
  the service; the verified install flag is `--cache-dir`.
- Optional: mise with the tool versions pinned in `mise.toml`.

## Worked sequence (disposable root)

Run from the checkout root. The temporary data directory must stay outside the
repository. This sequence uses only local state.

1. Install dependencies from the primed cache without touching the network:

   ```bash
   bun install --frozen-lockfile --offline --cache-dir "/absolute/path/to/primed-cache"
   ```

   `bun install --help` prints `--offline Never touch the network: resolve and
   install only from the local cache` and `--frozen-lockfile Disallow changes
   to lockfile`. If this fails, the cache is incomplete; re-prime it online.
   `--prefer-offline` (`Use cached package metadata regardless of age; only
   fetch what is missing`) is the online fallback, not an offline mode.

2. Bootstrap and validate a disposable data root:

   ```bash
   export OPERATOROS_DATA_DIR="$(mktemp -d /tmp/operatoros-offline.XXXXXX)"
   bun run db:bootstrap --data-dir "$OPERATOROS_DATA_DIR"   # -> BOOTSTRAPPED 20261002_s48
   bun run db:validate --data-dir "$OPERATOROS_DATA_DIR"    # -> VALID 20261002_s48
   ```

   The CLI usage is `<bootstrap|migrate-existing|validate> --data-dir
   <absolute-directory>`. `bootstrap` refuses a non-empty directory; `validate`
   opens read-only. Ordinary service startup validates existing databases and
   never migrates them.

3. Start the API directly:

   ```bash
   export AUTH_COOKIE_SECRET="$(bun -e 'console.log(require("node:crypto").randomBytes(48).toString("base64url"))')"
   export HOST=127.0.0.1
   export PORT=8090
   bun --filter @operatoros/api start
   ```

   `apps/api` start is `bun run src/server.ts`, which reads `process.env`. Keep
   the server running and check it from a second terminal:

   ```bash
   curl -fsS http://127.0.0.1:8090/health     # -> {"status":"ok"}
   ```

   Sign-in requires an administrator in the data root. For a disposable drill,
   reuse a data root that already has one, or configure `ASTRYX_SETUP_TOKEN`
   before startup and use the first-run screen. The standalone token flow posts
   directly to `/api/setup/admin`; `/api/setup/bootstrap` is available to the
   managed development setup flow. First-run setup is local and needs no
   network.

4. Build and preview the prebuilt web assets:

   ```bash
   bun --filter @operatoros/web build
   FRONTEND_PORT=5173 BACKEND_PORT=8090 DEV_API_PROXY_TARGET=http://127.0.0.1:8090 \
     bun --filter @operatoros/web preview
   ```

   `apps/web` scripts are `build` (`vite build`, output `apps/web/build`) and
   `preview` (`vite preview`). `vite.config.js` reads `FRONTEND_PORT` (default
   5173) and `DEV_API_PROXY_TARGET` (default `http://127.0.0.1:${BACKEND_PORT}`);
   the preview server binds `127.0.0.1` and proxies `/api` to the API. Open
   `http://127.0.0.1:5173`.

5. Optional verification after sign-in: create a manual backup once
   `BACKUP_ENCRYPTION_KEY` and `BACKUP_ENCRYPTION_KEY_ID` are configured; new
   backups refuse without a key. See
   [Production origin and cookie profile](../reference/production-profile.md) and
   [Backup and restore security](../runbooks/backup-restore.md).

## Limits

- `./start-dev.sh` PRIMARY-role freshness requires network
  (`git fetch --prune origin`); use direct API start and preview for offline
  operation, or a SECONDARY worktree whose round-trip is local-only.
- `mise run doctor` requires an `origin/main` ref and the pinned toolchain; on
  a fresh offline bundle without that ref it fails deliberately.
- First-time `mise install` needs network unless the toolchain or its cache is
  preinstalled.
- No package registry access is assumed at any step; all installs come from the
  primed cache and fail closed when it is incomplete.
- Re-prime the cache after any lockfile change, Bun version change, or
  OS/architecture change; a stale cache is not a supported offline source.
- This document does not claim an executed offline validation. Run the
  disposable drill (for example inside `unshare -n` on a workstation) and
  record the results separately.

## Related

- [Ubuntu server deployment proposal](../runbooks/ubuntu-server-deployment.md) (draft).
- [Production origin and cookie profile](../reference/production-profile.md) (draft).
- [Database operations](../runbooks/database-operations.md).
