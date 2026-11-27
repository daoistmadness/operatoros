---
status: current
last_reviewed: 2026-11-28
---

# Ubuntu server deployment runbook

## Canonical production operating contract

OperatorOS production on OPRSERVER is deployed via Docker Engine and Docker Compose
using `deploy/docker/docker-compose.yml` and `scripts/docker-deploy.sh`. Releases consume
CI-built, verified, immutable artifacts attested by the canonical GitHub Actions workflow.

The Docker Compose production architecture was formally accepted by owner directive on
2026-11-24. Podman and Quadlet deployment paths are discontinued. Production operates under
the host service identity UID/GID 1000:1000, with persistent SQLite storage mounted from
the configured `OPERATOROS_DATA_DIR` and ingress routed through Caddy and Tailscale HTTPS
(`https://oprserver.taile856.ts.net:8447`).

### Architectural parameters

| Parameter | Specification | Notes |
| --- | --- | --- |
| **Container engine** | Docker Engine 28.0+ | Standard Ubuntu Docker daemon |
| **Orchestration** | Docker Compose | Managed via `deploy/docker/docker-compose.yml` |
| **Host identity** | UID/GID `1000:1000` (`mikhailryu`) | Canonical host user account; UID 1001/1002 migration removed |
| **Container runtime user** | UID/GID `1000:1000` (`bun` / user 1000) | Matches host user `1000:1000` for seamless bind-mount access to persistent SQLite volume |
| **Persistent storage** | Encrypted host data root (`OPERATOROS_DATA_DIR=/var/lib/operatoros/data`) | Ext4 host directory on LUKS2-backed volume (`dm_crypt-0`, `>= 10 GiB` reserve); mounted read-write to `/var/lib/operatoros/data` |
| **Database** | SQLite 3.54.1 `operatoros.sqlite` | Current source target is `20261127_s57`; latest documented production acceptance is S56 (`20261126_s56`). Verify the exact deployment receipt before migration. |
| **Deployment root** | `OPERATOROS_DEPLOY_DIR=/var/lib/operatoros/deploy` | Houses releases, `current` symlink, `api.env` (`0600`), and active `docker-compose.yml` |
| **Reverse proxy** | Caddy `2.11.9-alpine` | Binds to `127.0.0.1:18088` (loopback only) |
| **API service** | Elysia backend (Bun 1.4.5) | Binds to `127.0.0.1:18090` (mapped to internal `8090`) |
| **HTTPS ingress** | Tailscale Serve | Forwards `https://oprserver.taile856.ts.net:8447` to `http://127.0.0.1:18088` |
| **Network posture** | Private tailnet only | Loopback-only service binds; no public WAN exposure |

## Canonical deployment procedures

Deployments MUST use the canonical deployment script (`scripts/docker-deploy.sh`) executed from a clean trusted checkout matching or compatible with the release interface, with explicit OPRSERVER roots exported (`scripts/docker-deploy.sh` retains legacy `/mnt/podman-data/operatoros/...` defaults when omitted):

```bash
export OPERATOROS_DEPLOY_DIR=/var/lib/operatoros/deploy
export OPERATOROS_DATA_DIR=/var/lib/operatoros/data
```

### Standard deployment preflight gate

Before production mutation, verify only the checks applicable to the deployment scope:

1. **Release requirements (Phase 3):** Approved exact source SHA; mandatory CI and `docker_qualification=true` completion; immutable archive SHA-256 and `gh attestation verify`; `scripts/docker-deploy.sh verify` `PASS` (matching API/Caddy image config digests, SPA `client/release.json`, SBOM, and 0 CRITICAL/HIGH Trivy scan); schema compatibility.
2. **Production host requirements:** Correct host (`oprserver`); current live release symlink and live SQLite schema; authoritative Compose, `ALLOWED_ORIGINS`, and `0600` `api.env`; current `/health` and `/ready`; encrypted LUKS2 active storage + `1000:1000` permissions; minimum `10 GiB` free-space reserve on `/`; valid recovery custody; exclusive operational ownership (no active `.deploy.lock` / `.maintenance_lock`).
3. **Migration-specific requirements (omit when schema is unchanged):** Verified direct upgrade path from current live schema; confirmed writer shutdown & quiescence; fresh consistent attachment-aware encrypted backup and independent `restore-disposable`; post-migration `integrity_check`, `foreign_key_check`, and existing record/attachment preservation.

### Evidence lifecycle and reuse

Reuse valid unchanged evidence (attested candidate archive, CI feature acceptance, synthetic migration tests, approved host baselines, unchanged LUKS header/key custody) across sessions without re-running qualification. Revalidate whenever release SHA, artifact identity, CI status, schema compatibility, production config, storage topology, security policy, recovery keys, or authorization scope changes.

### Deployment exclusivity

Only one execution context may hold `<deploy-dir>/.deploy.lock` and `<deploy-dir>/.maintenance_lock`. Operators MUST NOT run parallel production mutations, remove another active operation's locks, or restart `operatoros-api` while another maintenance operation holds it stopped under `--restart=no`.

### 1. Release artifact verification

Every release artifact must be qualified by CI and verified before promotion. The verification
checks archive checksum, embedded source manifest, SBOM, Trivy 0-CVE scan, and cosign-compatible
attestation:

```bash
scripts/docker-deploy.sh verify <candidate-archive.tar> <source-sha>
```

### 2. Schema-compatible release deployment (no migration)

When the live database already matches the candidate release's target schema:

```bash
scripts/docker-deploy.sh deploy <candidate-archive.tar> <source-sha> [deploy-dir]
```

The automated deployment procedure executes the following steps:
1. **Lock and maintenance check:** Acquires the exclusive deployment lock (`<deploy-dir>/.deploy.lock`) and fails closed if an interrupted maintenance lock (`<deploy-dir>/.maintenance_lock`) exists.
2. **Verification:** Verifies the archive envelope and inner checksums against the target source SHA.
3. **Configuration resolution:** Resolves the authoritative `docker-compose.yml` and `api.env` (`0600` with mandatory secrets) and validates `docker compose config --quiet`.
4. **Extraction & image loading:** Loads the embedded container image tarballs into Docker (`docker load`).
5. **Pre-deploy schema compatibility validation:** Runs `db-cli.ts validate` inside the candidate API image; fails closed if a schema migration is required.
6. **Protected pre-deploy SQLite snapshot:** Creates a `0600` SQLite online backup snapshot inside `<data-dir>/.snapshots/` (`0700`), leaving `<data-dir>/backups/` strictly for encrypted backups.
7. **Atomic activation:** Updates `releases/<source-sha>`, `.previous_release`, `current` symlink, `web/current` symlink (if present), and active `docker-compose.yml` image tags.
8. **Service reconstitution & verification:** Runs `docker compose up -d --remove-orphans` and polls `/health` and `/ready` on Caddy (`18088`) and `/health` on API (`18090`).
9. **Automated rollback on failure:** Invokes `cmd_rollback` if health probes fail within the timeout window.

### 3. Operational schema migration and release activation

When upgrading to a release with a newer schema version (current source target `20261127_s57`):

```bash
scripts/docker-deploy.sh migrate <candidate-archive.tar> <source-sha> <target-schema> [deploy-dir]
```

`migrate` runs the complete operational migration, validation, and release activation sequence
under one continuous deployment lock and writer-exclusion boundary (fail-closed at every step):
1. **Lock & verification:** Acquires `<deploy-dir>/.deploy.lock`, rejects any leftover `.maintenance_lock`, and verifies `<candidate-archive.tar>` against `<source-sha>`.
2. **Authoritative configuration resolution:** Resolves `docker-compose.yml` and `api.env` (`0600`, required `BACKUP_ENCRYPTION_KEY`, `BACKUP_ENCRYPTION_KEY_ID`, `AUTH_COOKIE_SECRET`) and validates `docker compose config --quiet`.
3. **Image loading & maintenance boundary:** Loads candidate images and creates `<deploy-dir>/.maintenance_lock` (`0600`).
4. **Writer shutdown & restart exclusion:** Stops `operatoros-api` via `docker compose stop`, sets `--restart=no` on `operatoros-api` to prevent daemon restart during maintenance, and rejects any other running container mounting `<data-dir>`.
5. **Independent writer quiescence verification:** Verifies via `scripts/verify-writer-quiescence.py` that zero processes hold open handles on `operatoros.sqlite*` (`lsof` and `/proc/*/fd`), no `-journal` or non-empty `-wal` sidecar exists, and a non-blocking `BEGIN EXCLUSIVE` SQLite lock probe succeeds.
6. **Mandatory recovery prerequisite (attachment-aware encrypted backup + disposable restore):** Runs `apps/api/src/backup-cli.ts backup` inside the verified API image (`--env-file <api.env>`), verifies `0600` artifact/metadata permissions, and verifies independent decryption, schema, and attachment integrity via `apps/api/src/backup-cli.ts restore-disposable` into an ephemeral `0700` container-tmp directory.
7. **Operational migration & validation:** Re-verifies quiescence, executes `packages/db/src/db-cli.ts migrate-operational --authorize-target <target-schema>`, and runs `db-cli.ts validate`. On migration failure, checks `scripts/verify-rollback-schema.py` before any restart and refuses to restart an incompatible application against a migrated or uncertain database.
8. **Release activation & health verification:** Extracts the verified release, updates symlinks and Compose image tags, clears `.maintenance_lock`, starts the qualified containers via `docker compose up -d --remove-orphans`, and verifies `/health` and `/ready` before releasing the deployment lock.

### 4. Service status inspection

Inspect container states:

```bash
scripts/docker-deploy.sh status
```

Or query the Docker daemon and health probes directly:

```bash
docker compose -f <deploy-dir>/docker-compose.yml ps
curl -sf http://127.0.0.1:18088/health
curl -sf http://127.0.0.1:18088/ready
curl -sf http://127.0.0.1:18090/health
```

### 5. Emergency rollback and recovery boundaries

If an operational anomaly occurs on a schema-compatible deployment:

```bash
scripts/docker-deploy.sh rollback /var/lib/operatoros/deploy
```

Rollback checks `scripts/verify-rollback-schema.py` before mutating symlinks, refuses to
roll back if the live database is newer than the previous release's expected schema, restores
the `current` symlink and Compose configuration, restarts the previous containers, and
validates endpoint health. Never automatically restore an older production database over committed records, discard committed data, destructively revert schema, delete attachments, or restart an incompatible prior release against a migrated database; preserve the database and report `RECOVERY REQUIRED` for explicit owner authorization.

## Production acceptance

Verify and report after activation:

1. **Identity & Schema:** Deployed `/var/lib/operatoros/deploy/current`, `web/current`, `client/release.json`, loaded container image IDs, `operatoros_schema_migrations` version/fingerprint, `PRAGMA integrity_check = ok`, `PRAGMA foreign_key_check = []`, and preservation of existing rows/attachments.
2. **Health, Auth, CORS & Ingress:** Loopback (`18088`, `18090`) and Tailscale HTTPS (`/health`, `/ready`); unauthenticated `401` on protected routes (e.g. `/api/auth/me`, `/api/staff`, `/api/inventory/*`, `/api/admin/backups*` — never infer auth enforcement from `200` on open SPA/read routes); exact `ALLOWED_ORIGINS` match and `403` on foreign origins.
3. **Feature Smoke & Workloads:** Core SPA/feature asset availability without creating synthetic business records or dummy personnel documents; cleanup of `.maintenance_lock`; all unrelated OPRSERVER workloads (`adguard`, `beszel`, `beszel-agent`, `homarr`, `uptime-kuma`, `veraset-mysql`) healthy; DNS/Tailscale routes intact; `>= 10 GiB` free space on `/`; original repo working tree preserved.

### Standard deployment prompt contract and reporting

Routine production deployments require only: (1) approved exact release SHA, (2) target host (`oprserver`), (3) scope (`deploy` vs authorized non-destructive `migrate` to `<target-schema>`), and (4) any explicit exceptions. Reports MUST use one disposition (**`PRODUCTION ACCEPTED`**, **`DEPLOYMENT BLOCKED`**, or **`RECOVERY REQUIRED`**), separating deferred host-security limitations from application deployment acceptance.

## Database backup and recovery

### Encrypted attachment-aware backups

Production encrypted backups (`backup_<timestamp>.sqlite3` + `.meta.json`) are managed by
`apps/api/src/backup-cli.ts` and the API backup scheduler in `<data-dir>/backups/` (`0700`
directory, `0600` files). Containment is verified read-only with:

```bash
bun scripts/check-backup-dir.ts <data-dir>/backups
```

### Protected supplemental snapshots

Any supplemental plaintext SQLite snapshot created by `docker-deploy.sh deploy` is stored
outside `<data-dir>/backups/` in `<data-dir>/.snapshots/` (mode `0700`, files `0600`) so it
cannot pollute encrypted backup retention or expose plaintext data.

### Integrity verification

Verify database integrity and foreign key constraints:

```bash
sqlite3 <data-dir>/operatoros.sqlite "PRAGMA integrity_check;"
sqlite3 <data-dir>/operatoros.sqlite "PRAGMA foreign_key_check;"
```

## Ingress and networking

### Tailscale Serve HTTPS

Tailscale Serve provides valid HTTPS certificates for the private tailnet domain and proxies
incoming TLS traffic on port 8447 to Caddy on loopback:

```bash
tailscale serve --bg --https=8447 http://127.0.0.1:18088
```

Inspect active Serve routes:

```bash
tailscale serve status
```

Verify HTTPS access from authorized nodes:

```bash
curl -sI https://oprserver.taile856.ts.net:8447
```

### Caddy reverse proxy

Caddy serves as the internal reverse proxy:
- Handles static asset delivery for the TanStack Start SPA client.
- Proxies `/api/*` requests to the Elysia API container (`127.0.0.1:18090`).
- Exposes health endpoints on `/health` and `/ready`.
- Enforces security headers, blocks dotfile access, and returns 404 for missing assets.

## Historical Podman & Quadlet architecture (Archived / Superseded)

> [!NOTE]
> On 2026-11-24, Podman and Quadlet deployment architectures were discontinued by Owner Directive.
> The historical D1 synthetic qualification and UID 1002 rehearsal notes below are preserved
> strictly for historical auditing purposes. Do not execute them.

Historical context:
- Earlier proposals evaluated rootless Podman 5.7.0 and systemd Quadlets under a proposed UID 1002
  (`operatoros-runtime`) on a synthetic mount `/mnt/podman-data/operatoros-d1-synthetic`.
- Loop 82 exercised UID 1002 Quadlets with an older Bun runtime.
- Rootless storage configurations required dedicated `storage.conf` overrides and `RequiresMountsFor`.
- The owner formally rejected Podman and Quadlet on 2026-11-24 in favor of standard Docker Engine
  and Docker Compose, standardizing on the established host identity UID/GID 1000:1000.

## References

- [Docker Compose deployment decision](../decisions/docker-compose-deployment.md)
- [Podman single-host deployment (Superseded)](../decisions/podman-deployment.md)
- [Database operations](database-operations.md)
- [Backup and restore](backup-restore.md)
- [Secret rotation](secret-rotation.md)
- [Security model](../reference/security-model.md)
- [Production origin and cookie profile](../reference/production-profile.md)
