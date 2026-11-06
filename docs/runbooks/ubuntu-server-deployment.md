---
status: draft
last_reviewed: 2026-11-06
---

# Ubuntu server deployment runbook

## Current synthetic host

The existing synthetic host runs both Elysia API and Caddy in separate rootless
Podman containers supervised by user Quadlet services. Caddy serves the static
SPA and proxies the API over loopback. SQLite uses a persistent host bind mount;
access remains loopback/private. The existing manual helper consumes verified
archives without rebuilding on the host. This differs from the future host-Caddy
proposal below. Production topology and public ingress/TLS remain unresolved.
See [CI release bundles](../runbooks/release-bundles.md) for the proposed artifact
handoff and the reviewed helper-adoption boundary.

## Status and scope

This remains a draft procedure for a single Ubuntu host. It follows the proposed [Podman deployment architecture](../decisions/podman-deployment.md). Local rootless Podman validation passed on Ubuntu 26.04.1 with synthetic data. This does not approve or validate an EC2/Ubuntu 24.04 host or production deployment.

## Version-controlled release interface

The repository now contains `scripts/operatoros-deploy.sh` and
`scripts/operatoros_deploy.py`, a reviewed implementation for the existing
two-container synthetic host topology. It does not install itself, replace the
live `/mnt/podman-data/operatoros/deploy/deploy.sh`, or change either Quadlet.
This code has not been run against that host. Copying it or its private config
to a host and invoking `deploy` requires separate authorization.

The interface is:

~~~sh
scripts/operatoros-deploy.sh verify \
  --source-sha FULL_SHA --run-id RUN_ID --run-attempt ATTEMPT \
  --artifact-id ARTIFACT_ID --artifact-name ARTIFACT_NAME \
  --envelope-sha256 SHA256

scripts/operatoros-deploy.sh status --config /private/operatoros-deploy.toml
~~~

After an explicit deployment decision and host-specific review, the operator
can pass the same release identity to `deploy` with `--config`, the name of a
recent encrypted backup, and `--yes`. The credential is an environment-only,
short-lived repository-scoped `OPERATOROS_RELEASE_TOKEN` with Actions read and
Attestations read permissions. The script ignores ambient `GH_TOKEN` and does
not store the credential in the deployment config or API environment.
The command verifies the artifact envelope through GitHub, verifies the signed
inner bundle using the existing release-bundle verifier, then checks the image,
SPA and manifest identities before proceeding. Online GitHub/Sigstore access is
required; loss of that trust evidence blocks deployment even when checksums
match. See [CI release bundles](release-bundles.md) for the complete workflow,
configuration contract and failure handling.

The version-controlled CLI targets the existing API and Caddy user services,
the dedicated rootless graphroot/runroot, persistent SQLite directory, and
versioned SPA directory. It locks deployment operations, checks the backup and
read-only schema compatibility, snapshots application configuration, imports
the image without rebuilding, switches the SPA atomically, and checks health,
readiness, API proxying and a nested SPA route. It records artifact provenance
and incomplete transactions. Rollback restores only the previous API image
configuration and SPA target; it never restores SQLite. The CLI is not yet
installed or validated on Ubuntu 24.04, and it does not close rootless systemd
reboot recovery, backup ownership, or production topology approval.

### Podman storage context

The deployed units and the CLI select a dedicated `storage.conf`. A bare
`podman ps` reads the developer's default store and does not show the deployed
containers, images, or volumes. An empty default-store listing must never be
treated as evidence that the stack is absent.

`status` validates the Podman-reported `configFile`, `graphRoot`, and `runRoot`
against the deployment config and reports them under `podman_storage`. A
mismatch fails the report with `podman_storage_invalid` instead of guessing.
For ad-hoc read-only inspection, select the same context explicitly:

~~~sh
CONTAINERS_STORAGE_CONF=/mnt/podman-data/operatoros/deploy/storage.conf podman ps -a
~~~

Do not use `podman system reset`, do not switch graphroots, and do not copy
images between stores to "fix" a listing discrepancy. The deployed store is the
authority.

Release artifacts are retained by GitHub Actions for a fixed window (currently
90 days). Keep the imported image, the verified bundle, and the release record
for every deployment so rollback does not depend on an expired artifact.

The repository also prepares a separate, manually confirmed GitHub-hosted
deployment rehearsal using one retained release artifact and run-scoped
Quadlet names. That workflow is not a host deployment path and has not been
executed. It requires a working user systemd manager, rootless UID/GID maps,
cgroup v2, supported temporary storage, and measured capacity; the job checks
these at runtime and stops before creating services if any check fails. See
[CI release bundles](release-bundles.md#isolated-deployment-rehearsal-prepared-not-executed).

Do not modify an EC2 or production host from this document until the host owner approves the exact target, change scope, network policy, package sources, recovery policy, reviewers, and execution window.

The repository now contains the production API Containerfile, Quadlet template, host Caddyfile, placeholder-only environment example, digest renderer, and local deploy/teardown harness under `deploy/podman/` and `scripts/podman-local-*.sh`. The local harness was exercised against synthetic data. It does not activate a user systemd service, test a reboot, publish/sign artifacts, install host packages, or validate Ubuntu 24.04 compatibility.

## Target services

| Component | Target |
| --- | --- |
| Browser app | TanStack Start SPA client files built under `apps/web/build/client` |
| Static and reverse proxy | Loopback Caddy ingress (host service or container; not yet accepted) |
| API | One rootless Podman container managed by a Quadlet-generated user systemd service |
| Database | SQLite files in the persistent host data directory, mounted at `/var/lib/operatoros/data` |
| Development stack | Native local Elysia and Vite; Podman dev launcher remains optional |

The SPA has no production server process. Do not run Vite preview or the Start build output under `build/server` in production.

These are rehearsal proposals, not the deployed values. The API binds to
`0.0.0.0:8090` inside the container and is published only on the host loopback
address. The deployed host uses two-container Quadlet units with API `18090` and
Caddy `18088`; the host-Caddy variant uses `8090` and `8088`. Do not copy either
set without the host inventory and approval that this section requires.

## Required decisions before installation

Record these values in the release record before the host gate:

- Disposable host ID, cloud region, owner, Ubuntu release and patch level, resources, architecture, and access method.
- Administrator, approved SSH source, key owner, and artifact transfer destination.
- Attached network interfaces, IPv4 and IPv6 security groups, network ACLs, routes, host firewall, and current listeners.
- Approved Podman and Caddy package sources, exact package versions, upgrade policy, and Caddy service-start suppression method.
- Rootless service account, staging account if required, subordinate UID/GID ranges, data directory owner and mapping.
- Browser access profile, exact origins, TLS and certificate ownership, and allowed ingress.
- Backup destination, separate encryption-key custody, retention, RPO, RTO, restore owner, and reboot permission.
- Runtime, data-integrity, security, operations/recovery, browser E2E, and final approval owners.

No host fact or approval is implied by a proposed value in this runbook.

Package source and version remain host decisions. No Podman or Caddy APT
package was installed for this local validation. On the named target, record
`apt-cache policy podman caddy`, verify Quadlet options against the installed
Podman package, and pin exact approved versions. Caddy `2.11.7` was used only
from a digest-pinned container image for local config and route checks; this
does not establish the official APT candidate. Ubuntu's Noble package catalog
lists Podman `4.9.3+ds1-1ubuntu0.2` in noble-updates; this is catalog evidence,
not proof of the target host's configured candidate or installed version. The
Noble Quadlet manual documents the selected `Pull=never`, `UserNS`, health,
read-only, capability, environment-file, and published-port keys. Verify the
actual installed package and generated unit on Ubuntu 24.04 before accepting
it.

## Prepare a release

Build the API image and SPA artifact from one reviewed commit after the release gate passes.

`deploy/podman/Containerfile.api` builds a production API image from the workspace lockfile. It pins the Bun 1.4.4 Linux/amd64 Alpine base image by digest and pins the required `flock` and `lsof` APK packages. The image uses filtered production dependencies, runs as UID/GID `10000:10000`, and excludes web files, test data, databases, environment files, private keys, and Git metadata. A fresh Trivy scan found no Alpine OS or Node-package findings, but Bun's bundled SQLite 3.53.4 remains affected by CVE-2026-119373. Image promotion is blocked pending a supported runtime fix or an explicit time-bounded security decision. See the [current integration audit](../audits/host-integration-2026-11-06.md).

Record these immutable release identifiers:

- Source commit SHA.
- `bun.lock` and `mise.lock` checksums.
- Production API image digest from the final registry, signature/attestation, and source/lockfile provenance. A loopback-only local registry test verified push/pull by the registry digest into a separate consumer store; this does not establish a production registry or signer.
- Verify the OCI source-tree label and `/usr/share/operatoros/build-provenance` file match the external source-file manifest.
- SPA client archive SHA-256.
- Caddy, Podman, Bun, Ubuntu, and systemd versions.
- Build and audit command results.

The SPA is not currently byte-for-byte reproducible: controlled builds differ
only in TanStack's root-route `updatedAt` value in `_shell.html`. Build once
from the reviewed source tree, record that exact archive checksum and toolchain
provenance, and promote the same artifact without rebuilding it. Do not treat
`SOURCE_DATE_EPOCH` as resolving the framework-generated timestamp.

Do not use `Containerfile.podman` for production. It starts the development stack and copies the full workspace. Use the production Containerfile and Quadlet template under `deploy/podman/`.

The TanStack Start build currently emits:

- Static shell: `apps/web/build/client/_shell.html`.
- Browser assets and the Vite manifest under `apps/web/build/client`.
- Prerender support output under `apps/web/build/server`.

Publish only the client directory to Caddy's read-only document root. Do not expose `.vite/manifest.json`. Do not ship or execute `build/server`.

The local deployment script stages an allowlisted subset: `_shell.html`,
`index.html`, `desktop-failure.css`, `desktop-failure.js`, and `assets/`.
It rejects unexpected root output and does not stage `.vite/manifest.json` or
`build/server`. Caddy also denies dotfile paths. Routing validation places a
synthetic `.vite/manifest.json` canary under the served root and requires HTTP
404; checking only an absent manifest is insufficient.

### Load and identify an immutable image

For an OCI-archive rehearsal, verify its recorded SHA-256 before import, load
it into the approved service account's Podman store, and capture the resulting
image ID and `RepoDigests`. Local archive export/import preserves image content
identity but a local repository digest is transport/store specific. A separate
loopback registry exercise successfully pulled the post-push registry digest
into a clean rootless VFS store and retained the same image ID. For an approved
release, deploy only the registry digest after signature and provenance
verification. Never treat an image ID, archive checksum, or source-store digest
as a registry digest.

## Local synthetic Podman validation

Run from the isolated worktree after the release gates pass:

~~~sh
scripts/podman-local-deploy.sh
~~~

The script creates a private `/var/tmp/operatoros-podman-local.*` workspace,
generates rehearsal-only secrets and an S5.4 database, builds the API image,
renders and parses Quadlet, runs the API and a digest-pinned Caddy test
container, checks SPA/API/auth/CSRF routes, enforces one API lock owner,
restarts and recreates containers, exercises XLS/XLSX import-export from the
API image, and performs encrypted backup plus isolated restore. One run enables
SQLite WAL mode, confirms pending WAL frames before backup, and verifies the
restored pre-backup authenticated session. It checks that published test
listeners are loopback-only. On success,
it removes only its labeled containers and leaves the checksummed OCI/client
artifacts and a local release record in the reported workspace. It removes its
temporary secret and cookie files. If interrupted, run
`scripts/podman-local-teardown.sh <reported-workspace>`; it validates the
workspace marker and removes only exact matching run-labeled containers. It
never removes the workspace, images, or unrelated containers.

This harness uses the local host's Podman and Quadlet generator. It has not
started the generated user service because the current systemd user manager is
degraded. The current host is Ubuntu 26.04.1, not the target Ubuntu 24.04.5;
user lingering, service restart automation, Caddy APT installation, and reboot
survival remain host-rehearsal gates.

## Host preparation

Run these commands only after the host owner approves the exact target and package policy.

1. Verify the host OS, disk, cgroup mode, ports, network interfaces, attached cloud rules, and existing workloads. Stop if the host contains data or services that must be preserved.
2. Install the approved Podman package version. Verify that cgroup v2, rootless networking, subordinate UID/GID ranges, and the Quadlet generator work for the approved service account.
3. Configure the rootless systemd user manager to survive logout and start at boot. Rehearse `loginctl enable-linger operatoros` and the service-account UID mapping before mounting the data root.
4. Inspect whether a Caddy package, unit, or service-start policy already
   exists. Stop for owner review if it does; do not replace an existing Caddy
   configuration or `/usr/sbin/policy-rc.d`. On a confirmed clean disposable
   host, place a temporary runtime mask on `caddy.service` before installing
   the exact approved Caddy package. Verify that installation left Caddy
   inactive and created no listener. Install the reviewed Caddyfile, run
   `caddy validate`, remove only the runtime mask created by this procedure,
   then explicitly enable and start Caddy. Prove this sequence against the
   exact package in the disposable VM before using it on the rehearsal target.
5. Create separate application, configuration, data, and backup locations. Keep the application release and OCI image storage outside the data directory.
6. Apply least-privilege ownership. Caddy reads the static release; only the API service account can write the SQLite root; Caddy cannot read the database or API environment file.
7. Verify no LAN or public listener exists. The initial profile has only loopback listeners on ports 8088 and 8090. Do not change SSH access or cloud firewall rules as part of this procedure.

After authorization, verify the package candidates before installing:

~~~sh
apt-cache policy podman caddy
~~~

Install only the owner-approved exact versions from the approved repositories.
On the clean disposable host, after confirming no existing Caddy unit or
`policy-rc.d` needs preservation, suppress the Caddy package's automatic
service start with a runtime systemd mask:

~~~sh
sudo systemctl mask --runtime caddy.service
sudo apt-get install --no-install-recommends 'caddy=<approved-package-version>'
~~~

Confirm `caddy.service` is masked/inactive and ports 80, 443, and 8088 have no
unexpected listener. Stage and validate the reviewed config before unmasking:

~~~sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl unmask --runtime caddy.service
sudo systemctl enable --now caddy.service
~~~

Test this suppression and activation sequence against the exact Caddy package
in a disposable VM first. If an existing unit, service-start policy, or port
owner is found, stop for review instead of replacing it.

Proposed paths:

| Purpose | Path | Access |
| --- | --- | --- |
| Static releases | `/srv/operatoros/releases/<release-id>/client` | Root-owned, Caddy read-only |
| Current static release | `/srv/operatoros/current` | Atomic pointer to one immutable release |
| API environment | `/etc/operatoros/api.env` | Root-owned, readable by API service account only |
| Persistent data root | `/var/lib/operatoros/data` | Writable by API service account only |
| Host Caddy config | `/etc/caddy/Caddyfile` | Root-owned |
| Rootless Quadlet | `~operatoros/.config/containers/systemd/operatoros-api.container` | Owned by API service account |
| Encrypted backup staging | Host-approved path | Restricted; final copies off-host |

Confirm the directory layout and account mapping before first bootstrap. Do not recursively change ownership of an existing data path.

## Configure the API container

Use one API container per data root. `deploy/podman/operatoros-api.container.in` is the canonical Quadlet template. It runs Elysia as UID/GID `10000:10000`, uses `UserNS=keep-id:uid=10000,gid=10000`, sets `Pull=never`, publishes only `127.0.0.1:8090`, reads `/etc/operatoros/api.env`, mounts `/var/lib/operatoros/data`, enables a health check, and sets `Restart=on-failure`. Verify the exact image digest is already in that service account's local store before starting the unit. The API has no boot-time outbound network requirement, so the rootless unit does not depend on system `network-online.target`.

The local Podman 5.7.0 generator adds `Wants=` and `After=` for
`podman-user-wait-network-online.service` even with `Pull=never`. The Noble
4.9.3 Quadlet docs do not describe that helper. Inspect the generated service
on the target package and confirm whether it adds a network wait; do not add a
system `network-online.target` dependency to a rootless unit by hand.

Render it with a SHA-256-pinned image reference:

~~~sh
scripts/render-operatoros-quadlet.sh \
  'localhost/operatoros-api@sha256:<64-lowercase-hex-digest>' \
  /home/operatoros/.config/containers/systemd/operatoros-api.container
~~~

The renderer rejects unpinned images and symlink output paths. The local test confirmed that the template renders with the Podman Quadlet generator and passes `systemd-analyze verify`. This only validates syntax. The local user manager was not used to start the service; automatic restart and reboot behavior remain unverified. Do not assume an unhealthy status restarts a still-running container.

Add a second API unit only for a different, separately isolated data root. Never scale the service horizontally against one SQLite database.

## Configure Caddy

Install the Caddy configuration only after the API port, static release path, and access profile have been reviewed.

The initial loopback Caddyfile candidate is:

~~~caddyfile
http://127.0.0.1:8088 {
    bind 127.0.0.1
    encode zstd gzip

    @api path /api /api/* /health /ready /openapi /openapi/*
    handle @api {
        reverse_proxy 127.0.0.1:8090
    }

    @root path /
    handle @root {
        root * /srv/operatoros/current/client
        rewrite * /_shell.html
        file_server
    }

    @static_file path_regexp static_file \.[^/]+$
    handle @static_file {
        root * /srv/operatoros/current/client
        file_server
    }

    handle {
        root * /srv/operatoros/current/client
        try_files {path} /_shell.html
        file_server
    }
}
~~~

`deploy/podman/Caddyfile` is the canonical tested config. The pinned Caddy 2.11.7 test image validated it and served the API, shell, nested routes, and assets locally. A missing asset returned 404. The updated config denies dotfile paths; the local harness validates it with a present synthetic `.vite/manifest.json` canary. The local harness confirmed loopback listeners with `ss`. The host Caddy APT package and package-install service suppression were not tested.

The route tests must prove:

- `/api/**`, `/health`, `/ready`, and `/openapi` reach Elysia and never return the SPA shell.
- `/` and a known nested browser route return the SPA shell.
- Existing hashed assets return their file content and MIME type.
- A missing asset such as `/assets/missing.js` returns 404, not HTML.
- A missing browser route loads the shell and the app renders its not-found state.

For a later HTTPS profile, replace the loopback site address only after the owner approves DNS, TLS, firewall, ingress, exact `ALLOWED_ORIGINS`, and `COOKIE_SECURE=true`. Do not add public or LAN exposure as a side effect of this rehearsal.

## Configure secrets and bootstrap data

Generate synthetic rehearsal secrets for this host only. Never reuse production credentials or key material.

Store `AUTH_COOKIE_SECRET` and `BACKUP_ENCRYPTION_KEY` in the approved secret file or secret manager. Use separate random values. Keep the file out of the release directory, image, shell history, and logs. Set the exact browser origin in `ALLOWED_ORIGINS`. Set `TRUSTED_PROXY_ADDRESSES` only after observing the API's direct peer address through the selected Podman network path.

The API requires an auth cookie secret. New backups require a valid AES-256-GCM backup key that differs from the auth cookie secret. Set `ENABLE_DESTRUCTIVE_OPERATIONS=false` during normal service operation.

For a fresh synthetic rehearsal database only:

~~~sh
install -d -m 0700 -o operatoros -g operatoros /var/lib/operatoros/data
OPERATOROS_DATA_DIR=/var/lib/operatoros/data \
  podman run --rm \
  --entrypoint bun \
  --env OPERATOROS_DATA_DIR=/var/lib/operatoros/data \
  --volume /var/lib/operatoros/data:/var/lib/operatoros/data:rw \
  <approved-image-reference>@sha256:<image-digest> \
  run packages/db/src/db-cli.ts bootstrap --data-dir /var/lib/operatoros/data
~~~

The production image includes the database CLI source. Validate the newly bootstrapped result with `--entrypoint bun <image> run packages/db/src/db-cli.ts validate --data-dir /var/lib/operatoros/data`. Fresh schema output must identify `20261027_s54`. Never bootstrap, migrate, or validate the protected S4.3 database.

Ordinary API startup validates an existing database and does not migrate it. A migration requires a separate exact-target authorization and a rehearsed wrapper, fresh verified encrypted backup, lock, and recovery path.

## Start and verify services

After reviewers approve the generated systemd unit and Caddy configuration:

1. Place the Quadlet file in the approved service account's rootless systemd directory.
2. Run `systemctl --user daemon-reload` as that account.
3. Confirm the generated service appears and its `[Install] WantedBy=default.target` dependency is present in the user manager. Quadlet-generated services are transient; do not run `systemctl --user enable`. Run `systemctl --user start operatoros-api.service` to start it. With explicit host-owner approval, configure user lingering so the user manager starts at boot without an interactive login.
4. Confirm the single container uses the expected image digest, UID mapping, data mount, and loopback-only published port.
5. Run `curl -fsS http://127.0.0.1:8090/health`; expect `{"status":"ok"}`.
6. Run `curl -fsS http://127.0.0.1:8090/ready`; expect `ready: true` and `persistence: "sqlite"`.
7. Run `caddy validate --config /etc/caddy/Caddyfile`.
8. Start or reload Caddy only after validation. Verify the route tests through `http://127.0.0.1:8088`.
9. Run the browser E2E suite against the Caddy origin through an approved SSH tunnel. Use synthetic accounts and database data.
10. Restart the API, simulate a process crash using an approved test procedure, and reboot only with explicit host-owner permission. Verify systemd recovery, session behavior, and SQLite persistence.
11. Confirm `podman ps`, `systemctl --user status`, host listeners, and firewall rules show exactly the approved profile.

Do not use `vite preview` as a production server.

## Back up and restore

The current API creates an encrypted snapshot by checkpointing and serializing SQLite, running integrity and foreign-key checks, encrypting with AES-256-GCM, and publishing an artifact plus a checksum metadata file. It does not back up a live database by copying the database and WAL files.

For rehearsal:

1. Create synthetic records through the application.
2. Create a backup with the API or the guarded `scripts/backup.sh` flow.
3. Verify the artifact and metadata pair. Copy both to the approved off-host destination using the approved encrypted transfer.
4. Restore the pair into a separate empty data root. Keep the production-equivalent data root unchanged.
5. Run `PRAGMA integrity_check`, foreign-key checks, schema validation, and an application-level login/read workflow on the restored copy.
6. Measure elapsed time from restore start through application usability. Record the achieved RPO/RTO against owner-approved targets.
7. Keep the backup encryption key outside the host and verify that the designated restore owner can retrieve it under the approved procedure.

Retention is currently count-based at ten complete generations. It does not implement the provisional seven-day policy. A separate off-host retention process must be selected and tested before accepting a time-based commitment.

Do not copy a live SQLite file or raw WAL sidecar as a backup. Stop API writers and use the guarded restore procedure for offline restore. The API and CLI share the data-root lock. Preserve the encrypted off-host backup until restore review passes.

## Restart, upgrade, and rollback

For a release upgrade:

1. Record the current static path and API image digest.
2. Create and verify a pre-change encrypted backup.
3. Check the current schema with `bun run db:validate`. Confirm that the new API accepts it.
4. Stage the new immutable SPA artifact and API image without changing the active release pointer or service.
5. Validate the candidate image and Caddyfile.
6. Update the API image digest and static pointer as one reviewed release.
7. Restart the API, reload Caddy, and run health, readiness, auth, deep-link, asset, and E2E checks.
8. Keep the previous image and static release until reviewers accept the result.

To roll back the application, restore the prior API image digest and static pointer only if the prior API supports the current schema. Local validation did not include a previous application image, so rollback compatibility remains unverified. Do not assume that application rollback reverses a schema migration. If any schema change occurred, use only the approved database recovery decision.

Define objective stop and rollback thresholds before production authorization. During rehearsal, stop on an unapproved listener, multiple API processes for one data root, failed integrity check, missing encryption key, failed route test, failed auth/CSRF test, or unexplained data change.

## Logs and troubleshooting

- API unit: `systemctl --user status operatoros-api` and `journalctl --user -u operatoros-api`.
- Container: `podman ps`, `podman inspect operatoros-api`, and bounded `podman logs --since <time> operatoros-api`.
- Caddy: `systemctl status caddy`, `journalctl -u caddy`, and `caddy validate --config /etc/caddy/Caddyfile`.
- Ports: inspect `ss -ltnp` and verify both published service ports bind to loopback only.
- SQLite: stop the API before an offline CLI operation. Confirm only one API process owns the data root and inspect the data-root lock status.
- Outage: distinguish API `/health` from `/ready`. `/health` reports process status; `/ready` reports route registration and SQLite configuration. Neither proves that a representative database-backed request succeeds, so run the approved application smoke check after restart.
- Do not expose credentials, cookies, database contents, or unsanitized logs in tickets or release records.

## References

- [Podman deployment proposal](../decisions/podman-deployment.md).
- [Ubuntu Noble Podman package](https://packages.ubuntu.com/noble/podman).
- [Ubuntu Noble Podman 4.9.3 package details](https://packages.ubuntu.com/en/noble/amd64/podman).
- [Podman 4.9.3 Quadlet unit reference](https://docs.podman.io/en/v4.9.3/markdown/podman-systemd.unit.5.html).
- [Caddy official package installation](https://caddyserver.com/docs/install).
- [Database operations](database-operations.md).
- [Backup and restore](backup-restore.md).
- [Secret rotation](secret-rotation.md).
- [Security model](../reference/security-model.md).
- [Production origin and cookie profile](../reference/production-profile.md).
