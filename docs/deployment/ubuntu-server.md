# Ubuntu server deployment and supervision (OperatorOS API)

Status: **review candidate for Phase 3 P3-01** — integrate into the repository only
after owner review. Scope: one systemd service template
(`docs/deployment/systemd/operatoros-api.service`) plus this runbook. Both are new
files; nothing else changes. No production deployment is performed by this document.

This runbook covers a single-host Ubuntu deployment of the supported runtime:

- `SQLITE_ONLY_SUPPORTED` — local, file-backed SQLite; PostgreSQL is not supported.
- `LOCAL_BROWSER_RUNTIME` — the React frontend runs in a browser on the same host or
  LAN; the API serves only HTTP on a local socket.
- Native Linux Bun `1.4.3` (no containers required, no Windows/WSL-interop binaries).

## 1. What runs under supervision

| Component | How it runs |
|---|---|
| API (`apps/api`) | **Supervised by the systemd unit** (this document). |
| Frontend (`apps/web`) | Built once, served by the Vite preview server (section 6). Interim: started by the operator; a second unit template is a tracked follow-up (P3-01b). |
| Backups/recovery | Via the API admin path or `scripts/backup.sh` / guarded restore (section 9). |

Do not run more than one API instance against the same data root. Backup,
restore, and scheduler guards are process-local and do not coordinate separate
processes; the runtime reports `single_process_only` but cannot detect a second
process. SQLite WAL serialization also assumes a single writer.

## 2. Prerequisites

- Ubuntu 24.04/26.04 server or VM with systemd (validated against systemd 259).
- Packages: `curl`, `lsof` (required by backup/restore handle checks — a missing
  `lsof` fails those checks closed), `python3` (documented secret generation).
  `git` only when the checkout is updated from a remote; offline hosts use a staged
  bundle instead.
- Native Bun `1.4.3` on Linux:
  - Install with mise (`mise install`) and verify: `bun --version` prints `1.4.3`.
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
| Bun | `/usr/local/bin/bun` | symlink to the pinned 1.4.3 binary |
| Unit | `/etc/systemd/system/operatoros-api.service` | from `docs/deployment/systemd/` |

## 4. Environment file

Create the directory and file with restrictive permissions:

```bash
sudo install -d -m 0750 -o root -g operatoros /etc/operatoros
sudo install -m 0640 -o root -g operatoros /dev/null /etc/operatoros/api.env
```

Content (edit values; the cookie secret must be at least 32 characters):

```ini
OPERATOROS_BACKEND=elysia
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
# Optional, when the browser is not on loopback (comma-separated exact origins):
# ALLOWED_ORIGINS=http://127.0.0.1:5173
# Optional, ONLY when a reverse proxy owns the socket (exact peer IPs):
# TRUSTED_PROXY_ADDRESSES=127.0.0.1
```

Generate the cookie secret with the documented command (output is the value; never
paste it into the unit file, logs, or chat):

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

The backup encryption key must differ from the cookie secret; rotation and
retention rules are in `docs/security/ROTATION_RUNBOOK.md`.

## 5. First start (fresh data root)

All database commands expect an absolute data directory and are safe to re-run.

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

# 3) Create the first administrator (first run only; token from section 4).
#    The setup screen asks for the token once the frontend runs (section 6).
#    Headless API equivalent (the values are read from the request body; replace
#    the placeholders and never pass the password as a command argument):
curl -fsS -X POST http://127.0.0.1:8090/api/setup/admin \
  -H 'content-type: application/json' --data @- <<'JSON'
{"username":"admin","password":"REPLACE-12-CHARS-MINIMUM","password_confirmation":"REPLACE-12-CHARS-MINIMUM","setup_token":"REPLACE-WITH-SECTION-4-TOKEN"}
JSON
#    A missing or wrong token is refused with 403
#    (SETUP_TOKEN_REQUIRED / SETUP_TOKEN_INVALID); without a configured token on
#    a fresh root, first-run provisioning stays closed. After the administrator
#    exists, remove the ASTRYX_SETUP_TOKEN line from /etc/operatoros/api.env and
#    restart: sudo systemctl restart operatoros-api
#    (once a user exists, the setup endpoints stay closed permanently.)

# 4) Health check (documented, public endpoint):
curl -fsS http://127.0.0.1:8090/health     # -> {"status":"ok"}

# 5) Validate the database (read-only):
sudo -u operatoros bun run db:validate --data-dir /var/lib/operatoros/data
# -> VALID 20261002_s48
```

The API validates existing databases at startup and **never migrates them
automatically**. Application schema head is `20261002_s48`; the protected
operational database stays `20260725_s43` until a separately authorized migration
(`docs/operations/DATABASE_OPERATIONS.md`).

## 6. Frontend serving (interim)

```bash
cd /opt/operatoros
bun --filter @operatoros/web build                 # -> apps/web/build
FRONTEND_PORT=5173 DEV_API_PROXY_TARGET=http://127.0.0.1:8090 \
  bun --filter @operatoros/web preview             # serves build/ with /api proxy
```

Open `http://127.0.0.1:5173` in the browser on the host (or the host's address on a
trusted LAN; then also set `ALLOWED_ORIGINS` accordingly). A supervised web unit
mirroring the API template is the tracked follow-up **P3-01b**.

## 7. Offline prerequisites

The dependency set is fully cacheable; nothing at runtime requires the network
(the API only calls its own loopback health endpoint during startup checks).

- Prime the Bun cache once on a connected machine, then copy it to the server, e.g.
  `BUN_INSTALL_CACHE_DIR=/var/cache/operatoros-bun` (the Offline installs validated
  in Phase 2 used a primed cache of the exact lockfile; keep `bun.lock` and
  `mise.lock` with the checkout).
- Offline install: `cd /opt/operatoros && BUN_INSTALL_CACHE_DIR=... bun install --frozen-lockfile`
  (no registry traffic once the cache is primed; the service unit sets the cache
  directory under the state directory so runtime writes never touch the checkout).
- The web build is produced offline after the same install.

## 8. Upgrade procedure

1. Create a fresh backup (section 9) and keep the previous checkout revision.
2. Update the checkout (git or staged bundle). Keep `bun.lock`/`mise.lock` aligned.
3. `bun install --frozen-lockfile` (cache-primed offline installs are supported).
4. If the new revision requires a schema change: **stop** and follow
   `docs/operations/DATABASE_OPERATIONS.md`. Operational migrations need a separate
   exact-target authorization plus the sanctioned wrapper (backup, lock, preflight).
   `db:migrate-existing` is deliberately guarded to disposable (tmp) data roots and
   refuses to touch a production path.
5. `sudo systemctl restart operatoros-api`, then re-run the health check and a short
   smoke login. Watch `journalctl -u operatoros-api` for the startup summary.

## 9. Backup, restore, and rollback

- Create backups through the admin path (`POST /api/admin/backups` or the Backup
  Management page) or the operator tool: `OPERATOROS_DATA_DIR=/var/lib/operatoros/data
  /opt/operatoros/scripts/backup.sh backup` (encrypted AES-256-GCM envelope,
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
- Restore: use the guarded admin restore (typed confirmation, schema/identity
  validation, a pre-restore safety snapshot, and session revocation). The legacy
  CLI restore is an operator tool with fewer safeguards — prefer the admin path;
  CLI hardening is tracked as P3-06. After a restore, restart the service and sign
  in again.
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
  `PrivateTmp`, `PrivateDevices`; the only writable tree is the state directory
  (`StateDirectory=operatoros`, mode `0700`) containing the data root.
- Signals: `KillSignal=SIGTERM` with `TimeoutStopSec=30`; the API handles SIGTERM
  with a graceful shutdown (closes HTTP listener and database).
- Deliberate omission: `MemoryDenyWriteExecute=` is **not** set — Bun's
  JavaScriptCore requires writable-executable mappings for JIT. Do not add it.
- Secrets live only in `/etc/operatoros/api.env` (`root:operatoros`, `0640`); the
  unit file contains none.

## 12. Troubleshooting

| Symptom | First check |
|---|---|
| `status=203/EXEC` | `/usr/local/bin/bun` missing or wrong version (`bun --version` must print `1.4.3`). |
| `EACCES ... mkdir '/var/lib/operatoros'` | The state directory does not exist before bootstrap; create it first (section 2). |
| Address already in use | `ss -ltnp \| grep 8090` — identify the owner; never kill unknown listeners. |
| Startup exits with `DATA_DIR_*` code | Conflicting legacy/new database files in the data root; see `docs/operations/DATABASE_OPERATIONS.md`. |
| Backup or restore refuses with `*_LSOF_REQUIRED` | Install `lsof`. |
| Restore refused | Single-worker guard, `ENABLE_DESTRUCTIVE_OPERATIONS=false`, or validation failure — see `docs/security/backup-restore.md`. |
| Restart loop | `journalctl -u operatoros-api`; note `StartLimitBurst=5`/60 s backoff policy. |
| `Read-only file system` errors at runtime | A write escaped the state directory; keep all writable state under `/var/lib/operatoros`. |

## 13. Validation record

This candidate was validated on 2026-10-16 without any production deployment:

- `systemd-analyze verify` (as-delivered, with expected substitution warnings
  documented) and a normalized copy (clean pass), plus
  `systemd-analyze security` offline scoring.
- A disposable runtime drill: bootstrap (`BOOTSTRAPPED 20261002_s48`), validate
  (`VALID 20261002_s48`), the exact `ExecStart` command line started the API on a
  loopback port, `/health` answered `{"status":"ok"}`, and SIGTERM to the process
  group (systemd's default cgroup signal) released the port with the database
  still validating afterwards.
- Exact evidence: see the Loop 11 report and record set in the Phase 3 evidence
  directory (`phase3-loop11-report.md`, `phase2-loop11-records.sha256`).
