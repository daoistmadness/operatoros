---
status: current
last_reviewed: 2026-11-28
---

# Docker Compose deployment architecture

## Status

Accepted on 2026-11-24 and established in production on OPRSERVER with S56 (`20261126_s56`, release `5f158ae7f1b14e4f26641ae0f9e8705a04d03ba6`, CI run `45779081840`). This records the last documented production acceptance; current source targets S57 (`20261127_s57`) and does not imply production has migrated. Docker Engine and Docker Compose are the single
canonical production container deployment architecture for OperatorOS on OPRSERVER.
Production runs under UID/GID 1000:1000 with Caddy reverse proxy, Tailscale HTTPS
ingress, and persistent LUKS2-backed SQLite storage (last documented production schema `20261126_s56`; current source target `20261127_s57`). Podman and Quadlet alternatives
are discontinued. Native Bun is the single canonical development runtime. Ongoing preflight, migration, and acceptance rules live in [the Ubuntu server deployment runbook](../runbooks/ubuntu-server-deployment.md).

## Canonical source files

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
pinned Docker Official Image for Caddy 2.11.9-alpine. It starts Compose with a
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

The qualification details and run above are historical evidence for their
recorded source SHA. The current workflow and its required candidate evidence
are defined by [CI](../../.github/workflows/ci.yml) and the
[release-bundle runbook](../runbooks/release-bundles.md). A candidate qualifies
only its exact source SHA and synthetic runner environment. It does not
establish current target-host state or authorize deployment.

## Operational boundary

Docker Compose acceptance was recorded in the status above. The older
pre-acceptance checklist and candidate rehearsal are not current operational
instructions. The [Ubuntu server deployment runbook](../runbooks/ubuntu-server-deployment.md)
is the single authority for exact artifact verification, host preflight,
backup and migration prerequisites, deployment, rollback, and production GO.
Each release still requires its own applicable authorization and exact
candidate qualification. This decision does not assert current host or
production state.
