---
status: current
last_reviewed: 2026-11-25
---

# Ubuntu server deployment runbook

## Canonical production operating contract

OperatorOS production on OPRSERVER is deployed via Docker Engine and Docker Compose
using `deploy/docker/docker-compose.yml` and `scripts/docker-deploy.sh`. Releases consume
CI-built, verified, immutable artifacts attested by the canonical GitHub Actions workflow.

The Docker Compose production architecture was formally accepted by owner directive on
2026-11-24. Podman and Quadlet deployment paths are discontinued. Production operates under
the host service identity UID/GID 1000:1000, with persistent SQLite storage mounted from
`/mnt/podman-data/operatoros/data` and ingress routed through Caddy and Tailscale HTTPS
(`https://oprserver.taile856.ts.net:8447`).

### Architectural parameters

| Parameter | Specification | Notes |
| --- | --- | --- |
| **Container engine** | Docker Engine 28.0+ | Standard Ubuntu Docker daemon |
| **Orchestration** | Docker Compose | Managed via `deploy/docker/docker-compose.yml` |
| **Host identity** | UID/GID `1000:1000` (`mikhailryu`) | Canonical host user account; UID 1001/1002 migration removed |
| **Container runtime user** | UID/GID `1000:1000` (`bun` / user 1000) | Matches host user `1000:1000` for seamless bind-mount access to persistent SQLite volume |
| **Persistent storage** | `/mnt/podman-data/operatoros/data` | Ext4 host directory; mounted read-write to `/var/lib/operatoros/data` |
| **Database** | SQLite 3.54.1 `operatoros.sqlite` | Schema head S5.4 (`20261027_s54`); WAL mode enabled |
| **Deployment root** | `/mnt/podman-data/operatoros/deploy` | Houses releases, current symlink, and active compose configuration |
| **Reverse proxy** | Caddy `2.11.9-alpine` | Binds to `127.0.0.1:18088` (loopback only) |
| **API service** | Elysia backend (Bun 1.4.5) | Binds to `127.0.0.1:18090` (mapped to internal `8090`) |
| **HTTPS ingress** | Tailscale Serve | Forwards `https://oprserver.taile856.ts.net:8447` to `http://127.0.0.1:18088` |
| **Network posture** | Private tailnet only | Loopback-only service binds; no public WAN exposure |

## Canonical deployment procedures

Deployments are executed using the canonical deployment script: `scripts/docker-deploy.sh`.

### 1. Release artifact verification

Every release artifact must be qualified by CI and verified before promotion. The verification
checks archive checksum, embedded source manifest, SBOM, Trivy 0-CVE scan, and cosign-compatible
attestation:

```bash
scripts/docker-deploy.sh verify <candidate-archive.tar> <source-sha>
```

### 2. Executing production deployment

To deploy a verified release archive:

```bash
scripts/docker-deploy.sh deploy <candidate-archive.tar> <source-sha>
```

The automated deployment procedure executes the following steps:
1. **Verification:** Verifies the archive envelope and inner checksums against the target source SHA.
2. **Pre-deploy SQLite backup:** Automatically creates a consistent hot SQLite snapshot using SQLite's online backup API at `/mnt/podman-data/operatoros/data/backups/predeploy_<timestamp>.sqlite3`.
3. **Extraction:** Unpacks release artifacts into `/mnt/podman-data/operatoros/deploy/releases/<source-sha>`.
4. **Image loading:** Loads the embedded container image tarballs into the Docker daemon (`docker load`).
5. **State preservation:** Records the previous active release directory in `/mnt/podman-data/operatoros/deploy/.previous_release`.
6. **Atomic pointer switch:** Atomically points `/mnt/podman-data/operatoros/deploy/current` to the new release.
7. **Web pointer synchronization:** Updates `/mnt/podman-data/operatoros/web/current` if present.
8. **Service reconstitution:** Runs `docker compose -f <compose-file> up -d --remove-orphans`.
9. **Health probe verification:** Polls `http://127.0.0.1:18088/health` and `http://127.0.0.1:18090/health` until healthy.
10. **Automated rollback on failure:** Automatically invokes `cmd_rollback` if health probes fail within 60 seconds.

### 3. Service status inspection

Inspect container states:

```bash
scripts/docker-deploy.sh status
```

Or query the Docker daemon and health probes directly:

```bash
docker compose -f /mnt/podman-data/operatoros/deploy/docker-compose.yml ps
curl -sf http://127.0.0.1:18088/health
curl -sf http://127.0.0.1:18088/ready
curl -sf http://127.0.0.1:18090/health
```

### 4. Emergency rollback

If an operational anomaly occurs post-deployment:

```bash
scripts/docker-deploy.sh rollback
```

Rollback restores the `current` symlink to the previous release recorded in
`/mnt/podman-data/operatoros/deploy/.previous_release`, restarts the previous containers via
Docker Compose, and validates endpoint health.

## Database backup and recovery

### Automated pre-deploy backups

The canonical deployment script automatically snapshots the live database prior to container
recreation:
- Backup location: `/mnt/podman-data/operatoros/data/backups/predeploy_<timestamp>.sqlite3`
- Method: SQLite online backup API (`VACUUM INTO` / `s.backup(d)`), ensuring complete transactional consistency without stopping the API container.

### Manual hot backup

To take an on-demand snapshot:

```bash
python3 -c "import sqlite3; s=sqlite3.connect('file:/mnt/podman-data/operatoros/data/operatoros.sqlite?mode=ro', uri=True); d=sqlite3.connect('/mnt/podman-data/operatoros/data/backups/manual_$(date +%Y%m%d_%H%M%S).sqlite3'); s.backup(d); d.close(); s.close()"
```

### Integrity verification

Verify database integrity and foreign key constraints:

```bash
sqlite3 /mnt/podman-data/operatoros/data/operatoros.sqlite "PRAGMA integrity_check;"
sqlite3 /mnt/podman-data/operatoros/data/operatoros.sqlite "PRAGMA foreign_key_check;"
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
