---
status: current
last_reviewed: 2026-11-13
---

# Podman single-host deployment

## Current synthetic host

The existing synthetic host runs both Elysia API and Caddy in separate rootless
Podman containers supervised by user Quadlet services. Caddy serves the static
SPA and proxies the API over loopback. SQLite uses a persistent host bind mount;
access remains loopback/private. The existing manual helper consumes verified
archives without rebuilding on the host.

A read-only audit on 2026-11-06 confirmed this shape: units
`operatoros-lite-api` and `operatoros-lite-caddy` under host UID 1000, API
published only as `127.0.0.1:18090`, Caddy bound to `127.0.0.1:18088`, container
runtime UID 10000, and no Tailscale Serve route pointing at either. The earlier
host-Caddy proposal below was never installed. The owner has approved Candidate
B for the parallel D1 synthetic runtime. Production activation and private
HTTPS access remain pending.

Storage has three distinct layers and one hazard:

| Layer | Meaning |
| --- | --- |
| Deployment root | `/mnt/podman-data/operatoros`, owned by the deployment account |
| Data directory | SQLite, logs, and backups under that root |
| Container mount | The host data directory appears in the API container at `/var/lib/operatoros/data` |
| Development root | A separate per-repository directory under the developer's state directory |

The hazard: the deployed units select a dedicated `storage.conf`, so bare
`podman ps` reads the developer's default store and reports no OperatorOS
containers. An empty default-store listing is never evidence that the stack is
absent. Use the deployment CLI `status`, which validates and reports the
effective store, or set `CONTAINERS_STORAGE_CONF` explicitly.

See [CI release bundles](../runbooks/release-bundles.md) for the proposed artifact
handoff and the reviewed helper-adoption boundary.

## Status

**Candidate B is accepted for the D1 synthetic runtime.** This decision does not authorize host changes or production data. PR #387 merged at `fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98`. Main release run [43408580871](https://github.com/daoistmadness/operatoros/actions/runs/43408580871) produced the signed, attested Node 24.22.3 artifact with SQLite 3.54.1 in both providers, FTS5 enabled, and no Trivy findings. Its isolated release consumer passed with verified cleanup. The exact artifact identity is recorded in the [stability report](../../STABILITY_REPORT.md) and [release bundle runbook](../runbooks/release-bundles.md). Hosted rehearsal [43419441002](https://github.com/daoistmadness/operatoros/actions/runs/43419441002) passed on a disposable Ubuntu 24.04 runner using that artifact. It does not qualify OPRSERVER. Host Podman, independent recovery, access controls, and operational storage remain unverified. Production remains NO-GO.

Gate C source baseline: harness `b328987fa25338ea518dd15600ea3628fc00449e`, with release source `b9718ab1a6f8b1d855c8a5c62e973bfad2f8ea84`.

## Accepted topology

Use rootless Podman and Quadlet to supervise the Elysia API container, and put a
single loopback ingress in front of it. Preload the exact image before service
start and set Quadlet `Pull=never` so boot does not depend on registry access.

The owner selected Candidate B after reviewing
[the ingress comparison below](#ingress-topology-comparison). The existing
UID 1000 synthetic deployment remains on ports `18088` and `18090`. D1 will use
a separate UID 1002 manager on `127.0.0.1:18188` for Caddy and
`127.0.0.1:18190` for the API. Tailscale Serve remains unchanged during D1.
Gate D2 must approve and configure private HTTPS separately.

The SPA is static output. Do not run `vite preview` or `build/server/server.js`
in production.

~~~mermaid
flowchart LR
  Browser["Authorized tailnet device"]
  Serve["Tailscale Serve HTTPS<br/>Gate D2 pending"]
  Caddy["Rootless Caddy container<br/>static client files + reverse proxy"]
  API["Rootless Podman API container<br/>Elysia + Node.js candidate"]
  Data[("Persistent host directory<br/>SQLite + API-owned files")]
  Backup["Approved off-host encrypted backup"]

  Browser --> Serve
  Serve -->|"127.0.0.1:18188<br/>D1 listener only"| Caddy
  Caddy -->|"127.0.0.1:18190<br/>API, health, OpenAPI paths"| API
  Caddy -->|"static SPA shell and assets"| Static["Immutable release client directory"]
  API -->|"single bind mount"| Data
  Data -.->|"application backup flow"| Backup
~~~

The D1 design uses these isolated values. Recheck them before any host write:

| Setting | Proposed value | State |
| --- | --- | --- |
| Caddy listener | `127.0.0.1:18188` | Approved D1 design; not activated |
| API published listener | `127.0.0.1:18190` | Approved D1 design; not activated |
| API container listener | `0.0.0.0:8090` inside the container | Must be tested |
| Data directory | `/mnt/podman-data/operatoros-d1-synthetic/data/sqlite` mounted at `/var/lib/operatoros/data` | Synthetic only; filesystem is unencrypted |
| Runtime identity | `operatoros-runtime`, UID/GID 1002; API container UID/GID 10000 | Account and subordinate IDs remain unallocated |
| Release staging identity | Runtime account `operatoros-runtime` | No second deployment wrapper |
| Operating system | Ubuntu 26.04.1 LTS amd64 | Read-only inventory; recheck before execution |
| Podman | 5.7.0 | Version observed; D1 rootless qualification not run |
| Caddy | Digest-pinned rootless container | No host Caddy package or service |

Do not open LAN or public ingress during D1. Loopback HTTP checks do not prove secure-cookie behavior through HTTPS. Gate D2 must approve Tailscale Serve and effective tailnet grants.

## Application boundaries

Keep the accepted [TanStack Start SPA decision](tanstack-start-spa.md):

- Start builds a static shell at `apps/web/build/client/_shell.html` and browser assets under `apps/web/build/client`.
- The app remains client-rendered. Do not add SSR, Start server routes, Start server functions, or embedded Elysia.
- Caddy owns static delivery and same-origin routing on the loopback ingress
  through Candidate B.
- The separately supervised Elysia service remains the only API owner.
- `packages/db` continues to own SQLite schema and lifecycle. Do not add a database container.
- Run exactly one Elysia process for each SQLite data root. Preserve the Linux data-root `flock` and API shutdown behavior.
- Existing database startup validates schema and does not migrate it. Fresh bootstrap uses `20261027_s54`. Production S4.3 remains out of scope.

## Why rootless Podman and Quadlet

Run the API container under the proposed unprivileged `operatoros-runtime` account for D1. Rootless Podman reduces the host privileges available to a compromised API process. The host must support cgroup v2 and configure subordinate UID and GID ranges. A user-level Quadlet unit needs systemd lingering to start after reboot without an interactive login. D1 will leave its services stopped and not enabled after qualification.

Use Quadlet-generated systemd services for the API container. It keeps process supervision, restart policy, boot behavior, logs, and service inspection in systemd. One API container does not justify Podman Compose or Kubernetes.

The application image must run as a non-root numeric user. Test the exact user-namespace mapping and bind-mount ownership before using a production data path. Do not use Podman's recursive ownership option on an existing database. Start the rehearsal with synthetic data only.

The API image candidate uses Node.js and V8; the local development runtime remains Bun. Do not add a systemd or container memory-execution restriction until the exact release image passes runtime tests.

## Ingress topology comparison

Both candidates put Tailscale Serve in front of one loopback ingress and keep
the API unpublished. The owner accepted Candidate B for the isolated D1
runtime.

### Candidate A — host Caddy

Caddy runs as a host systemd service, serves the immutable client directory, and
proxies `/api`, `/health`, `/ready`, and `/openapi` to the loopback API port. It
can terminate TLS later if a non-Tailscale access model is approved. This keeps
the web tier outside rootless port mapping and adds one host package and unit.

### Candidate B — Caddy container plus API container

Caddy runs as a second rootless container on the host network, bound to loopback,
with the same routing contract. The API stays on its own rootless container and
its published port remains `127.0.0.1`-only. Both are Quadlet units under the
deployment account.

### Evidence comparison

| Question | Candidate A | Candidate B |
| --- | --- | --- |
| Matches the deployed stack on 2026-11-06 | No | Yes (`operatoros-lite-api` and `operatoros-lite-caddy`) |
| Matches `scripts/operatoros_deploy.py` | No | Yes |
| Additional host packages or units | Caddy package, host unit | None beyond Podman and Quadlet |
| Ingress owner | Host systemd | Rootless container |
| Static file ownership | Host release directory | Bind-mounted read-only release directory |
| Artifact promotion and pointer switch | Host symlink | Host symlink, same code path |
| Restart and failure unit | Host service | Quadlet-generated user service |
| Tailscale Serve compatibility | Yes | Yes |
| Privileged port requirement | None on loopback | None on loopback |
| Operational surface to maintain | Host package, config, unit, logs | Container image digest, config, unit, logs |

**Accepted for D1: Candidate B.** It matches the existing synthetic topology
and the version-controlled deployment interface. Candidate A would add a host
Caddy package and unit and require a separate deployment path. D1 does not
change the existing services or Tailscale Serve configuration.

## Why not run Compose or add another web runtime

The web build contains static assets and a shell, so a third runtime to serve
them would add a process without adding behavior. Caddy already serves the
client and proxies the API in the implemented container topology.

Podman Compose would add a second orchestration configuration for two
containers. Quadlet and systemd already provide the needed lifecycle.
Reconsider Compose only if the runtime topology grows and a reproducible need
appears.

Rootful Podman is not the default. It can simplify host networking, but gives the runtime manager greater host privilege. Revisit it only if rootless storage, cgroup, or networking cannot satisfy a measured requirement and a reviewer accepts the added risk.

## Proposed release and runtime contract

Build the API image and static client from the same reviewed source commit. Pin the API image by immutable OCI digest. Record the source commit, build tool versions, base image digest, lockfile checksum, image digest, static archive checksum, and build attestations in one release record.

The repository has a production API Containerfile and Quadlet template under `deploy/podman/`, a Caddyfile for the rootless Caddy container, and a local synthetic validation harness. Do not reuse the development image. The current Containerfile uses Bun 1.4.4 only in its build stage and Node.js 24.22.3 in the final image. Both images are digest-pinned, and the final stage pins exact `apk` versions for `flock` and `lsof`. Hosted candidate run [43396108609](https://github.com/daoistmadness/operatoros/actions/runs/43396108609) passed exact-source qualification for Node.js 24.22.3 and SQLite 3.54.1 in both `node:sqlite` and `better-sqlite3`, with FTS5 enabled. Main release run [43408580871](https://github.com/daoistmadness/operatoros/actions/runs/43408580871) later produced the signed and attested artifact; its identity is recorded in the [stability report](../../STABILITY_REPORT.md). Hosted synthetic rehearsal [43419441002](https://github.com/daoistmadness/operatoros/actions/runs/43419441002) passed with the exact signed artifact. OPRSERVER rehearsal remains pending.

The API image records the source revision, dirty-tree state, and source-manifest
SHA-256 in OCI labels and `/usr/share/operatoros/build-provenance`. The local
harness checks both representations against its external source-file manifest
to detect stale build metadata when cached image layers are reused.

Caddy reads only the client artifact from a root-owned immutable release directory. Use a release symlink or an equivalent atomic pointer change for client rollback. Keep the SQLite directory outside every release and image layer.

## Security and operations requirements

- Keep only the approved Caddy listener reachable. Publish the API on the host loopback address only.
- Inspect IPv4, IPv6, host firewall, cloud security group, and upstream ingress rules before service installation.
- Configure exact browser origins. Set `COOKIE_SECURE=true` for HTTPS. Trust forwarded client addresses only from the exact direct peer observed by the API.
- Keep `AUTH_COOKIE_SECRET` and `BACKUP_ENCRYPTION_KEY` outside images and source. Use distinct random values. Limit access to the rootless service account and the authorized operator.
- Keep the live SQLite database on persistent host storage. Protect the host volume and backups with filesystem or disk encryption; the live database is not encrypted by the application.
- Use the API/CLI backup format. It checkpoints and serializes SQLite, validates integrity and foreign keys, encrypts with AES-256-GCM, and writes a checksum manifest. Do not copy a live database file or WAL files as a backup.
- Store verified encrypted backup pairs off-host. The destination, key custodian, retention, RPO, RTO, and restore owner remain pending.
- Base CPU, memory, and process limits on measured host capacity and a representative synthetic workload. Do not invent limits from the local development container.
- Send API and Caddy logs to journald. Set retention and disk monitoring before operational use. Never put secrets, cookies, or student data in deployment evidence.

## Validation gates

1. **Release gate:** current main commit, clean install, full security audits, release validation, and browser E2E all pass on the candidate.
2. **Image gate:** production image is built, scanned with no unresolved High/Critical findings or approved exceptions, pinned, and inspected; the image starts with no repository checkout or writable source mount.
3. **Host gate:** an identified disposable host, administrator, access method, ingress policy, package policy, recovery policy, reviewers, and explicit change authorization are recorded.
4. **Rehearsal gate:** browser deep links and assets work; API endpoints bypass the SPA fallback; service restart and reboot work; one API owns the data root; encrypted backup restores into an isolated root; rollback keeps data intact.
5. **Production gate:** separate target approval, maintenance window, verified backup, migration approval if needed, named operator, rollback criteria, monitoring owner, and explicit GO decision.

A successful local build or Podman development run does not pass the host rehearsal or production gates.

## Gate C qualification and open checks

Gate C passed on Ubuntu 24.04 with Podman 4.9.3. The accepted harness is
`b328987fa25338ea518dd15600ea3628fc00449e`, from merged PR #376 and successful
run [42511295699](https://github.com/daoistmadness/operatoros/actions/runs/42511295699).
It verified the retained release artifact without rebuilding it. The release
source is `b9718ab1a6f8b1d855c8a5c62e973bfad2f8ea84`, bundle SHA-256 is
`0d66097da4bff85b4bb0915c39c819b9d069cf34f16688b0b9e29f5c7594bd39`, and OCI
manifest digest is `sha256:acf22409b2a2f957830533c778198cdde5c342664d886526c38f8a4336c5a0ed`.

The rehearsal passed artifact provenance, isolated rootless storage, OCI
import without rebuilding, synthetic SQLite setup and validation, Quadlet
lifecycle, API health and authentication, SPA routing, WAL and integrity
checks, locking, invalid-input rejection, interrupted-transaction recovery,
application rollback, and scoped cleanup.

Gate C used the earlier Bun-based image and does not prove cross-release rollback between distinct API images,
recovery after a real process or host crash, compatibility with OPRSERVER's
live configuration, independent off-host database recovery, effective tailnet
grants, or release qualification of the newer Node.js candidate. OPRSERVER runs Ubuntu 26.04.1 and Podman 5.7.0.
The UID 1002 runtime has not been created or tested. D1 must use only synthetic
data on the existing unencrypted data filesystem. Production remains NO-GO.

## Rollback

Roll back the API image digest and static release pointer as one application release. Keep the database unchanged unless a separately approved restore procedure is required.

Before rollback, verify that the prior API version accepts the current schema. The application does not migrate existing databases at startup. Stop if an upgrade requires a schema change or if compatibility is unknown. A Git revert or image rollback does not reverse a database migration.

## References

- [TanStack Start SPA mode](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode)
- [Podman 4.9.3 Quadlet unit reference](https://docs.podman.io/en/v4.9.3/markdown/podman-systemd.unit.5.html)
- [Ubuntu Noble Podman 4.9.3 package](https://packages.ubuntu.com/en/noble/amd64/podman)
- [Ubuntu Noble Podman package](https://packages.ubuntu.com/noble/podman)
- [Caddy official package installation](https://caddyserver.com/docs/install)
- [Caddy route directive](https://caddyserver.com/docs/caddyfile/directives/route)
- [Node.js 24.22.3 security release](https://nodejs.org/en/blog/release/v24.22.3)
- [SQLite 3.54.1 release history](https://www.sqlite.org/changes.html)
- [Caddy file server](https://caddyserver.com/docs/caddyfile/directives/file_server)
- [Ubuntu deployment runbook](../runbooks/ubuntu-server-deployment.md)
- [Backup and restore](../runbooks/backup-restore.md)
