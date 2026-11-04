---
status: current
last_reviewed: 2026-11-04
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
trusted provenance and validates the bundle,
loads it into a temporary VFS Podman store, bootstraps synthetic S5.4 data, and
starts the imported API without building. A pinned Caddy image checks readiness,
nested SPA routing, missing assets, and dotfile rejection. Cleanup removes only
that temporary store and its fixed names inside that store. This is not a live
Quadlet, reboot, or production-host test.

The existing synthetic host uses two rootless Quadlet containers: API and Caddy.
Caddy serves static SPA files and proxies the API. SQLite stays in a host-mounted
data directory. Access is loopback/private. The draft production decision still
proposes host Caddy; production topology, public ingress/TLS, Ubuntu rehearsal,
and operational approvals remain unresolved. See the [deployment proposal](../decisions/podman-deployment.md).

## Bring the existing helper under version control

The running host helper was reviewed read-only. Its checksum verification,
exclusive deployment lock, safe client extraction, image-ID comparison,
versioned static directories, pre-deploy backup checks, health checks and rollback
can become a single repository-managed script. Replace fixed host paths with one
explicit deployment-root argument and keep unit names/configuration as templates.
Make trusted bundle verification precede its first import or service mutation.
Do not add a competing deploy path: migrate the reviewed helper after approval.

Keep credentials, environment files, encryption keys, deployment logs, backup
metadata, data, generated units, and rollback snapshots outside Git. Host-specific
Quadlet/Caddy settings stay in private deployment configuration. Phase 2A does
not replace the installed helper or units. Its archive inventory differs from
the older local-release-record format; the installed helper cannot consume the
new bundle directly until that separately reviewed integration is implemented.

## Roll back the CI change

Revert the Phase 2A PR through a normal reviewed revert PR. Existing CI checks
continue independently; deployed services and data need no change. Delete an
invalid Actions artifact only after recording its identity and reason. Never
reuse its name/checksum for replacement bytes. Application rollback remains a
manual operation using retained prior API/client artifacts; it never reverses a
schema migration. Follow [database operations](database-operations.md).
