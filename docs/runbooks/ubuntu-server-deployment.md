---
status: draft
last_reviewed: 2026-11-13
---

# Ubuntu server deployment runbook

## Current synthetic host

The existing synthetic host runs both Elysia API and Caddy in separate rootless
Podman containers supervised by user Quadlet services. Caddy serves the static
SPA and proxies the API over loopback. SQLite uses a persistent host bind mount;
access remains loopback/private. The existing stack uses a historical
`deploy.sh`; D1 does not use it as evidence or as the deployment interface.
Candidate B is approved for isolated synthetic qualification. Production
activation and private HTTPS ingress remain pending. See [CI release
bundles](../runbooks/release-bundles.md) for repository-managed artifact
verification and deployment.

## Status and scope

This runbook covers OPRSERVER. It follows the accepted [Podman deployment architecture](../decisions/podman-deployment.md). Local rootless Podman validation passed on Ubuntu 26.04.1 with synthetic data. The new UID 1002 runtime has not been qualified, and no production deployment is approved.

## D1 isolated synthetic qualification

The approved D1 design uses Candidate B under a new rootless identity and a
separate root at `/mnt/podman-data/operatoros-d1-synthetic`. The existing
`/mnt/podman-data/operatoros` tree, UID 1000 services and data, and protected UID
1001 data remain outside this scope. The data filesystem is unencrypted; this
exception applies to synthetic qualification only. Do not place business
records on it. Production encryption, backup, recovery, and administrator
access decisions remain open.

The proposed account is `operatoros-runtime` with UID/GID 1002 and subordinate
UID/GID range `231072:65536`. A historical Loop 75 read-only inventory found
these values available, but they have not been freshly rechecked and are not
reserved. Recheck them and allocation policy before creating the account. Use
its own home, user manager, Quadlet directory, and Podman store. Proposed
listeners are `127.0.0.1:18188` for Caddy and
`127.0.0.1:18190` for the API. Do not change Tailscale Serve during D1.

The host config must record the approved mountpoint, filesystem UUID and type,
and the `overlay` storage driver. The proposed config uses the kernel's native
rootless overlay support and does not assume `fuse-overlayfs` is installed.
The D1 test must prove the configured driver on the actual Podman 5.7.0 host;
if it fails, stop and request a separately reviewed storage change. Do not
switch to VFS or install a storage package during D1. The `storage-check` CLI
action checks the mount identity, capacity reserves, explicit storage config,
user-manager context, reviewed Quadlets, and SPA pointer without invoking
Podman. Both Quadlets must use
`RequiresMountsFor`, run `storage-check` as `ExecStartPre`, and explicitly select
the same `CONTAINERS_STORAGE_CONF`. Loop 74 found Podman's transient
user-systemd health-check service used the manager's default store and returned
exit 125 (“no such container”), even while the API health routes returned 200.
A unit-level environment setting does not set the user manager's environment.
A user-manager `environment.d` setting must carry the exact storage config so
the transient health-check service sees the same store. `status` reports an
invalid manager context, and deployment and rollback refuse it. A wrong or
absent mount must prevent service startup and deployment.

Use this rootless storage config:

~~~toml
[storage]
driver = "overlay"
graphroot = "/mnt/podman-data/operatoros-d1-synthetic/podman-rootless/graphroot"
runroot = "/run/user/1002/operatoros-podman-runroot"
~~~

Set `CONTAINERS_STORAGE_CONF` to
`/mnt/podman-data/operatoros-d1-synthetic/deploy/storage.conf` in
`/home/operatoros-runtime/.config/environment.d/90-operatoros-podman.conf` and
in both Quadlet `[Service]` sections. Own the file by UID/GID 1002 with mode
0600. Create the `environment.d` file before starting the user manager. Leave
`XDG_CONFIG_HOME` unset.

Install the reviewed `scripts/operatoros_deploy.py` and
`scripts/release-bundle.py` from the approved repository revision under the D1
`deploy/` directory, owned by UID/GID 1002 with mode 0600. The Quadlets invoke
the first file for `storage-check`; the deployment CLI loads the second for
release verification. Do not install a host wrapper or use the retired
`deploy.sh`.

Use the reviewed D1 templates in [`deploy/podman`](../../deploy/podman/):
`operatoros-d1-api.container.in`, `operatoros-d1-caddy.container.in`,
`operatoros-d1-storage.conf.example`, `operatoros-d1-config.toml.example`,
`operatoros-d1-api.env.example`, and `operatoros-d1-Caddyfile.example`. The
storage UUID placeholder must be replaced only after fresh mount verification.
The deployment preflight enforces measured clean-start capacity reserves. The
API environment example contains invalid
placeholders by design; `storage-check` rejects it until distinct synthetic
secrets are generated and all required values are set. Install API/Caddy unit
files as `operatoros-lite-api.container` and `operatoros-lite-caddy.container`
under the dedicated account's Quadlet directory, and retain the API unit copy
at `deploy/operatoros-lite-api.container` for CLI integrity checking.

The first install requires a one-time synthetic bootstrap because the normal
deployment CLI is an upgrade path and expects an existing database/backup and
current release state. On a trusted workstation, set the authorized short-lived
`OPERATOROS_RELEASE_TOKEN` in the process environment, then run:

~~~sh
scripts/operatoros-deploy.sh verify \
  --source-sha fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98 \
  --run-id 43408580871 --run-attempt 1 \
  --artifact-id 14028942446 \
  --artifact-name operatoros-release-fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98-43408580871-1 \
  --envelope-sha256 146bad5c2bf7f1bcad2029f9551dd18c6de30e11a468fb0e7082c0da2f500b09
~~~

Download the same run and name to a mode-0700 staging directory:

~~~sh
gh run download 43408580871 --repo daoistmadness/operatoros \
  --name operatoros-release-fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98-43408580871-1 \
  --dir <staging>
~~~

Require the inner bundle SHA-256
`d4ea92904c7b5bb6f87d8c4418fe12082c829de154d606b4bf007a2f584e272e`, then run
`python3 scripts/release-bundle.py verify <staging>/operatoros-release.tar
fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98`. Extract only fixed member names
`operatoros-api.oci.tar` and `operatoros-web-client.tar.gz` with `tar -xOf`,
compare both against signed `manifest.json` artifact hashes, and transfer only
those files plus the manifest. Recheck hashes on OPRSERVER. The accepted SPA
SHA-256 is
`6690c2e8e7fb0554dc1dc88bd897b54adeb425491f1341ca3bc99df877d5aa79`.
Never rebuild the release or use the upgrade command as a first install.

Install the reviewed deployment CLI and verifier from release source
`fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98`.
Extract the SPA into an immutable versioned directory and create the relative
`web/current` pointer before calling `storage-check`. Bootstrap only the new
empty synthetic SQLite root from the exact OCI image with networking disabled.

After authorization, verify Podman storage before importing anything. Require
`podman info --format json` to report `rootless=true`, the exact config file,
graphroot, runroot, and `graphDriverName=overlay`, with an empty
`additionalImageStores` list. Require the dedicated store's container, image,
and volume inventories to be empty. `podman unshare cat /proc/self/uid_map` and
`gid_map` must each report exactly `0 1002 1` and `1 231072 65536`. A mismatch
stops D1; do not reset or repair any store.

The private `deploy/config/operatoros.toml` must set `expected_uid=1002`, the
root and paths in the table below, service names `operatoros-lite-api.service`
and `operatoros-lite-caddy.service`, API URL `http://127.0.0.1:18190`, web URL
`http://127.0.0.1:18188`, `storage_mountpoint="/mnt/podman-data"`, the verified
filesystem UUID, `storage_fstype="ext4"`, and `storage_driver="overlay"`.
Set the ongoing runtime floors to `min_free_bytes=7516192768` (7 GiB),
`min_free_inodes=50000`, `root_min_free_bytes=16106127360` (15 GiB), and
`backup_max_age_seconds=86400`. Before the first write, require the separate
clean-start thresholds of 9 GiB and 80,000 free inodes on the data filesystem,
plus 16 GiB free on `/`. The deployment preflight enforces 2 GiB and 30,000
inodes of operation headroom above the configured data floors, and 1 GiB above
the root floor. Replace the UUID only with the value returned by the
execution-time `findmnt` check. Keep this config owned by UID 1002 with mode
0600.

The exact retained artifact was downloaded and independently verified on the
trusted workstation without rebuilding. The measured release, image, SPA,
staging, synthetic SQLite, backup/restore, and rollback peaks are recorded in
the capacity table below. Recheck both filesystems before each write; do not
rebuild the release or treat the local Podman measurement as OPRSERVER
qualification.

No UID 1002 Podman 5.7.0 runtime or Quadlet has been started. D1 still requires
separate host execution authorization and must finish with the UID 1002 API and
Caddy services stopped and not enabled. A passing D1 qualification does not
authorize production data or close Gate D2, Gate E, or Gate F.

## Version-controlled release interface

The repository now contains `scripts/operatoros-deploy.sh` and
`scripts/operatoros_deploy.py`, a reviewed implementation for the two-container
synthetic topology. It does not install itself, replace the
live `/mnt/podman-data/operatoros/deploy/deploy.sh`, or change either Quadlet.
The D1 host profile also requires `storage_mountpoint`, `storage_uuid`,
`storage_fstype`, `storage_driver`, and `root_min_free_bytes`. Its
`storage-check` action verifies the mounted filesystem and user-manager store
without invoking Podman. This code has not been run against the new UID 1002
runtime. Copying it or its private config to OPRSERVER requires separate
authorization.

The interface is:

~~~sh
scripts/operatoros-deploy.sh verify \
  --source-sha FULL_SHA --run-id RUN_ID --run-attempt ATTEMPT \
  --artifact-id ARTIFACT_ID --artifact-name ARTIFACT_NAME \
  --envelope-sha256 SHA256

scripts/operatoros-deploy.sh status --config /private/operatoros-deploy.toml

scripts/operatoros-deploy.sh storage-check --config /private/operatoros-deploy.toml
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
configuration and SPA target; it never restores SQLite. The CLI is not installed
or validated under the new UID 1002 manager. D1 does not qualify Podman 5.7.0,
reboot recovery, backup ownership, or production access.

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

Do not run host-changing commands from this draft. Gate D1 requires a separate
authorization for the exact UID 1002 synthetic resources. Production remains
NO-GO.

The repository contains the API Containerfile, Quadlet template, Caddyfile,
placeholder-only environment example, digest renderer, and local
deploy/teardown harness under `deploy/podman/` and `scripts/podman-local-*.sh`.
The local harness does not create the separate UID 1002 runtime or qualify its
user manager, health-check context, or reboot recovery.

## Target services

| Component | Target |
| --- | --- |
| Browser app | TanStack Start SPA client files built under `apps/web/build/client` |
| Static and reverse proxy | Rootless Caddy container on loopback; Candidate B is accepted |
| API | One rootless Podman container managed by a Quadlet-generated user systemd service |
| Database | SQLite files in the persistent host data directory, mounted at `/var/lib/operatoros/data` |
| Development stack | Native local Elysia and Vite; Podman dev launcher remains optional |

The SPA has no production server process. Do not run Vite preview or the Start build output under `build/server` in production.

The API binds to `0.0.0.0:8090` inside its container. The current UID 1000
synthetic stack uses loopback API and Caddy ports `18090` and `18088`. The
approved D1 instance uses `18190` and `18188`. Do not change the current stack
or reuse its ports.

## Production gates

The host inventory found Ubuntu 26.04.1, Podman 5.7.0, and systemd 259.9.
Recheck those values and the actual Quadlet generator before D1 writes. Do not
install or upgrade packages in D1. Use the pinned Caddy container image; do not
install a host Caddy service.

Gate D2 still needs a tailnet administrator to verify effective grants and
approve the HTTPS endpoint and Serve change. Gate E still needs an encrypted
production storage plan, off-host restore, recovery evidence, cross-release
rollback, and release qualification for the API runtime. Gate F requires separate
production deployment approval after those gates pass.

### Gate D2 identity acceptance

Run access checks from two real Windows devices and sessions: authorized
Identity A and a separate non-admin Identity B. Do not change Serve, grants,
firewall rules, or routes during the test. A `-Identity` argument or a process
running without administrator privileges does not prove which tailnet identity
is being tested.

Before counting either result, verify that the Windows Tailscale client reports
`BackendState=Running`, its own node is online, and the result contains distinct
device and user fingerprints. Compare the A and B fingerprints, then have the
tailnet administrator map them to the approved identities and verify the
effective grants. The fingerprints are comparison evidence; they do not prove
authorization by themselves.

Identity A must reach the approved private TCP services on ports 22, 53, 8443,
8444, 8446, 8447, and 8449, resolve DNS over UDP and TCP, and complete HTTPS
requests with certificate validation enabled. Identity B must be unable to
reach those ports or resolve through the host DNS service. TCP 443 must be
unreachable from both identities. Keep the structured results and their
checksums in the approved private evidence channel. A 404 on port 8444 is an
application defect even when the TLS and HTTP transport checks succeed.

These client checks do not approve a Serve or grant change and do not prove
production HTTPS readiness. Keep production NO-GO until D2, the other mandatory
gates, and explicit deployment authorization are complete.

## Release artifact and future builds

For D1, use the already verified release source and artifact. Do not run the
release build workflow or substitute another artifact.

Build the API image and SPA artifact from one reviewed commit after the release
gate passes.

The Gate C artifact used a Bun 1.4.4 Linux/amd64 Alpine final image and passed its configured Trivy inventory. It contained SQLite 3.53.4 with FTS5 and remains blocked by CVE-2026-119373. The current `Containerfile.api` uses Bun only in its build stage and Node.js 24.22.3 in the final stage. A local image candidate passed exact-image probes for SQLite 3.54.1 in both `node:sqlite` and `better-sqlite3`, but exact-source hosted checks, signed release evidence, and target-host rehearsal remain pending. The candidate does not authorize deployment. The image uses filtered production dependencies, runs as UID/GID `10000:10000`, and excludes web files, test data, databases, environment files, private keys, and Git metadata. See the [current integration audit](../audits/host-integration-2026-11-06.md) for the earlier host review.

Record these immutable release identifiers:

- Source commit SHA.
- `bun.lock` and `mise.lock` checksums.
- Production API image digest from the final registry, signature/attestation, and source/lockfile provenance. A loopback-only local registry test verified push/pull by the registry digest into a separate consumer store; this does not establish a production registry or signer.
- Verify the OCI source-tree label and `/usr/share/operatoros/build-provenance` file match the external source-file manifest.
- SPA client archive SHA-256.
- Caddy, Podman, Bun, Node.js, better-sqlite3, both SQLite source IDs, Ubuntu, and systemd versions.
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

This harness uses the local host's Podman and Quadlet generator. It does not
qualify the new UID 1002 user manager, its health-check storage context,
restart behavior, or reboot recovery.

## D1 host preparation

Run these checks again immediately before a separately authorized D1 change.
Stop if any result differs from the approved contract.

1. Confirm that `/mnt/podman-data` is mounted from the approved UUID as the
   expected writable ext4 filesystem. Record free bytes and inodes.
2. Confirm that `/mnt/podman-data/operatoros-d1-synthetic` is absent. Do not
   follow a symlink or reuse any existing directory. Confirm relevant unit,
   storage, and backup metadata do not reference the target.
3. Confirm that UID/GID `1002:1002`, the account name, and subordinate range
   `231072:65536` remain free and policy-approved.
4. Confirm that ports `18188` and `18190` have no listeners. Preserve the
   existing UID 1000 services on `18088` and `18090`.
5. Before the first write, require at least 9 GiB free and 80,000 free inodes
   on the data filesystem and 16 GiB free on `/`. The runtime config enforces
   ongoing floors of 7 GiB and 50,000 inodes on the data filesystem, plus
   15 GiB on `/`.
6. On the trusted workstation, verify the exact release source, run, attempt,
   artifact ID, bundle checksum, OCI manifest digest, and SPA checksum with the
   repository-managed verifier. Confirm the current host still exceeds the
   measured thresholds before any host writes. Stop if a capacity measurement
   or the post-write reserves fail. Do not rebuild or substitute the artifact.

The Loop 77 D1 capacity model measured the retained release without rebuilding:

| Measurement | Bytes | Evidence |
| --- | ---: | --- |
| GitHub artifact envelope | 80,788,986 | GitHub artifact API digest and successful release upload log; the outer ZIP was not retained for a second local hash |
| Inner release bundle | 81,510,400 | Downloaded bundle SHA-256 matched the signed release manifest |
| API OCI archive | 80,566,784 | Signed bundle member checksum |
| API compressed OCI layers | 80,524,201 | OCI archive inspection |
| API expanded layer tar streams | 224,819,200 | OCI archive inspection |
| API regular-file layer payload | 216,933,685 | OCI archive inspection |
| API rootless graphroot increment | 217,732,932 | Isolated local Podman 5.7.0 overlay store after import |
| SPA archive | 624,292 | Signed bundle member checksum |
| Expanded SPA | 2,349,148 | Isolated archive inspection; 213 regular files |
| Caddy rootless graphroot increment | 66,422,902 | Pinned image loaded into the same isolated local Podman store |
| API and Caddy graphroot together | 284,155,834 | Isolated local Podman 5.7.0 overlay store |

The release verifier keeps the envelope, bundle, API archive, and SPA archive
in its temporary directory together: 243,490,462 bytes at the measured sizes.
During upgrade preflight, it also copies the API archive into an isolated
Podman store and loads the API image there. The measured preflight copy and
store add 298,299,716 bytes. The upgrade model includes the existing API and
Caddy store, a second API image without assuming layer deduplication, two
expanded SPA releases, one synthetic database and encrypted backup, and a
64-MiB logs/evidence allowance. A separate backup/restore phase allows three
64-MiB SQLite-sized files: source database/WAL/SHM, encrypted backup, and
restore workspace. Stop D1 if the combined synthetic database plus WAL/SHM
exceeds 64 MiB; this is a test-only cap, not a production database limit. A
synthetic 16-MiB WAL write produced an 18,813,176-byte database/WAL/SHM family,
an 18,632,704-byte SQLite backup-sized copy, and an equal restore copy. These
were capacity probes; the application backup command remains the D1
verification path.

| Peak state | Modeled bytes, including 20% growth allowance |
| --- | ---: |
| Initial artifact verification and isolated schema preflight | 812,588,343 |
| Active synthetic runtime | 585,397,889 |
| Upgrade with rollback retention | 1,238,365,080 |
| Separate synthetic backup and restore | 668,747,504 |

The upgrade/rollback state is the largest. The configured 7-GiB data free-space
floor plus that peak rounds up to a 9-GiB clean-start requirement. Inode
planning counts the measured 10,661-file/directory current store, another
store of the same size for an API image without layer sharing, two SPA file
trees, up to 2,000 transaction/log/evidence entries, and 20% growth. That
28,509-inode peak plus the configured 50,000-inode floor rounds up to an
80,000-inode clean-start requirement. The 16-GiB root preflight leaves the
15-GiB configured reserve after allowing for user configuration and journal
growth. Podman measurements are local, not OPRSERVER qualification. Recheck
actual free bytes, inodes, and Podman 5.7.0 behavior on OPRSERVER before host
implementation.

The data filesystem is unencrypted. Use it only for synthetic D1 records and
synthetic keys. Do not put school data on this filesystem. Do not provision,
format, or resize a disk as part of D1.

The new identity is `operatoros-runtime` with UID/GID `1002:1002`, home
`/home/operatoros-runtime`, shell `/usr/sbin/nologin`, and no sudo access. Add
the subordinate UID/GID range `231072:296607` only after the host administrator
approves its allocation. The current administrator can still use unrestricted
sudo to read the SQLite file. UID separation does not protect data from that
administrator.

Only after separate Gate D1 execution authorization, the approved account
allocation commands are:

~~~sh
groupadd --gid 1002 operatoros-runtime
useradd --uid 1002 --gid 1002 --home-dir /home/operatoros-runtime \
  --create-home --shell /usr/sbin/nologin \
  --key SUB_UID_MIN=231072 --key SUB_UID_MAX=296607 --key SUB_UID_COUNT=65536 \
  --key SUB_GID_MIN=231072 --key SUB_GID_MAX=296607 --key SUB_GID_COUNT=65536 \
  operatoros-runtime
awk -F: '$1 == "operatoros-runtime" { if ($2 != 231072 || $3 != 65536) exit 1; count++ } END { if (count != 1) exit 1 }' /etc/subuid
awk -F: '$1 == "operatoros-runtime" { if ($2 != 231072 || $3 != 65536) exit 1; count++ } END { if (count != 1) exit 1 }' /etc/subgid
chmod 0700 /home/operatoros-runtime
~~~

Recheck account, group, UID/GID, and subordinate range availability and policy
before any of these commands. Do not add sudo privileges. Create the home
`environment.d` file and user Quadlets before `loginctl enable-linger
operatoros-runtime`, so the manager starts with the private storage selector.
The approved rootless manager command context is:

~~~sh
sudo -u operatoros-runtime env \
  HOME=/home/operatoros-runtime \
  XDG_RUNTIME_DIR=/run/user/1002 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1002/bus \
  CONTAINERS_STORAGE_CONF=/mnt/podman-data/operatoros-d1-synthetic/deploy/storage.conf \
  systemctl --user status operatoros-lite-api.service
~~~

Use the same explicit context for `systemctl --user daemon-reload`, `start`,
`stop`, and `status`. Never call the UID 1000 manager for the D1 units.

Create only `/mnt/podman-data/operatoros-d1-synthetic` after confirming the
filesystem identity. Keep the existing `/mnt/podman-data/operatoros` tree and
all UID 1000 and UID 1001 data unchanged. If the data mount is absent, the
runtime must not write into its backing directory. The user Quadlets require
the mount, and their `ExecStartPre` command runs the deployment CLI's exact
UUID and filesystem check before Podman starts.

The host profile accepts only this exact root and its `deploy/storage.conf`,
`podman-rootless/graphroot`, `data/sqlite`, and `/run/user/1002/operatoros-podman-runroot`
paths. It also requires UID 1002 and loopback URLs `http://127.0.0.1:18190`
and `http://127.0.0.1:18188`. It rejects the existing `/mnt/podman-data/operatoros`
tree and the prior `18090`/`18088` listeners as deployment targets.

Use these D1 paths after the owner authorizes their creation:

| Purpose | Path | Owner and mode |
| --- | --- | --- |
| Deployment root | `/mnt/podman-data/operatoros-d1-synthetic` | UID/GID 1002, mode 0700 |
| Podman config | `deploy/storage.conf` | UID/GID 1002, mode 0600 |
| Podman graphroot | `podman-rootless/graphroot` | UID/GID 1002, mode 0700 |
| Podman runroot | `/run/user/1002/operatoros-podman-runroot` | UID/GID 1002, mode 0700 |
| SQLite and backups | `data/sqlite` | UID/GID 1002, mode 0700 |
| Versioned SPA | `web/releases/<release-id>/client` | UID/GID 1002; Caddy read-only mount |
| API environment | `deploy/api.env` | UID/GID 1002, mode 0600 |
| User Quadlets | `/home/operatoros-runtime/.config/containers/systemd` | UID/GID 1002, mode 0700 |
| Deployment lock and records | `deploy/` | UID/GID 1002, mode 0700 |

The `data/sqlite` directory maps to `/var/lib/operatoros/data` in the API
container. It must contain no copied database or other pre-existing records.

## Configure the API container

Create the D1 Quadlet under
`/home/operatoros-runtime/.config/containers/systemd/operatoros-lite-api.container`.
The existing local template uses different ports and is not a D1 host unit.
Keep the API image pinned to the verified config ID and set `Pull=never`.

The API container listens on `0.0.0.0:8090` inside its network namespace. Publish
only `127.0.0.1:18190:8090` on the host. Run the process as `10000:10000` with
`UserNS=keep-id:uid=10000,gid=10000`. Use a read-only root filesystem, a
read-only `/tmp`, `NoNewPrivileges=true`, and `DropCapability=all`.

Mount only `/mnt/podman-data/operatoros-d1-synthetic/data/sqlite` at
`/var/lib/operatoros/data`. Set `OPERATOROS_DATA_DIR` to that container path.
Use `/mnt/podman-data/operatoros-d1-synthetic/deploy/api.env` as the mode-0600
environment file. The file contains synthetic credentials only.

Set the API health command to `/usr/local/bin/operatoros-api-healthcheck` with
a 30-second interval. Send logs to journald. Set `Restart=on-failure`,
`RestartSec=5s`, `TimeoutStartSec=600`, and `TimeoutStopSec=45`. The reviewed
resource ceilings are `MemoryMax=6G` and `CPUQuota=250%`. These ceilings are
provisional until the host test checks cgroup delegation and memory headroom.

Put these mount and storage guards in both Quadlets:

~~~ini
[Unit]
RequiresMountsFor=/mnt/podman-data
ConditionPathIsMountPoint=/mnt/podman-data

[Service]
Environment=CONTAINERS_STORAGE_CONF=/mnt/podman-data/operatoros-d1-synthetic/deploy/storage.conf
ExecStartPre=/usr/bin/install -d -m 0700 /run/user/1002/operatoros-podman-runroot
ExecStartPre=/usr/bin/python3 /mnt/podman-data/operatoros-d1-synthetic/deploy/operatoros_deploy.py storage-check --config /mnt/podman-data/operatoros-d1-synthetic/deploy/config/operatoros.toml
Restart=on-failure
RestartSec=5s
TimeoutStartSec=600
TimeoutStopSec=45
MemoryMax=6G
CPUQuota=250%
~~~

Do not add an `[Install]` section for D1. Start the units explicitly for
qualification. Leave both services stopped and not enabled when the test ends.
Keep the new account's user manager and Podman store separate from UID 1000.

## Configure Caddy

Run Caddy as a separate rootless container with `Network=host`. Bind the
service to `127.0.0.1:18188`, serve the versioned SPA read-only, and proxy API
requests to `127.0.0.1:18190`. Pin the approved Caddy image digest. Do not install
a host Caddy package or change the current Caddy service. Disable Caddy's admin
endpoint because the existing UID 1000 Caddy process owns loopback port 2019.
The D1 service uses systemd restarts and does not need the admin endpoint.

Use this D1 Caddyfile:

~~~caddyfile
{
    admin off
}

http://127.0.0.1:18188 {
    bind 127.0.0.1
    encode zstd gzip

    @dotfiles path_regexp dotfiles (^|/)\.[^/]+(/|$)
    handle @dotfiles {
        respond 404
    }

    @api path /api /api/* /health /ready /openapi /openapi/*
    handle @api {
        reverse_proxy 127.0.0.1:18190
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

Mount the D1 Caddyfile and versioned SPA at `/etc/caddy/Caddyfile` and
`/srv/operatoros/current/client`, both read-only. Do not mount the SQLite
directory or API environment file into Caddy. Set `User=1000:1000` and
`UserNS=keep-id:uid=1000,gid=1000`. Use `ReadOnly=true`,
`NoNewPrivileges=true`, `DropCapability=all`, and journald logging. Add only
`AddCapability=net_bind_service`: the pinned Caddy image marks `/usr/bin/caddy`
with that file capability, and Linux rejects its execution when the capability
is absent from the container's bounding set. `NoNewPrivileges=true` remains
enabled, and the service binds only unprivileged loopback port 18188; every
other capability stays dropped. The deployment validator requires this exact
capability and rejects additional or duplicate entries.
Set `MemoryMax=512M` and `CPUQuota=50%` as provisional resource ceilings.

The existing Caddy file and API unit are validated by the deployment CLI. The
D1 copy changes only the documented paths and ports. Preserve `/api`, `/health`,
`/ready`, `/openapi`, dotfile rejection, SPA fallback, and missing-asset 404
behavior. The rootless D1 Caddy container is not the Tailscale Serve backend
until Gate D2 receives separate approval.

The route tests must prove:

- `/api/**`, `/health`, `/ready`, and `/openapi` reach Elysia and never return the SPA shell.
- `/` and a known nested browser route return the SPA shell.
- Existing hashed assets return their file content and MIME type.
- A missing asset such as `/assets/missing.js` returns 404, not HTML.
- A missing browser route loads the shell and the app renders its not-found state.

For a later HTTPS profile, replace the loopback site address only after the owner approves DNS, TLS, firewall, ingress, exact `ALLOWED_ORIGINS`, and `COOKIE_SECURE=true`. Do not add public or LAN exposure as a side effect of this rehearsal.

The D1 loopback origin is `http://127.0.0.1:18188` with
`COOKIE_SECURE=false`. Gate D2 must set `ALLOWED_ORIGINS` to the exact approved
HTTPS origin and `COOKIE_SECURE=true`; the proposed hostname remains
`https://oprserver.<approved-tailnet>.ts.net:8445` until the tailnet name and
effective grants are verified. Do not substitute a historical tailnet suffix.

## Configure secrets and bootstrap data

Create a mode-0600 `deploy/api.env` with newly generated synthetic values for
`AUTH_COOKIE_SECRET`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_ENCRYPTION_KEY_ID`, and
`ASTRYX_SETUP_TOKEN`. Use distinct random values; the setup token must be at
least 32 URL-safe characters. Never put them in Git, a unit file, a command
argument, or evidence.

For loopback HTTP tests, set `ALLOWED_ORIGINS=http://127.0.0.1:18188`,
`COOKIE_SECURE=false`, and `ENABLE_DESTRUCTIVE_OPERATIONS=false`. Leave
`TRUSTED_PROXY_ADDRESSES` unset until the API's direct peer address is observed.
This profile tests synthetic loopback behavior only. It does not prove
HTTPS-only secure-cookie behavior. Gate D2 must set the approved HTTPS origin
and `COOKIE_SECURE=true`.

The existing deployment CLI does not bootstrap a first install. Use the
repository-managed `verify` command and the existing `scripts/release-bundle.py`
verifier on the trusted operator workstation, then transfer the verified bundle
to the host through the approved channel. Recheck the bundle SHA-256 on the
host before extracting only the OCI archive and SPA archive. Retain the verified
source, run, attempt, artifact ID, bundle checksum, OCI manifest digest, and SPA
checksum in the deployment record. Import the API OCI archive without
rebuilding, and pull only the pinned Caddy image digest into the dedicated UID
1002 store.

For the signed release, the trusted workstation command uses source
`fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98`, run `43408580871`, attempt `1`,
artifact `14028942446`, artifact name
`operatoros-release-fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98-43408580871-1`,
and envelope SHA-256
`146bad5c2bf7f1bcad2029f9551dd18c6de30e11a468fb0e7082c0da2f500b09`:

~~~sh
scripts/operatoros-deploy.sh verify \
  --source-sha fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98 \
  --run-id 43408580871 --run-attempt 1 --artifact-id 14028942446 \
  --artifact-name operatoros-release-fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98-43408580871-1 \
  --envelope-sha256 146bad5c2bf7f1bcad2029f9551dd18c6de30e11a468fb0e7082c0da2f500b09

gh run download 43408580871 --repo daoistmadness/operatoros \
  --name operatoros-release-fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98-43408580871-1 \
  --dir /staging/operatoros-release
sha256sum /staging/operatoros-release/operatoros-release.tar
python3 scripts/release-bundle.py verify \
  /staging/operatoros-release/operatoros-release.tar \
  fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98
~~~

Require bundle SHA-256
`d4ea92904c7b5bb6f87d8c4418fe12082c829de154d606b4bf007a2f584e272e`, OCI
manifest `sha256:0485346284956100517d06d4b4448eb4dcf10ca79f7cbe31412121c8e4e81d81`,
API config ID
`sha256:5eded8054ce50b43f2be7c501519735bbc9936517acdbde94539eae56f726ede`, and
SPA SHA-256
`6690c2e8e7fb0554dc1dc88bd897b54adeb425491f1341ca3bc99df877d5aa79` before
copying the verified bundle to the OPRSERVER staging directory. The transfer
must preserve the bundle checksum.

Bootstrap only the new empty `data/sqlite` directory. The API image includes
the compiled database CLI at `/app/apps/api/dist/db-cli.mjs`; invoke it with
Node's `--entrypoint node` in a one-time container using `--network=none`,
`--read-only`, `--read-only-tmpfs`,
`--cap-drop=all`, `--security-opt=no-new-privileges`, `--user 10000:10000`,
`--userns=keep-id:uid=10000,gid=10000`, the exact API image config ID, and only
the D1 data bind mount. Do not call `migrate-existing`. Validate the fresh
schema as `20261027_s54` before starting the API. Never mount, copy, bootstrap,
migrate, or validate the UID 1000 database or the protected UID 1001 S4.3
database.

The one-time bootstrap commands, run as `operatoros-runtime` with its explicit
`CONTAINERS_STORAGE_CONF`, are:

~~~sh
D1_ROOT=/mnt/podman-data/operatoros-d1-synthetic
API_IMAGE=sha256:5eded8054ce50b43f2be7c501519735bbc9936517acdbde94539eae56f726ede

podman load --input "$D1_ROOT/deploy/staging/operatoros-api.oci.tar"
podman pull docker.io/library/caddy@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5

podman run --rm --network=none --read-only --read-only-tmpfs \
  --cap-drop=all --security-opt=no-new-privileges \
  --user 10000:10000 --userns=keep-id:uid=10000,gid=10000 \
  --volume "$D1_ROOT/data/sqlite:/var/lib/operatoros/data:rw" \
  --env OPERATOROS_DATA_DIR=/var/lib/operatoros/data \
  --entrypoint node "$API_IMAGE" apps/api/dist/db-cli.mjs bootstrap \
  --data-dir /var/lib/operatoros/data

podman run --rm --network=none --read-only --read-only-tmpfs \
  --cap-drop=all --security-opt=no-new-privileges \
  --user 10000:10000 --userns=keep-id:uid=10000,gid=10000 \
  --volume "$D1_ROOT/data/sqlite:/var/lib/operatoros/data:rw" \
  --env OPERATOROS_DATA_DIR=/var/lib/operatoros/data \
  --entrypoint node "$API_IMAGE" apps/api/dist/db-cli.mjs validate \
  --data-dir /var/lib/operatoros/data
~~~

The `podman load` input must come from the attested bundle that passed the
repository verifier and the execution-time SHA-256 check. Do not save another
image or rebuild. The bootstrap must print `BOOTSTRAPPED 20261027_s54`, and
validation must print `VALID 20261027_s54`.

The initial state also needs a seed application release because the current
`deploy` command requires a healthy API/Caddy pair, current SPA pointer, and
recent backup before it changes an application release. For this first
synthetic qualification only, stage the exact verified SPA as
`web/releases/legacy-fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98/client`, set
`web/current` to that directory, and install reviewed UID 1002 API/Caddy
Quadlets that reference the exact imported API config ID and pinned Caddy
digest. Start those two units, verify health and exact storage context, and
complete first-admin setup with the synthetic `ASTRYX_SETUP_TOKEN`. Create a
backup through the authenticated `POST /api/admin/backups` route. The route
returns the encrypted backup filename and checksum. Record that filename for
the deployment command below. Do not run the standalone backup CLI while the
API is active because the API holds the data-root backup lock. Only after this
seed state is verified should the operator run the existing
`scripts/operatoros-deploy.sh deploy` command with the exact release identity,
private config, synthetic backup filename, and `--yes`. This managed no-op
promotion exercises locking, staging, readiness, and application rollback
within the same release identity. It does not test cross-release rollback.
Keep the initial seed and this one-time bootstrap inside the explicit D1
authorization; do not treat them as production activation.

## Start and verify services

Run every command as `operatoros-runtime` with the correct user manager and
`CONTAINERS_STORAGE_CONF`. Start the API first and Caddy second. Do not start
Tailscale Serve.

The authorized D1 qualification must verify the following:

- Podman reports version 5.7.0, `rootless=true`, the explicit storage config,
  the configured overlay graphroot/runroot, and no additional image stores.
- The API and Caddy Quadlet source matches the reviewed files. The generated
  user services carry the expected manager environment and mount precheck.
- The API listens only on `127.0.0.1:18190`. Caddy listens only on
  `127.0.0.1:18188`. No wildcard, LAN, or Tailscale interface owns either port.
- `/health` and `/ready` return success. Caddy serves the SPA shell and nested
  routes, returns 404 for missing assets and dotfiles, and proxies API paths.
- Authentication accepts only the exact synthetic loopback Origin and rejects
  other Origins. Use synthetic credentials and test that cookies follow the
  HTTP-only D1 setting.
- `systemctl --user show-environment` contains exactly the expected
  `CONTAINERS_STORAGE_CONF` value; capture only that variable. With the explicit
  D1 environment, `podman healthcheck run operatoros-lite-api` succeeds with
  exit 0. Its automatic health-check service also succeeds under UID 1002. Run
  `storage-check` once with the exact config path and once with a deliberately
  wrong process-level `CONTAINERS_STORAGE_CONF`; the correct call returns 0 and
  the wrong context returns 1 before invoking Podman. With the correct store
  selected, `podman healthcheck run operatoros-d1-missing` returns 125. Capture
  only exit codes and sanitized error text; never include secret values.
- Rootless Podman reports version 5.7.0 and the configured native `overlay`
  store, exact graphroot/runroot, and dedicated `storage.conf`. If the host
  cannot use native overlay, stop; VFS or package changes require separate
  review.
- SQLite integrity, WAL behavior, and database identity remain valid across an
  API service restart. Do not run a host reboot or power-loss test in D1.
- Deployment locking, invalid-input rejection, interrupted-transaction
  reporting, and same-artifact application rollback work inside the D1 root.
  Cross-release rollback remains untested.

Finish with `operatoros-lite-api.service` and
`operatoros-lite-caddy.service` stopped and not enabled. Keep the approved
linger setting enabled so the dedicated manager can run after boot; this does
not enable either Quadlet service. Keep the UID 1002 account, store, synthetic
database, image, configuration, and evidence for review. Do not delete them
during automatic cleanup.

## Back up and restore

The D1 test may create and restore an encrypted backup made only from synthetic
records inside the new D1 tree. Do not change the current backup timers or
repositories. The Loop 74 audit did not prove application coverage, encryption
of the host Restic set, or off-host recovery. Keep those items open for Gate E.

Use the application backup flow, which checkpoints and serializes SQLite,
checks integrity and foreign keys, encrypts with AES-256-GCM, and writes a
checksum manifest. Do not copy a live database file or raw WAL sidecar.
Preserve the synthetic backup and its key reference for D1 review. Do not place
backup key material in evidence.

## Rollback and cleanup

On failure, stop only the API and Caddy services in the UID 1002 user manager.
Confirm their exact service names, manager UID, and Podman storage config first.
Preserve the new synthetic database, image store, transaction records, logs,
and evidence. Do not remove the account or delete any D1 files automatically.
If the change window requires restoring the prior linger state, disable
lingering only after confirming both D1 services are stopped and no other UID
1002 services exist; otherwise stop for owner review.

Never run global Podman cleanup commands. Do not touch UID 1000 or UID 1001
services or data. Do not modify the existing `operatoros` tree, Tailscale
routes, backup services, firewall, or developer state. Stop and request owner
review if any action would cross those boundaries.

Gate D2 separately approves tailnet grants, the HTTPS endpoint and Tailscale
Serve changes. Gate E separately qualifies encrypted production storage,
off-host restore, host recovery, crash/reboot behavior, cross-release rollback,
and release qualification for both SQLite runtime copies. Gate F remains NO-GO until those gates pass and the
owner authorizes a production deployment.

## Logs and troubleshooting

- Run these commands as `operatoros-runtime`; do not use the UID 1000 manager:
  `CONTAINERS_STORAGE_CONF=/mnt/podman-data/operatoros-d1-synthetic/deploy/storage.conf python3 /mnt/podman-data/operatoros-d1-synthetic/deploy/operatoros_deploy.py storage-check --config /mnt/podman-data/operatoros-d1-synthetic/deploy/config/operatoros.toml`.
- Query the API unit with `systemctl --user status operatoros-lite-api.service` and `journalctl --user -u operatoros-lite-api.service`.
- Query Caddy with `systemctl --user status operatoros-lite-caddy.service` and `journalctl --user -u operatoros-lite-caddy.service`.
- Select the D1 store explicitly for Podman commands with `CONTAINERS_STORAGE_CONF=/mnt/podman-data/operatoros-d1-synthetic/deploy/storage.conf`. Never use a bare Podman command to determine whether these containers exist.
- Inspect ports with `ss -ltn` and confirm that `18188` and `18190` bind only to loopback.
- Stop the API before an offline SQLite operation. Preserve the data-root lock and confirm that only the UID 1002 API owns this data root.
- `/health` reports process status. `/ready` reports route registration and SQLite configuration. Neither proves a representative database-backed request, so run the approved synthetic smoke check after restart.
- Do not expose credentials, cookies, database contents, or unsanitized logs in tickets or release records.

## References

- [Podman single-host deployment](../decisions/podman-deployment.md).
- [Podman 5.7 CLI reference](https://docs.podman.io/en/v5.7.0/markdown/podman.1.html).
- [Podman 5.7 Quadlet reference](https://docs.podman.io/en/v5.7.0/markdown/podman-systemd.unit.5.html).
- [Podman 5.7 health-check exit codes](https://docs.podman.io/en/v5.7.0/markdown/podman-healthcheck-run.1.html).
- [Container storage configuration reference](https://github.com/containers/storage/blob/main/docs/containers-storage.conf.5.md).
- [Database operations](database-operations.md).
- [Backup and restore](backup-restore.md).
- [Secret rotation](secret-rotation.md).
- [Security model](../reference/security-model.md).
- [Production origin and cookie profile](../reference/production-profile.md).
