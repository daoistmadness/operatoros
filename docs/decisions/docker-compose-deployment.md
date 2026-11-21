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

## Acceptance still required

The repository template, candidate artifact, and CI rehearsal do not establish
the current host image identity or production acceptance. Before any
production use, an authorized operator must verify the rendered host Compose
configuration, match the Caddy image and API image to reviewed identities,
confirm a recent authenticated encrypted backup, and authorize a separate
change window. The live Docker daemon was not available to this review, so no
running container, application runtime, or database state was inspected.

The candidate rehearsal is not a backup/restore, full disaster-recovery, or
production rollback test. Production data, credentials, listeners, containers,
and monitoring remain outside this draft's authorization.
