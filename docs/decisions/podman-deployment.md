---
status: draft
last_reviewed: 2026-11-02
---

# Podman single-host deployment proposal

## Status

**Proposal only; local implementation exists. Rehearsal remains NO-GO.** This document recommends a target architecture for review. It does not authorize changes to an EC2 host, production systems, secrets, or data. An earlier image scan found no Alpine package findings, but it did not cover Bun's embedded SQLite 3.53.4 or the unresolved FTS5 CVE. C2 has not been scanned. Earlier test records apply to other source snapshots and constrained environments. Some passed, while other release and E2E runs failed or timed out. None establishes release acceptance for C2. C2 still needs qualified-runner validation, current image artifacts and scans, independent review, and an authorized Ubuntu rehearsal.

Application baseline: `6070cbb7fee48b937596944da3694d39105cd3ee`, with TanStack Start in SPA mode and Elysia as a separate API process.

## Proposed decision

Use rootless Podman and Quadlet to supervise one Elysia API container. Keep Caddy as a host systemd service. Caddy serves the built TanStack Start SPA files from an immutable release directory and proxies API requests to a loopback-only published API port. Preload the exact image before service start and set Quadlet `Pull=never` so boot does not depend on registry access.

This topology has two long-running services and one container. The SPA is static output; it does not need a web runtime container. Do not run `vite preview` or `build/server/server.js` in production.

~~~mermaid
flowchart LR
  Browser["Approved browser origin"]
  Caddy["Host Caddy systemd service<br/>static client files + reverse proxy"]
  API["Rootless Podman API container<br/>Elysia + Bun"]
  Data[("Persistent host directory<br/>SQLite + API-owned files")]
  Backup["Approved off-host encrypted backup"]

  Browser -->|"HTTP / HTTPS<br/>access model pending"| Caddy
  Caddy -->|"127.0.0.1:8090<br/>API, health, OpenAPI paths"| API
  Caddy -->|"static SPA shell and assets"| Static["Immutable release client directory"]
  API -->|"single bind mount"| Data
  Data -.->|"application backup flow"| Backup
~~~

Initial disposable rehearsal values remain proposals and need host approval:

| Setting | Proposed value | State |
| --- | --- | --- |
| Caddy listener | `127.0.0.1:8088` | Pending host inventory and approval |
| API published listener | `127.0.0.1:8090` | Pending host inventory and approval |
| API container listener | `0.0.0.0:8090` inside the container | Must be tested |
| SQLite data root | `/var/lib/operatoros/data` | Pending owner and mount-permission rehearsal |
| Runtime identity | Unprivileged `operatoros` account | Pending host approval |
| Release staging identity | `operatoros-release` | Proposed; confirm whether it is needed |
| Operating system | Ubuntu Server 24.04.5 LTS amd64 | Preferred rehearsal target, not verified |
| Podman package | Ubuntu 24.04 package source | Host candidate and Quadlet compatibility pending; local testing used Podman 5.7.0 on Ubuntu 26.04.1 |
| Caddy package | Official stable APT repository | Exact APT candidate pending; local config testing used the pinned Caddy 2.11.7 container image |

Do not open LAN or public ingress during the initial rehearsal. Use an approved SSH tunnel for browser tests. Production access, TLS termination, host, and firewall policy require separate decisions.

## Application boundaries

Keep the accepted [TanStack Start SPA decision](tanstack-start-spa.md):

- Start builds a static shell at `apps/web/build/client/_shell.html` and browser assets under `apps/web/build/client`.
- The app remains client-rendered. Do not add SSR, Start server routes, Start server functions, or embedded Elysia.
- Caddy owns static delivery and same-origin routing in the proposed host deployment.
- The separately supervised Elysia service remains the only API owner.
- `packages/db` continues to own SQLite schema and lifecycle. Do not add a database container.
- Run exactly one Elysia process for each SQLite data root. Preserve the Linux data-root `flock` and API shutdown behavior.
- Existing database startup validates schema and does not migrate it. Fresh bootstrap uses `20261027_s54`. Production S4.3 remains out of scope.

## Why rootless Podman and Quadlet

Run the API container under the unprivileged `operatoros` account. Rootless Podman reduces the host privileges available to a compromised API process. The host must support cgroup v2 and configure subordinate UID and GID ranges. A user-level Quadlet unit needs systemd lingering to start after reboot without an interactive login.

Use Quadlet-generated systemd services for the API container. It keeps process supervision, restart policy, boot behavior, logs, and service inspection in systemd. One API container does not justify Podman Compose or Kubernetes.

The application image must run as a non-root numeric user. Test the exact user-namespace mapping and bind-mount ownership before using a production data path. Do not use Podman's recursive ownership option on an existing database. Start the rehearsal with synthetic data only.

Bun's JavaScriptCore runtime may need writable-executable memory for its JIT. Do not add a systemd or container memory-execution restriction until the exact production image passes runtime tests.

## Why Caddy stays on the host

The host Caddy service serves immutable static files and proxies the API. It can manage HTTPS later if the approved access model needs it. Keeping Caddy on the host avoids another container and avoids depending on rootless port mapping for privileged public ports.

The initial rehearsal binds Caddy to loopback. Do not assume TLS or public DNS is required. If a later approved profile needs LAN or public access, decide the DNS, certificate, ingress, firewall, and monitoring policy before changing the listener.

Caddy must route `/api`, `/health`, `/ready`, and `/openapi` before any SPA fallback. Existing static files must win. A missing file with an extension must return 404 instead of `_shell.html`. Validate the exact Caddyfile with the pinned package and test those responses.

## Why not run Compose or add a web container

The web build contains static assets and a shell, so a Node or Bun web server container would add a runtime without adding application behavior. The Elysia API already needs one independent process. Caddy can serve the static output and proxy to the loopback API port.

Podman Compose would add a second orchestration configuration for one container. Quadlet and systemd already provide the needed lifecycle. Reconsider Compose only if the runtime topology grows and a reproducible need appears.

Rootful Podman is not the default. It can simplify host networking, but gives the runtime manager greater host privilege. Revisit it only if rootless storage, cgroup, or networking cannot satisfy a measured requirement and a reviewer accepts the added risk.

## Proposed release and runtime contract

Build the API image and static client from the same reviewed source commit. Pin the API image by immutable OCI digest. Record the source commit, build tool versions, base image digest, lockfile checksum, image digest, static archive checksum, and build attestations in one release record.

The repository now has a separate production API Containerfile and Quadlet template under `deploy/podman/`, plus a host Caddyfile and a local synthetic validation harness. Do not reuse the development image. Local checks use a digest-pinned Bun 1.4.4 Alpine Linux/amd64 base and exact `apk` versions for `flock` and `lsof`. A Trivy scan of an earlier image reported zero Alpine OS and Node package findings, but it did not inventory Bun's embedded SQLite, which remains affected by CVE-2026-119373. C2 has not been scanned. The target Ubuntu package candidates, production registry/signer, and host installation procedure are not yet verified.

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

## Local implementation evidence

The latest complete local synthetic harness run passed on rootless Podman 5.7.0
with Bun 1.4.4 and verified that image provenance labels and the in-image
provenance file match the source manifest. Earlier complete runs also passed. The API ran as UID/GID `10000:10000`, with a read-only root
filesystem, dropped capabilities, and no-new-privileges. A second API
container on the same data root was rejected by the existing
`BACKUP_OPERATION_LOCKED` guard. Manual process restart and container
recreation preserved the SQLite-backed session.

The pinned Caddy 2.11.7 test image served the SPA shell/assets and proxied
health, readiness, OpenAPI, and auth calls over loopback. Missing assets and a
present synthetic `.vite/manifest.json` canary returned 404; wrong-origin
logout returned 403 and preserved the session. The harness enabled SQLite WAL,
verified pending WAL frames before backup, restored an encrypted snapshot to an
isolated data root, validated schema `20261027_s54`, and authenticated both
the restored session and a new login. The local restore-to-usable timing is recorded in the paired external test
record; it is synthetic and is not an approved RTO.

The generated Quadlet passed the local Podman user-generator dry run and
`systemd-analyze verify`, but the actual user service was not started because
the host user manager is degraded. Crash-policy automation, reboot recovery,
Ubuntu 24.04 compatibility, host firewall/ingress, off-host backup policy,
and application rollback against a previous image remain unverified.

A fresh Trivy 0.76.1 scan of the pinned Alpine API image reported zero OS,
Node-package, and secret findings, with a 131-component CycloneDX SBOM. This
does not clear the image security gate: Bun 1.4.4 embeds SQLite 3.53.4 with
FTS5 enabled, leaving CVE-2026-119373 in the runtime. The Debian base used by
the earlier candidate was replaced with Alpine, removing its Debian-specific
package findings; the CVEs were not patched in Debian. No supported Bun release
containing SQLite 3.54.0 or later was available during this audit, and no
security exception was approved. See the [readiness audit](../audits/podman-deployment-readiness.md)
for CVE details and scanner scope.

A loopback-only local registry test pushed the image and captured the
post-push registry digest. A separate rootless Podman VFS store pulled by that
digest and reported the same image ID. An ephemeral Ed25519 test identity
signed a local manifest and verification passed. This validates local digest
identity and signature mechanics only; it does not establish an approved
production registry, signer, attestation policy, or retention process. The
exact local source manifest, image/archive checksums, scanner output, SBOM,
and test signature remain outside Git and identify an uncommitted synthetic
build, not a release artifact.

Two controlled SPA builds emitted 214 files each. All files matched except
`_shell.html`, whose serialized root-route `updatedAt` value comes from
TanStack Router's `Date.now()` server-loader timestamp. `SOURCE_DATE_EPOCH`
does not control it. No safe app-level override was found; post-build editing
could change hydration state. The SPA is checksum-traceable but not
byte-for-byte reproducible. Build once from a reviewed tree, record the exact
artifact checksum and toolchain provenance, and promote that exact artifact
without rebuilding it.

Older records include three `timeout 300 make e2e-smoke` passes at 257.65s,
259.19s, and 262.21s, with 67 browser tests passing, two intentional skips,
and API tests 8/8. Other recorded runs timed out or were terminated at the
300-second limit; a focused E2E run also failed the disposable-data-reset
check. These runs used earlier source snapshots and constrained environments,
so they do not establish C2 acceptance or a qualified timing baseline.

The `check:full` records also differ. The run logged against `6070cbb7` failed
with 420 passing tests and three attendance-reconciliation timeouts. A separate
pre-freeze run exited 0 in 1,372 seconds against source manifest `b1e2248a…`,
but only in a private mount namespace with tmpfs-backed `/tmp` while the host
root filesystem was full. Neither result is release acceptance for C2. No
canonical `mise run check:full` or 300-second smoke run has been accepted on C2
using a qualified disk-backed runner. No external image promotion, EC2 change,
or production deployment occurred.

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
- [Caddy file server](https://caddyserver.com/docs/caddyfile/directives/file_server)
- [Ubuntu deployment runbook](../runbooks/ubuntu-server-deployment.md)
- [Backup and restore](../runbooks/backup-restore.md)
