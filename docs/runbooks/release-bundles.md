---
status: current
last_reviewed: 2026-11-05
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

The existing locked setup action supplies Bun and Node. The runner installs
Ubuntu's Podman package and records its actual version. The API uses the existing
Linux amd64 Containerfile, digest-pinned base and production lockfile install.
The SPA uses the existing Vite/Start build. There is no server-side source build,
GHCR publication, automatic deployment, or database migration.

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
never uploaded as a release. Full bundle retention remains 90 days. Scan findings remain visible; producing a report does not
approve security risk. Trivy may omit libraries statically linked into Bun.
Bun 1.4.4's embedded SQLite/FTS5 finding remains a separate security assessment;
the new bundle is not production authorization or a security exception.

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

If consumer verification fails, the complete attested bundle remains only in
the ephemeral runner workspace and is not uploaded. Only the allowlisted
diagnostics artifact is retained. A separately named, short-retention quarantine
artifact could support a future investigation, but this workflow does not create
one and the deployment verifier must never treat such an artifact as accepted.

The existing synthetic host uses two rootless Quadlet containers: API and Caddy.
Caddy serves static SPA files and proxies the API. SQLite stays in a host-mounted
data directory. Access is loopback/private. The draft production decision still
proposes host Caddy; production topology, public ingress/TLS, Ubuntu rehearsal,
and operational approvals remain unresolved. See the [deployment proposal](../decisions/podman-deployment.md).

## Repository-managed deployment interface

`scripts/operatoros-deploy.sh` is the version-controlled interface for the
existing two-container synthetic host topology. It wraps
`scripts/operatoros_deploy.py` and reuses `scripts/release-bundle.py` for the
signed inner bundle. It is not installed on the host and has not replaced or
modified `/mnt/podman-data/operatoros/deploy/deploy.sh` or any live Quadlet.
Copying this interface and its private configuration onto a host requires a
separate deployment approval.

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
transaction snapshots outside Git. The CLI only recognizes the existing
`operatoros-lite-api.service` and `operatoros-lite-caddy.service` identities.

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
