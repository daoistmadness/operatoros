---
status: current
last_reviewed: 2026-11-22
---

# CI release bundles

## Create a candidate

After this pipeline is merged and release execution is separately authorized,
run `gh workflow run ci.yml --ref main`. Phase 2A does not authorize that run.
The existing full release validation and browser regression must succeed.
Only manual runs on `refs/heads/main` can build and retain a release bundle.
Scheduled validation, PRs, and ordinary pushes cannot create release bundles.
The validation and bundle jobs explicitly check out the event's full commit SHA;
a later movement of main does not change the candidate. Bundle creation is serialized.

By default, a manual dispatch on a non-main branch runs the generic Podman
candidate job. Selecting `docker_qualification=true` runs the Docker-only
rehearsal instead and skips both the Podman candidate and main release-bundle
jobs. The generic Podman path builds an ephemeral API OCI image, scans it, and
probes Bun and its embedded `bun:sqlite` runtime before retaining non-image
reports for seven days. That image is discarded with the runner and receives
no signature or release-bundle upload. The Docker path is described below. The
previous accepted finding applied only to Bun 1.4.4
with SQLite 3.53.4, source ID
`2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc`,
and image `docker.io/oven/bun:1.4.4-alpine@sha256:5a1fe2d60106ee903ee62008deab884376f18e07bbb6676cc86e9e1e1e710690`. Current source pins Bun 1.4.5, whose release reports SQLite 3.54.1. The protected-main Docker candidate now verifies that runtime and has exact-source provenance, but this Docker selector does not run the separate image SBOM, Trivy scan, or isolated release consumer. The old acceptance does not apply to Bun 1.4.5; any affected or mismatched runtime identity remains blocked. A workflow success alone does not make the candidate a supported production release.

The locked setup action installs the workspace toolchain. The runner installs
Ubuntu's Podman package and records its actual version. The API image runs the
pinned Bun runtime from the Linux amd64 Containerfile and production lockfile
install. The SPA uses the Vite/Start build. There is no server-side source build,
GHCR publication, automatic deployment, or database migration.

The Docker qualification selector runs full release validation and E2E before
its Compose rehearsal. The feature-ref run uses no production data or
credentials and receives only `contents: read`; it retains the candidate archive
for one day only so a separate GitHub-hosted job can consume the exact bytes.
The consumer job has `contents: read`, no attestation permissions, and retains
only its sanitized report for seven days. Run a feature ref with:

```bash
FEATURE_REF=codex/my-docker-fix
gh workflow run ci.yml --repo daoistmadness/operatoros \
  --ref "$FEATURE_REF" \
  -f docker_qualification=true
```

The GitHub-hosted runner builds the API from the selected clean source archive,
checks Bun and embedded `bun:sqlite`, pulls the digest-pinned Caddy 2.11.7 image,
and starts the repository Compose template with a synthetic database and random
secrets. It checks health/readiness, SPA deep routes, missing static files,
dotfile denial, and image rollback to the previous main revision. Read-only
SQLite status checks verify schema, integrity, quick-check, and foreign keys
before and after both application images. It then scans the exact API and Caddy
Docker-save images with the pinned Trivy image and stores both scan and
CycloneDX reports in the candidate archive. Report identities and hashes are
recorded in its manifest. A fresh GitHub-hosted job verifies the archive,
imports those images, and runs the archived Compose files with another synthetic
database. It checks the image config digests from the imported Docker archive,
Bun/SQLite runtime, health/readiness, SPA and security routes, database
integrity after an API restart, a synthetic audit
marker that survives startup and restart, and cleanup. Scan failures retain
only bounded JSON/log/text diagnostics for seven days. On startup failure, the
rehearsal report keeps container state, health probe exit codes, and allowlisted
log categories; raw container logs and database contents are not retained.
Cleanup must verify that each job's unique Compose resources, owned images, and
private temporary root are removed.

After this change is merged, run the same selector on protected `main` to build
the candidate from the main SHA and produce its release artifact:

```bash
gh workflow run ci.yml --repo daoistmadness/operatoros \
  --ref main \
  -f docker_qualification=true
```

The Docker-only selector skips the Podman release-bundle job and runs the
Docker-specific image scan and consumer above. Once Compose rehearsal, full
release validation, E2E, image scans, and consumer succeed on protected `main`,
CI retains the Docker-loadable archive and checksum for 30 days. The attestation
job checks the archive manifest and exact source SHA, then attests the archive
with GitHub build provenance. Download the archive and checksum sidecar from
that workflow run and set `SOURCE_SHA` to its full main source commit SHA:

```bash
RUN_ID=123456789
RUN_ATTEMPT=1
ARTIFACT_NAME="operatoros-docker-candidate-${SOURCE_SHA}-${RUN_ID}-${RUN_ATTEMPT}"
gh run download "$RUN_ID" --repo daoistmadness/operatoros --name "$ARTIFACT_NAME"
sha256sum --check --strict operatoros-docker-candidate.tar.sha256
gh attestation verify operatoros-docker-candidate.tar \
  --repo daoistmadness/operatoros \
  --signer-workflow daoistmadness/operatoros/.github/workflows/ci.yml \
  --source-ref refs/heads/main \
  --source-digest "$SOURCE_SHA" \
  --deny-self-hosted-runners
```

The protected-main qualification completed on 2026-11-22 in [run
44982611327](https://github.com/daoistmadness/operatoros/actions/runs/44982611327)
for source `99574ecffe84d470e19ab374f3dc7804e158bf63`. Artifact
`14738472380` is named
`operatoros-docker-candidate-99574ecffe84d470e19ab374f3dc7804e158bf63-44982611327-1`;
its archive SHA-256 is
`6135be84f7ea683a4b106310a8b69ca8c92a6ce624f0bd2567119b0d9ae4e580`.
The sanitized rehearsal report verified Bun 1.4.5 / SQLite 3.54.1, Compose
startup, health/readiness and SPA/security routes, synthetic image rollback,
SQLite integrity and foreign keys, and resource cleanup. Local checksum and
GitHub attestation verification passed. This proves an offline candidate for
that source, not an authorized production release. The same run skipped the
Manual release bundle job, so SBOM, Trivy scan, and isolated-consumer evidence
are not available for this archive.
PR #400 adds Docker-specific image reports and a separate archived-Compose
consumer. Task 9 remains partial until a protected-main run passes those gates
and attests its final archive.

The archive uses Docker's `docker load` format and needs no image registry after
download. It is a review candidate, not a supported production release. CI does
not publish to GHCR or deploy. The synthetic rollback proves application image
selection and persistent synthetic SQLite integrity only; production rollback,
backup verification, and runtime acceptance still require separate operator
authorization.

## Prepare a Docker host change

Use this procedure only after Docker support is accepted and an operator has
authorized a host change. The current branch and its candidate archive do not
authorize production use.

Download the archive and checksum sidecar from the same successful workflow
run. Set `SOURCE_SHA` to that run's full source commit SHA. Verify the checksum
before checking the attestation:

```bash
sha256sum --check --strict operatoros-docker-candidate.tar.sha256
gh attestation verify operatoros-docker-candidate.tar \
  --repo daoistmadness/operatoros \
  --signer-workflow daoistmadness/operatoros/.github/workflows/ci.yml \
  --source-ref refs/heads/main \
  --source-digest "$SOURCE_SHA" \
  --deny-self-hosted-runners
```

Before the change, verify a recent authenticated encrypted backup. Preserve the
authoritative SQLite database and the current API and Caddy images. Stage the
archive, environment file, data directory, and deployment directory with
restrictive permissions. Keep the API environment file at mode `0600` and its
parent directories at `0700`. Do not print the environment file or place it in
command output.

Load the verified Docker archive with `docker load`. Verify each imported image
by saving the referenced images back to a Docker archive and checking the hash
of each `Config` JSON member against the config digest in `manifest.json`.
This checks the actual image payload without relying on a Docker daemon's
backend-specific image ID. Extract the versioned static client and deployment
files from the archive. Set the Compose
environment file to the reviewed API and Caddy image references and the staged
host paths. Set `COMPOSE_FILE` to the extracted Compose file and `COMPOSE_ENV`
to the private Compose environment file. Run this check before starting the
services:

```bash
docker compose --env-file "$COMPOSE_ENV" --file "$COMPOSE_FILE" config --quiet
```

Keep the previous client directory and image references available.

After the authorized change, start the API and Caddy services:

```bash
docker compose --env-file "$COMPOSE_ENV" --file "$COMPOSE_FILE" up --detach
```

Verify the API `/health` and `/ready` routes, the browser login flow, and
Caddy's SPA, missing asset, and dotfile responses. Do not run authenticated
checks without an authorized operator session.

To roll back the application, set `OPERATOROS_API_IMAGE` to the preserved prior
image and `OPERATOROS_WEB_ROOT` to the prior versioned client directory. Keep
the prior Caddy image and Caddyfile reference if either changed. Recheck the
resolved Compose configuration, then rerun the command above for the existing
project. Verify readiness and the browser flow. Do not restore or replace the
SQLite database as part of an image rollback. Database recovery is a separate
authorized operation.

The signed Node bundle from run `43408580871` covers source
`fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98` only. The current Bun Docker
candidate has full validation, E2E, Compose rehearsal, runtime, checksum, and
main provenance evidence, but its selector skipped the Manual release bundle
job. Task 9 remains partial until the exact candidate receives SBOM, image scan,
and isolated-consumer checks. Target-host rehearsal and production acceptance
are separately tracked by Tasks 8 and 10. Do not use the historical Node
bundle for current Bun qualification.

The artifact name includes source SHA, workflow run ID, and attempt. Download it
by that run ID using `gh run download RUN_ID --repo daoistmadness/operatoros
--name ARTIFACT_NAME`. Artifacts expire after 90 days; retain an approved bundle
and its attestation before expiry. Deletion or loss requires a new release run.

## Verify before import

Use the repository-managed verifier from a trusted checkout, Python 3, and a
GitHub CLI supporting attestation verification. Authenticate the CLI with access
to the public repository's attestations. Obtain the expected full source SHA from
the approved release decision, not from the downloaded manifest.

```bash
python3 scripts/release-bundle.py verify /staging/operatoros-release.tar FULL_SOURCE_SHA
```

The verifier first requires a GitHub attestation from this repository's
`.github/workflows/ci.yml`, main ref, exact source and signer commit, and a
GitHub-hosted runner. It then checks the exact member inventory, SHA-256 checksums,
OCI manifest/config/layer content digests, Linux amd64 identity, source labels,
SPA source marker, and security report format. Missing attestations, network or
CLI failures reject the bundle. A checksum file alone establishes integrity,
not trust. Never import, extract for deployment, or run a bundle that fails.

The outer tar contains `operatoros-api.oci.tar`, `operatoros-web-client.tar.gz`,
`manifest.json`, `SHA256SUMS`, `sbom.cdx.json`, and `scan.json`. The SPA archive
contains only `client/`, including `_shell.html`, assets, and `release.json`.
The manifest records full source SHA, workflow/run/attempt, tool versions,
lockfile hashes, image config ID, OCI manifest digest, source-file manifest hash,
and each artifact hash. For example (illustrative values):

```json
{
  "source_commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "source_ref": "refs/heads/main",
  "repository": "daoistmadness/operatoros",
  "workflow": "daoistmadness/operatoros/.github/workflows/ci.yml",
  "run_id": "123456789",
  "run_attempt": "1",
  "image": {
    "platform": "linux/amd64",
    "image_id": "sha256:<OCI-config-hash>",
    "manifest_digest": "sha256:<OCI-manifest-hash>",
    "source_tree_sha256": "<source-file-manifest-hash>"
  },
  "tools": {"bun": "<locked-version>", "podman": "<runner-version>"},
  "lockfiles": {"bun.lock": "<sha256>", "mise.lock": "<sha256>"},
  "artifacts": {"operatoros-api.oci.tar": "<sha256>"}
}
```

All fields in the actual manifest are generated. A local OCI manifest digest is
not a registry-resolvable reference. Deployment uses the verified archive and
image config ID; no mutable registry tag identifies a release. OCI archive bytes
and SPA bytes are checksummed exactly. Tar metadata is normalized, but Start's
shell state and container build metadata may still vary between builds. This
pipeline proves provenance for the retained bytes, not byte-identical rebuilds.

## Security evidence

The pinned Trivy 0.76.1 image cannot consume Podman's OCI tar directly. The
builder verifies the archive's OCI layout version, single-image manifest,
config/layer hashes, platform and source labels before extracting only OCI
layout files into an isolated temporary directory. Trivy scans that directory
through a read-only mount. JSON and CycloneDX must each identify the archive's
same config ID, and the layout/archive bytes must remain unchanged after scans.
Missing, malformed or mismatched reports and scanner errors fail packaging.
The shared verifier rejects any unresolved Trivy HIGH or CRITICAL finding in
candidate scans and release bundles. It has no ignore-list bypass; lower
severities remain in the reports for review.
The release OCI archive and static SPA formats are unchanged.

Run the real scanner compatibility test with
`python3 scripts/tests/check_trivy_oci.py`. It uses a separate rootless Podman
store and a tiny synthetic Alpine OCI fixture. It reproduces tar-input failure,
requires successful directory scans in both formats, and rejects an invalid
archive. PR/push CI runs this test without creating or attesting a release bundle.
The fixture is an inventory test, not application runtime or release evidence.

Build/scan failure uploads only non-sensitive JSON/log/text diagnostics for seven
days: source/tool context, scanner version/error, archive size/hash/image identity,
build/export logs, and available scan reports. Raw OCI/SPA archives, credentials,
consumer environment files and databases are excluded. An incomplete bundle is
never uploaded as a release. Full bundle retention remains 90 days. Scan
findings remain visible; producing a report does not approve security risk.
Trivy may omit SQLite code statically linked into Bun. The runtime gate probes
the image's Bun and SQLite identities, and CycloneDX records the embedded
SQLite component and finding disposition. A scan or accepted finding does not
qualify a release until all reports bind to the same exact source and image.

The GitHub attestation signs the complete bundle digest. It requires job-scoped
`id-token: write` and `attestations: write`; default permissions remain
`contents: read`. No long-lived signing key or registry credential is needed.
No publishing runs on PRs, and this pipeline does not create GitHub Releases.

## Isolated consumer and deployment boundary

After attestation and before upload, `scripts/test-release-consumer.sh` verifies
trusted provenance and validates the bundle, then creates a private, uniquely
named temporary VFS Podman store beneath the runner's temporary directory. It
bootstraps synthetic S5.4 data and starts the imported API without building. A
pinned Caddy image checks readiness, nested SPA routing, missing assets, and
dotfile rejection.

The exit trap removes only the two fixed consumer container names from that
store, verifies that no containers or Podman mounts remain (querying rootless
mounts through `podman unshare`), and refuses cleanup if the workspace, storage
configuration, graphroot, or runroot is shared, symlinked, mounted, or outside
the unique temporary root. It uses `podman unshare` to inspect mounts and remove
the verified graphroot and runroot, which may contain files owned by subordinate
host UIDs. If Podman recreates runner-owned lock metadata as its namespace exits,
the cleanup verifies every residual entry is runner-owned before removing those
store directories; then the runner removes the remaining temporary workspace.
The trap preserves a consumer
failure and reports cleanup failure separately. A successful consumer run with
failed cleanup is still a failed release gate. Cleanup diagnostics contain
command status and bounded Podman output only; container storage, database,
environment files, and runtime data are never uploaded. This is not a live
Quadlet, reboot, or production-host test.

## Historical isolated deployment rehearsal

The run below is historical evidence for the signed Node artifact from source
`fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98`. It does not qualify a Bun image or
the current source. Do not use it for current-source release acceptance or D1.

The separate `.github/workflows/deployment-rehearsal.yml` workflow is prepared
to test the repository-managed deployment CLI on a disposable GitHub-hosted
`ubuntu-24.04` VM. It has only a `workflow_dispatch` trigger, runs only on
`main` when the required boolean confirmation is true, and does not build or
publish a release. It cannot run from a PR, push, or schedule. Its
`GITHUB_TOKEN` is limited to `actions: read`, `attestations: read`, and
`contents: read`; checkout credentials are not persisted. No production
credential is needed. The token is used only for artifact retrieval and
attestation verification; the API and Caddy services do not inherit it. A
private empty registry-auth file prevents the public digest-pinned Caddy pull
from reading credentials from the runner user's normal Podman auth file.

The rehearsal pins the verified release from source
`fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98`, workflow run `43408580871`
(attempt 1), artifact `14028942446`. The artifact name is
`operatoros-release-fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98-43408580871-1`.
Its envelope SHA-256 is
`146bad5c2bf7f1bcad2029f9551dd18c6de30e11a468fb0e7082c0da2f500b09`, and its
inner bundle SHA-256 is
`d4ea92904c7b5bb6f87d8c4418fe12082c829de154d606b4bf007a2f584e272e`. The
signed manifest records OCI digest
`sha256:0485346284956100517d06d4b4448eb4dcf10ca79f7cbe31412121c8e4e81d81`,
image config ID
`sha256:5eded8054ce50b43f2be7c501519735bbc9936517acdbde94539eae56f726ede`,
and SPA SHA-256
`6690c2e8e7fb0554dc1dc88bd897b54adeb425491f1341ca3bc99df877d5aa79`. The
artifact expires on 2027-02-11 10:22:21 UTC. The rehearsal verifies each
identity before initializing its private Podman store or importing the image.

Hosted run [43419441002](https://github.com/daoistmadness/operatoros/actions/runs/43419441002)
completed on 2026-11-13 from workflow source
`37bfa038b3054bf2a113bbd58925320cd6b2c55f`. It used the signed release above
on Ubuntu 24.04 with rootless Podman 4.9.3. The result reports successful
synthetic deployment, post-backup SQLite preservation, application rollback,
and interrupted recovery. All seven boolean guards were true, the run reported
25 check entries and no failures, and the harness exited with code 0. SQLite
integrity was `ok`, foreign-key violations were zero, journal mode was WAL, and
the synthetic marker survived each transition. Cleanup passed with no remaining
resources. GitHub retained evidence artifact `14034070389` through
`2026-11-27T11:48:41Z`; `rehearsal-evidence.json` SHA-256 is
`b7c6953b5d7306d598ba4a2c71ad0a2f874dad92c13effb418a1a9fdea8f4301`. This
run did not access OPRSERVER or production data.

Each workflow run uses a fresh directory below `RUNNER_TEMP`, a private VFS
run-scoped Podman configuration and storage, random synthetic-only
authentication and backup secrets, and service names that include the workflow
run ID and attempt. The API port is published to loopback only; Caddy uses host
networking but binds only to a separate loopback port. The harness rejects paths
overlapping default/shared Podman storage, application data, repository
worktrees, or the existing `/mnt/podman-data` root. Cleanup removes only the
run-specific Quadlet files, the two container names in the private store, and
that verified workspace. It does not use `sudo`, modify system-wide settings,
or touch the existing OperatorOS services or database.

The failed rehearsal on workflow run `42043131126`, attempt 1, showed Podman
warning that the requested `vfs` driver had been replaced by `overlay` from the
database under `/home/runner/.local/share/containers/storage`. The same step
parsed `podman info --format json` after combining stderr with stdout, so that
warning also caused JSON decoding to fail. The recorded output confirms that
the runner's default metadata database was consulted; it does not establish
whether the storage configuration was ignored or a default engine metadata
path caused the lookup. The correction pins both storage and engine metadata
paths and treats effective-path mismatch as a pre-import failure.

The rehearsal puts `storage.conf` at
`<workspace>/deploy/xdg-config/containers/storage.conf` and sets
`XDG_CONFIG_HOME` to its parent. It deliberately omits
`CONTAINERS_STORAGE_CONF`: the Ubuntu 24.04 runner's Podman 4.9.3 can report the
override path while rootless storage still uses a different graphroot. The
separate `CONTAINERS_CONF` selects workspace-owned static metadata, volume, and
image-copy paths. Direct Podman commands and each generated Quadlet service
also receive private `HOME`, `XDG_DATA_HOME`, `TMPDIR`, and an empty
`REGISTRY_AUTH_FILE`. The systemd manager's `XDG_RUNTIME_DIR` remains unchanged.
Before downloading or importing the release image or creating services, the
harness parses JSON from stdout only and checks Podman's reported config file,
graphroot, runroot, volume path, image-copy directory, rootless/local state,
VFS driver, and systemd cgroup v2. It rejects additional image stores and
unknown configuration keys, then requires the private image, container, and
volume inventories to be empty. Podman storage warnings remain fatal even when
stdout contains valid JSON. After Quadlet startup, the harness compares each
service's effective Podman environment, rejects any `CONTAINERS_STORAGE_CONF`
override, and confirms that direct Podman sees exactly the two expected
run-scoped containers. Cleanup retains the XDG storage file until its
post-unshare workspace validation completes.

If this storage proof fails, cleanup does not invoke Podman. It removes only a
canonical, private, runner-owned workspace with no mounts. After the private
context has been proven, cleanup may use Podman only with the validated
run-scoped environment and removes namespace-owned files only below that
workspace. No command resets or repairs the runner's default Podman store.

The rehearsal writes only non-secret settings to `deploy/api.env`. It creates
the API's synthetic cookie and backup keys as run-scoped Podman secrets by
passing their values on stdin, then references those secret names in the API
Quadlet. The local Podman secret store is not treated as encrypted storage;
these synthetic secrets exist only in the private disposable VFS store and are
removed with that store during cleanup. The backup CLI receives the synthetic
keys in its child-process environment. The seeded admin password is passed to
the database seeder in its child-process environment and used for the login
request in memory. Login JSON, response bodies, and the session cookie jar are
not written to files or command arguments. These controls avoid persistent
credential files; they do not make the runner's process memory or environment
an encrypted secret vault.

GitHub currently documents the Ubuntu 24.04 hosted image with Podman 4.9.3
and systemd 255.4, but the hosted image changes over time. The image inventory
does not guarantee that this job receives a working user systemd manager,
subordinate UID/GID ranges, cgroup delegation, a compatible filesystem, or
sufficient free bytes and inodes. The harness checks the actual runner and
fails before service configuration if any prerequisite is absent; it does not
enable lingering, change cgroups, or fall back to a different host. These
runtime capabilities are **not verified** until a separately authorized run.
See the [Ubuntu 24.04 runner inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
and [Podman 4.9.3 Quadlet reference](https://docs.podman.io/en/v4.9.3/markdown/podman-systemd.unit.5.html).

The rehearsal script checks the verified release, rootless image import,
read-only SQLite schema validation, API/Caddy Quadlet startup, synthetic
authenticated requests, SPA deep/static routes and dotfile protection, lock
rejection, incompatible-schema rejection, interrupted-transaction reporting,
application-only rollback, and SQLite/WAL preservation. The repository's
deployment unit tests separately cover malformed bundle and attestation
rejection, simulated health-check failure, and rollback failure. The workflow
retains only allowlisted event names, exit codes, `rehearsal-evidence.json`,
and the cleanup tool's bounded diagnostics for 14 days. It does not retain
arbitrary subprocess output or deployment CLI output, and never uploads the
bundle, database, environment file, secrets, or container storage. Run
43419441002 exercised the hosted runner's user systemd manager, rootless Quadlet
startup and restart, and cleanup. It did not exercise OPRSERVER or its data.
Target-host service-manager, reboot, crash, and storage acceptance remain open.

When private Podman-context qualification fails, `podman_context` records the
failing stage, last completed guard, stable failure code, optional process exit
code, sanitized explanation, and allowlisted expected and observed labels. It
records cleanup status separately so successful cleanup cannot hide a failed
qualification. The evidence never includes raw subprocess output, environment
variables, configuration contents, credentials, or full storage paths.

If consumer verification fails, the complete attested bundle remains only in
the ephemeral runner workspace and is not uploaded. Only the allowlisted
diagnostics artifact is retained. A separately named, short-retention quarantine
artifact could support a future investigation, but this workflow does not create
one and the deployment verifier must never treat such an artifact as accepted.

The existing synthetic host uses two rootless Quadlet containers: API and Caddy.
Caddy serves static SPA files and proxies the API. SQLite stays in a host-mounted
data directory. Access is loopback/private. Candidate B is accepted for the
parallel D1 synthetic runtime. Loop 82 exercised the host implementation with
an older Bun release. Further host execution and Tailscale Serve changes require
separate authorization. Production activation remains NO-GO. See the
[deployment decision](../decisions/podman-deployment.md).

## Repository-managed deployment interface

`scripts/operatoros-deploy.sh` is the version-controlled interface for the
existing two-container synthetic host topology. It wraps
`scripts/operatoros_deploy.py` and reuses `scripts/release-bundle.py` for the
signed inner bundle. Loop 82 used the interface under the synthetic UID 1002
runtime. It has not replaced or modified `/mnt/podman-data/operatoros/deploy/deploy.sh` or any live Quadlet.
Copying a new interface revision or its private configuration onto the host
requires separate authorization.

The supported commands are:

~~~sh
scripts/operatoros-deploy.sh verify \
  --source-sha FULL_SHA --run-id RUN_ID --run-attempt ATTEMPT \
  --artifact-id ARTIFACT_ID --artifact-name ARTIFACT_NAME \
  --envelope-sha256 SHA256

scripts/operatoros-deploy.sh status --config /private/path/operatoros-deploy.toml

scripts/operatoros-deploy.sh deploy \
  --source-sha FULL_SHA --run-id RUN_ID --run-attempt ATTEMPT \
  --artifact-id ARTIFACT_ID --artifact-name ARTIFACT_NAME \
  --envelope-sha256 SHA256 --config /private/path/operatoros-deploy.toml \
  --backup-name backup_YYYY-MM-DD.sqlite3 --yes

scripts/operatoros-deploy.sh rollback RELEASE_ID \
  --config /private/path/operatoros-deploy.toml --yes
~~~

`verify` is read-only with respect to services and application data. It uses
the GitHub Actions REST API to confirm the successful `workflow_dispatch` run,
attempt, `main` ref, source SHA, artifact ID/name, and GitHub's artifact-envelope
digest. It then checks the inner checksum and asks the existing bundle verifier
to validate the GitHub attestation for this repository, exact workflow, main
ref, signer commit, and source SHA. The bundle verifier validates OCI config,
manifest and layers, Linux/amd64 platform and source labels, SPA identity, and
the exact bundle inventory. The outer GitHub artifact digest and inner release
bundle checksum identify different serialized files; both are recorded.
The output also records artifact expiration, manifest and component checksums,
the attested workflow identity, scanner, and security scope.

For a private repository, provide a short-lived fine-grained credential in
`OPERATOROS_RELEASE_TOKEN`, scoped to this repository with [Actions: read](https://docs.github.com/en/rest/actions/artifacts#fine-grained-access-tokens-for-get-an-artifact)
and [Attestations: read](https://docs.github.com/en/rest/repos/attestations) only.
The script maps this dedicated variable to `GH_TOKEN` only for GitHub API
requests and `gh attestation verify`; it ignores an ambient `GH_TOKEN` and never
writes the credential to config, artifact, or application environment. Do not
use the API/backup environment file as a credential source. Verification needs
network access to GitHub and Sigstore trust data. Although the bundle has
checksums, offline verification is not supported by this command: lack of
GitHub or attestation evidence fails closed.

`deploy` obtains a nonblocking exclusive lock before downloading or changing
application state. It checks the dedicated rootless Podman context, the current
user systemd manager and exact API/Caddy Quadlet identities, directory ownership,
capacity, current image and SPA rollback availability, loopback health, and a
recent encrypted backup. It imports into the existing service store without a
build, checks the image config ID and labels, validates the current SQLite
schema with the candidate image in a separate disposable rootless VFS store and
a read-only data mount, then stages the SPA under a release-specific directory.
It atomically replaces the API Quadlet image reference and SPA symlink, restarts
the existing API then Caddy services, and checks health/readiness, a SPA route,
and the unauthenticated API response. It does not migrate or restore SQLite.

The private TOML config is host-specific and must be mode `0600`, owned by the
deploying non-root user. It identifies the data/deployment roots, existing
Quadlet files and service names, rootless Podman storage, loopback URLs, free
space/inode floors, and maximum backup age. Keep that config, API environment
file, encryption keys, backup metadata, logs, current release record, and
transaction snapshots outside Git. For a normal host deployment the CLI
accepts only the existing `operatoros-lite-api.service` and
`operatoros-lite-caddy.service` identities. It has a separate run-scoped
profile for the confirmed GitHub rehearsal workflow, bound to that run's
`RUNNER_TEMP`, run ID, and attempt. That profile does not permit host deployment
from an ordinary local invocation and is not installed on the existing host.

The config contains exactly these keys. Paths must already exist, be absolute,
canonical (no symlink components), and be owned by the deploying user. The
dedicated storage paths and SQLite data must remain under the configured root.

| Key | Required value |
| --- | --- |
| `root` | Private deployment root, for example `/mnt/podman-data/operatoros` |
| `expected_uid` | Numeric UID of the non-root account running rootless Podman |
| `storage_conf` | Dedicated `storage.conf` under `root/deploy` |
| `graphroot` | Rootless image store under `root/podman-rootless` |
| `runroot` | Dedicated runroot under `root/podman-rootless`, or `/run/user/<expected_uid>/operatoros-podman-runroot` |
| `data_dir` | Existing SQLite data directory under `root` |
| `backup_dir` | Exactly `<data_dir>/backups`; contains encrypted backup and metadata pairs |
| `api_unit` | Existing `operatoros-lite-api.container` in the user Quadlet directory |
| `api_unit_copy` | Managed copy at `<root>/deploy/operatoros-lite-api.container`; must match `api_unit` before deploy |
| `caddy_unit` | Existing `operatoros-lite-caddy.container` beside `api_unit` |
| `api_service` | Exactly `operatoros-lite-api.service` |
| `caddy_service` | Exactly `operatoros-lite-caddy.service` |
| `api_url` | Explicit HTTP loopback URL and port for the API |
| `web_url` | Explicit HTTP loopback URL and port served by Caddy |
| `min_free_bytes` | Non-negative minimum free bytes required on deployment and image storage |
| `min_free_inodes` | Non-negative minimum free inodes required on those filesystems |
| `backup_max_age_seconds` | Positive maximum age for the selected backup |

The config must not contain credentials. The CLI rejects missing or extra keys,
noncanonical paths, a root user, a remote Podman context, service-name changes,
or paths outside the dedicated deployment/data layout. Choose capacity floors
from the actual artifact size and host filesystem; the example root above is a
layout illustration, not an approved host setting.

Before a switch, the CLI writes a durable transaction and snapshots the current
API unit, managed unit copy, and release identity. `status` reports active or
failed transactions without clearing them. A failed restart/health check tries
to restore only the prior API unit and SPA target; rollback failure keeps the
active transaction and bounded error details for operator recovery. A process
interruption leaves the transaction marker. `rollback` accepts a retained
release only after checking its image, SPA hashes, and schema compatibility.
Neither deployment nor rollback restores a database backup. If rollback itself
fails, use `status`, the retained transaction snapshot, and the user journal to
diagnose; do not delete the marker or restore SQLite automatically.

Example command failures are intentionally fail-closed: wrong SHA/run/artifact,
unavailable attestation trust, missing bundle member, insufficient capacity,
missing/old backup, incompatible schema, wrong service or Podman store, and
health failure all abort. Schema preflight imports the candidate only into its
separate disposable VFS store. Preflight failures occur before import into the
configured service store, SPA staging, or service changes. Post-switch failures initiate application-only rollback and
preserve diagnostics if recovery is incomplete.

The older host helper and the CI release bundle are not interchangeable
formats. The new interface verifies the CI ZIP envelope and its inner
`operatoros-release.tar`; the ZIP envelope digest comes from GitHub's artifact
API, while the inner checksum and attestation cover the release bundle. The
existing live helper remains unchanged and cannot be assumed to consume this
format. See [Ubuntu server deployment](ubuntu-server-deployment.md) for the
current/repository-managed boundary and the still-required host review.

## Roll back the CI change

Revert the Phase 2A PR through a normal reviewed revert PR. Existing CI checks
continue independently; deployed services and data need no change. Delete an
invalid Actions artifact only after recording its identity and reason. Never
reuse its name/checksum for replacement bytes. Application rollback remains a
manual operation using retained prior API/client artifacts; it never reverses a
schema migration. Follow [database operations](database-operations.md).
