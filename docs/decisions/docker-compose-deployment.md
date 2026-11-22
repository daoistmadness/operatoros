---
status: draft
last_reviewed: 2026-11-22
---

# Docker Compose deployment source-of-truth candidate

## Status

This draft prepares the Docker Compose files and a CI-built candidate archive
for review. It does not accept Docker as a production runtime or authorize a
host change. The SQLite-only runtime contract and the current unsupported
production-container status remain in force.

## Candidate definition

The reviewed files are `deploy/docker/docker-compose.yml`,
`deploy/docker/Caddyfile`, and `deploy/docker/api.env.example`. Compose is a
parameterized template: the host supplies the image reference, env file, data
root, deployment directories, and static client path. Its host-rendered copy is
therefore not byte-identical to the repository template. A host-side checksum
proves the integrity of that copy, not its provenance from this Git revision.

The Caddyfile matches the observed host copy. The API env file stays outside
the repository and candidate archive; its mode is `0600`, and its parent
directories are `0700`. The API image is built from the existing
`deploy/podman/Containerfile.api`. Docker accepts this standard Containerfile,
so the release build keeps one image definition rather than duplicating it.

Compose keeps API and Caddy ports on loopback, runs both services as numeric
non-root users with read-only root filesystems, drops capabilities, and applies
resource limits. Caddy proxies API and readiness routes, serves the SPA shell,
returns 404 for missing assets, and rejects dotfiles. SQLite remains a
host-mounted file-backed database; no database container or schema migration
is introduced.

## Candidate qualification

Manual Docker-only CI qualification runs on a GitHub-hosted runner after full
release validation and E2E checks. A feature-ref run builds the API from a clean
committed source archive, checks Bun and embedded `bun:sqlite`, and pulls the
pinned Docker Official Image for Caddy 2.11.7. It starts Compose with a
synthetic database and distinct random API secrets, checks health/readiness,
SPA routes, missing-asset and dotfile responses, then switches to a prior-main
API image to verify rollback. Read-only database status checks confirm the
synthetic SQLite file remains valid before and after each image. Startup failure
reports contain container state, health probe exit codes, and allowlisted log
categories; raw container logs are not retained. Cleanup removes only its
unique Compose project, image tags, and private runner-temporary root.

The feature-ref run retains only its sanitized report and receives no
attestation permissions. After the change is merged, the same selector on
protected `main` repeats the rehearsal. Once full release validation and E2E
succeed, a separate job checks the archive SHA-256, embedded source SHA, and
Bun 1.4.5/SQLite 3.54.1 versions, then attests and retains the Docker-loadable
archive. The archive contains the API and Caddy images, Compose files, env
examples, and static client, with no populated API env file, secrets, or
database. It does not publish to GHCR and can be loaded without an image
registry. Each artifact qualifies only its exact source SHA and synthetic
runner environment.

Protected-main result: [CI run 44982611327](https://github.com/daoistmadness/operatoros/actions/runs/44982611327) qualified source `99574ecffe84d470e19ab374f3dc7804e158bf63`. Full release validation, full E2E, Docker Compose deployment/rollback, and protected-main attestation passed. Artifact `14738472380` is named `operatoros-docker-candidate-99574ecffe84d470e19ab374f3dc7804e158bf63-44982611327-1`; its archive SHA-256 is `6135be84f7ea683a4b106310a8b69ca8c92a6ce624f0bd2567119b0d9ae4e580`. The sanitized report records Bun 1.4.5, SQLite 3.54.1, FTS5 enabled, `RESOLVED_BY_FIXED_VERSION`, and verified cleanup. The exact archive checksum and GitHub provenance were also verified locally against the repository workflow, `refs/heads/main`, and the source SHA.

The Docker selector skips the separate Manual release bundle job. PR #400 adds
Docker-specific Trivy and CycloneDX reports for the exact API and Caddy image
config digests, stores the report hashes in the checksummed Docker archive, and
gates protected-main attestation on a separate GitHub-hosted Compose consumer.
Feature-ref transfer archives expire after one day and receive no attestation.
These new checks are not verified until the changed workflow passes on a
protected-main run. The current candidate's rollback exercised synthetic S5.4
data and did not establish recovery after a live process or host failure. No
workflow run qualifies the target host or authorizes deployment.

## Acceptance still required

The repository template, candidate artifact, and CI rehearsal do not establish
the target host image identity or production acceptance. Before any production
use:

1. The owner must explicitly accept Docker Compose and reconcile `AGENTS.md`,
   this draft, the Podman proposal, and the Ubuntu runbook. Keep Docker
   unsupported until that decision is recorded.
2. An authorized operator must identify the Ubuntu host and verify the rendered
   Compose configuration, exact API/Caddy image identities, loopback binds,
   firewall, and HTTPS ingress. The current Caddyfile speaks HTTP; secure
   cookies and exact `ALLOWED_ORIGINS` / proxy trust require a verified HTTPS
   path.
3. Verify host full-disk encryption, OS account isolation, private environment
   file and data-directory modes, and Docker daemon access. The rootful Docker
   socket is host-root-equivalent: do not expose it remotely or mount it into
   application containers; limit host access to named operators.
4. Authenticate a fresh encrypted backup and restore it into an independent
   disposable root. Record key recovery, off-host custody, retention, RPO, RTO,
   and a named restore owner. A checksum or backup status alone is insufficient.
5. Record an authorized S4.3-to-S5.4 migration plan, fresh pre-change backup,
   rollback criteria, and the separate migration approval. Startup validates
   SQLite and does not migrate it.
6. Pass an isolated Ubuntu rehearsal with synthetic data for boot/restart,
   HTTPS and browser authentication, encrypted backup and independent restore,
   cross-release rollback with a post-backup sentinel, and cleanup. Production
   authentication requires an authorized operator session.
7. Verify monitoring coverage, alert delivery, named alert ownership, disk and
   log thresholds, and retention. Then record a separate change window and
   explicit production GO.

No target Docker daemon, production application, database, backup, listener,
or monitoring state was inspected for this review. The hosted rehearsal used
only synthetic data. It is not a backup/restore, full disaster-recovery, or
production rollback test. Production resources remain outside this draft's
authorization.
