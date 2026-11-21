---
status: draft
last_reviewed: 2026-11-21
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

Manual CI qualification builds the API with Docker from a clean committed
source archive, checks Bun and embedded `bun:sqlite`, and pulls the pinned
Docker Official Image for Caddy 2.11.7. It starts the Compose stack on a
GitHub-hosted runner with a synthetic database and distinct random API
secrets. The rehearsal checks health, readiness, SPA routes, missing-asset and
dotfile responses, then switches to a separately built current-main API image
to verify image rollback. Cleanup removes only its unique Compose project,
image tags, and private runner-temporary root; the report contains phase status
and runtime identity but no secret values.

CI saves the API and Caddy images with the Compose file, Caddyfile, env
examples, and static client in a Docker-loadable archive. It includes no
populated API env file or credential values. GitHub build
provenance attests the archive. It does not publish to GHCR and can be loaded
without an image registry. The artifact and rehearsal qualify only the exact
source SHA and synthetic runner environment.

## Acceptance still required

The repository template, candidate artifact, and CI rehearsal do not establish
the current host image identity or production acceptance. Before any
production use, an authorized operator must verify the rendered host Compose
configuration, match the Caddy image and API image to reviewed identities,
confirm a recent authenticated encrypted backup, and authorize a separate
change window. The live Docker daemon was not available to this review, so no
running container, application runtime, or database state was inspected.

The candidate rehearsal is not a full disaster-recovery test or a production
rollback rehearsal. Production data, credentials, listeners, containers, and
monitoring remain outside this draft's authorization.
