---
status: draft
last_reviewed: 2026-10-26
---

# Ubuntu server deployment and supervision (OperatorOS API)

Draft systemd deployment proposal. This is not an approved or supported
production deployment procedure. It describes the API service template at
`docs/deployment/systemd/operatoros-api.service`. No production deployment has
been performed from this document.

> Unverified: no disposable Ubuntu host drill has exercised these installation,
> service, upgrade, backup, and restore steps.

This runbook covers a single-host Ubuntu deployment of the supported runtime:

- `SQLITE_ONLY_SUPPORTED` — local, file-backed SQLite; PostgreSQL is not supported.
- `LOCAL_BROWSER_RUNTIME` — the React frontend runs in a browser on the same
  host. This proposal binds the API and Vite preview to loopback.
- Native Linux Bun `1.4.4` (no containers required, no Windows/WSL-interop binaries).

## 1. What runs under supervision

| Component | How it runs |
|---|---|
| API (`apps/api`) | Supervised by the proposed systemd unit. |
| Frontend (`apps/web`) | Built once and served by the Vite preview server (section 6); this proposal does not provide a web service unit. |
| Backups/recovery | Via the API admin path or `scripts/backup.sh` / guarded restore (section 9). |

Do not run more than one API instance against the same data root. On Linux, the
canonical API server and CLI backup/restore commands share a data-root `flock`,
so a second API or CLI operation fails closed. The lock does not coordinate
tools that write SQLite directly or ignore it. The runtime still reports
`single_process_only`; SQLite WAL serialization assumes a single writer.

## 2. Prerequisites

- Ubuntu 24.04/26.04 server or VM with systemd; the deployment steps are not yet validated on a production host.
- Packages: `curl`, `lsof` (required by backup/restore handle checks — a missing
  `lsof` fails those checks closed), and `flock` from `util-linux` (required for
  API/CLI data-root exclusion). `git` only when the checkout is updated from a
  remote; offline hosts use a staged bundle instead.
- Native Bun `1.4.4` on Linux:
  - Install with mise (`mise install`) and verify: `bun --version` prints `1.4.4`.
  - Expose it at a stable path for the service:
    `sudo ln -sf "$(readlink -f "$(command -v bun)")" /usr/local/bin/bun`
  - Never point the service at a Windows/WSL-interop binary or `/mnt/*` path.
- A checkout of the repository at `/opt/operatoros` (read-only at runtime), owned
  by the deployer, readable by the service user.
- Service account (no login shell):
  `sudo useradd --system --home /var/lib/operatoros --shell /usr/sbin/nologin operatoros`
- Create the service state directory before any database command runs. Systemd
  `StateDirectory=operatoros` only creates `/var/lib/operatoros` at the first
  service start, and the section 5 bootstrap runs earlier as `operatoros` (on a
  pristine host it fails with `EACCES ... mkdir '/var/lib/operatoros'`):
  `sudo install -d -m 0700 -o operatoros -g operatoros /var/lib/operatoros`
  (mode `0700` matches `StateDirectoryMode=0700`; systemd reuses an existing
  state directory and keeps its owner, group, and mode).

## 3. Paths

| Purpose | Path | Notes |
|---|---|---|
| Checkout | `/opt/operatoros` | read-only at runtime (`ProtectSystem=strict`) |
| Data root | `/var/lib/operatoros/data` | set by the unit; SQLite DB, `backups/`, `logs/` derive from it |
| Environment file | `/etc/operatoros/api.env` | `root:operatoros`, mode `0640` |
| Bun | `/usr/local/bin/bun` | symlink to the pinned 1.4.4 binary |
| Unit | `/etc/systemd/system/operatoros-api.service` | from `docs/deployment/systemd/` |

The example API port `8090` is not a reservation or a claim that the port is
free on a target host. Verify the listener and proxy inventory on the selected
target. Changing the port requires a coordinated update to the API environment,
health check, and frontend proxy.

## 4. Environment file

Create the directory and file with restrictive permissions:

```bash
sudo install -d -m 0750 -o root -g operatoros /etc/operatoros
sudo install -m 0640 -o root -g operatoros /dev/null /etc/operatoros/api.env
```

Content (edit values; the cookie secret must be at least 32 characters):

```ini
HOST=127.0.0.1
PORT=8090
ENABLE_DESTRUCTIVE_OPERATIONS=false
AUTH_COOKIE_SECRET=<paste generated value>

# First-run only: protects first-administrator creation (section 5). Generate it
# like the cookie secret, then remove the line after the administrator exists:
# ASTRYX_SETUP_TOKEN=<paste generated value>

# Optional, when backups must be created on first start:
# BACKUP_ENCRYPTION_KEY=<generated Base64 32-byte key>
# BACKUP_ENCRYPTION_KEY_ID=<short label>
# Optional, set the exact browser origin when a reverse proxy serves the UI:
# ALLOWED_ORIGINS=https://operatoros.example
# Optional, when a reverse proxy connects from this host (exact peer IPs):
# TRUSTED_PROXY_ADDRESSES=127.0.0.1
```

Generate the cookie secret with the documented command (output is the value; never
paste it into the unit file, logs, or chat):

```bash
bun -e 'console.log(require("node:crypto").randomBytes(48).toString("base64url"))'
```

The backup encryption key must differ from the cookie secret; rotation and
retention rules are in `docs/runbooks/secret-rotation.md`.

## 5. First start (fresh data root)

Both database commands require an absolute data directory. Bootstrap refuses a
non-empty directory. Validation opens the database read-only.

```bash
# 1) Create the state directory (section 2), then bootstrap an empty data root
#    (bootstrap fails if the data directory is non-empty):
sudo install -d -m 0700 -o operatoros -g operatoros /var/lib/operatoros
cd /opt/operatoros
sudo -u operatoros OPERATOROS_DATA_DIR=/var/lib/operatoros/data \
  bun run db:bootstrap --data-dir /var/lib/operatoros/data

# 2) Install and start the service:
sudo cp docs/deployment/systemd/operatoros-api.service /etc/systemd/system/operatoros-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now operatoros-api

# 3) Health check (documented, public endpoint):
curl -fsS http://127.0.0.1:8090/health     # -> {"status":"ok"}

# 4) Validate the database (read-only):
sudo -u operatoros bun run db:validate --data-dir /var/lib/operatoros/data
# -> VALID 20261002_s48
```

The API validates existing databases at startup and **never migrates them
automatically**. Application schema head is `20261002_s48`; the protected
operational database stays `20260725_s43` until a separately authorized migration
(`docs/runbooks/database-operations.md`).

## 6. Frontend serving (interim)

```bash
cd /opt/operatoros
bun --filter @operatoros/web build                 # -> apps/web/build
FRONTEND_PORT=5173 BACKEND_PORT=8090 DEV_API_PROXY_TARGET=http://127.0.0.1:8090 \
  bun --filter @operatoros/web preview             # serves build/ with /api proxy
```

Open `http://127.0.0.1:5173` in a browser on the host. Create the first
administrator through the setup screen using the configured
`ASTRYX_SETUP_TOKEN`. After setup, remove that variable from
`/etc/operatoros/api.env` and restart the API. The setup endpoints then stay
closed. Vite preview binds to loopback, so this proposal does not serve the
frontend over a LAN. A supervised web unit mirroring the API template is the
tracked follow-up **P3-01b**.

## 7. Offline prerequisites

The dependency set is fully cacheable; the application has no required outbound
network dependency at runtime. The managed development launcher polls loopback
health endpoints while it starts the API and frontend.

- Prime the Bun cache once on a connected machine, then copy it to the server.
  Use `BUN_INSTALL_CACHE_DIR=/var/lib/operatoros/bun-cache`, the path set by the
  service unit. Keep `bun.lock` and `mise.lock` with the checkout.
  Run the offline install as the deployer from `/opt/operatoros`, replacing the
  cache path with the copied cache directory:

  ```bash
  bun install --frozen-lockfile --offline --cache-dir "/absolute/path/to/primed-cache"
  ```

  The service unit sets `BUN_INSTALL_CACHE_DIR` to
  `/var/lib/operatoros/bun-cache` for runtime writes under the state directory.
  This runtime cache path is separate from the install-time `--cache-dir`.
- The web build is produced offline after the same install.

## 8. Upgrade procedure

1. Create a fresh backup (section 9) and keep the previous checkout revision.
2. Update the checkout (git or staged bundle). Keep `bun.lock`/`mise.lock` aligned.
3. On an offline host, run `bun install --frozen-lockfile --offline --cache-dir "/absolute/path/to/primed-cache"` from `/opt/operatoros`.
4. If the new revision requires a schema change: **stop** and follow
   `docs/runbooks/database-operations.md`. Operational migrations need a separate
   exact-target authorization plus the sanctioned wrapper (backup, lock, preflight).
   `db:migrate-existing` is deliberately guarded to disposable (tmp) data roots and
   refuses to touch a production path.
5. `sudo systemctl restart operatoros-api`, then re-run the health check and a short
   smoke login. Watch `journalctl -u operatoros-api` for the startup summary.

## 9. Backup, restore, and rollback

- Create backups through the admin path (`POST /api/admin/backups` or the Backup
  Management page) or the operator tool:
  `OPERATOROS_DATA_DIR=/var/lib/operatoros/data /opt/operatoros/scripts/backup.sh backup`
  (encrypted AES-256-GCM envelope,
  manifest checksum, append-only audit).
- The API applies count-based retention after each successful backup: it keeps the
  newest 10 complete generations, never evicts the newest backup or a restore
  source, and writes one `backup_evicted` audit line per removed generation.
  Incomplete pairs and files that cannot be removed are skipped. Manual
  `DELETE /api/admin/backups/:filename` remains available. The scheduler's
  `keep_daily`/`keep_weekly`/`keep_monthly` fields do not drive current eviction.
- The scheduler inside the API owns scheduled backups (`/api/admin/backups/scheduler`);
  it is disabled by default. Keep the single-process rule; backups fail closed on
  low disk and a failed capacity probe. Monitor `/api/admin/backups/status`
  (`health_state`, `backup_count`, `retention_limit`, `low_space`) and copy
  encrypted backups off-host.
- Restore: prefer the guarded admin restore for online operations (typed
  confirmation, authenticated admin session, schema/identity validation, a
  pre-restore safety snapshot, and session revocation). For offline recovery,
  run `OPERATOROS_DATA_DIR=/var/lib/operatoros/data /opt/operatoros/scripts/restore.sh`.
  The wrapper invokes the hardened CLI, which verifies encrypted
  artifact identity/authentication, SQLite integrity, foreign keys, schema, and
  administrator credentials; it revokes restored sessions and rolls back to a
  safety snapshot on verified failure. Stop the API and all other writers first.
  The Linux API and CLI share a data-root lock, so CLI restore refuses while the
  API is running; stop the API and any other writers first. CLI audit writes are
  best-effort; follow [Backup and Restore Security](backup-restore.md).
  After a restore, restart the service and sign in again.
- Rollback: restore the pre-upgrade backup, restart the service, re-run the health
  check and `db:validate`, and retain the previous revision until smoke checks pass.

## 10. Logging and monitoring

- Service stdout/stderr: `journalctl -u operatoros-api -f`
  (journald retention applies; per-unit caps can be set in `/etc/systemd/journald.conf`).
- Audit logs: append-only JSONL under `/var/lib/operatoros/data/logs`
  (`backup_operations_audit.jsonl`, auth audit). Log rotation for these files is
  tracked as P3-08; until then monitor disk usage alongside backups.
- Health endpoints: `/health` (public), `/api/system/health` (backup/system state),
  admin readiness routes. A minimal external check is
  `curl -fsS http://127.0.0.1:8090/health` — alerts/watchers are intentionally out
  of scope for this deployment baseline.

## 11. Security properties of the unit

- Dedicated service identity `operatoros`; no login shell; no capabilities
  (`CapabilityBoundingSet=`); `NoNewPrivileges=yes`; `UMask=0077`.
- Filesystem: `ProtectSystem=strict` (checkout read-only), `ProtectHome=yes`,
  `PrivateTmp`, `PrivateDevices`; persistent host writes are limited to the
  state directory (`StateDirectory=operatoros`, mode `0700`) containing the data
  root. `PrivateTmp` provides a private temporary directory.
- Signals: `KillSignal=SIGTERM` with `TimeoutStopSec=30`; the API handles SIGTERM
  with a graceful shutdown (closes HTTP listener and database).
- Deliberate omission: `MemoryDenyWriteExecute=` is **not** set — Bun's
  JavaScriptCore requires writable-executable mappings for JIT. Do not add it.
- Secrets live only in `/etc/operatoros/api.env` (`root:operatoros`, `0640`); the
  unit file contains none.

## 12. Troubleshooting

| Symptom | First check |
|---|---|
| `status=203/EXEC` | Systemd could not execute `/usr/local/bin/bun`. Check the path and executable permissions. Run `bun --version` separately. |
| `EACCES ... mkdir '/var/lib/operatoros'` | The state directory does not exist before bootstrap; create it first (section 2). |
| Address already in use | `ss -ltnp \| grep 8090` — identify the owner; never kill unknown listeners. |
| Startup exits with `DATA_DIR_*` code | Conflicting legacy/new database files in the data root; see `docs/runbooks/database-operations.md`. |
| `BACKUP_OPERATION_LOCKED` | Another API or CLI backup/restore operation holds the data-root lock; wait for it to finish before retrying. |
| `BACKUP_OPERATION_LOCK_UNAVAILABLE` | Install or repair `flock` from `util-linux`; the API cannot safely start without the lock. |
| Backup or restore refuses with `ENOENT` for `lsof` or `DATABASE_OPEN_HANDLE_CHECK_FAILED` | Install or repair `lsof`; the handle check cannot run. |
| Restore refused | `ENABLE_DESTRUCTIVE_OPERATIONS=false`, validation failure, or another process holds the data-root lock — see `docs/runbooks/backup-restore.md`. Keep one API process per data root; the Linux lock is not multi-worker support. |
| Restart loop | `journalctl -u operatoros-api`; note `StartLimitBurst=5`/60 s backoff policy. |
| `Read-only file system` errors at runtime | A write escaped the state directory; keep all writable state under `/var/lib/operatoros`. |

## Validation status

This proposal has not been approved or applied to a production deployment.
Run a fresh review and a disposable-host drill before considering any use.
