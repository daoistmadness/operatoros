---
status: current
last_reviewed: 2026-11-19
---

# Docker Compose single-host deployment

## Decision

The production deployment of OperatorOS on `oprserver` is defined by the Docker
Compose file in `deploy/docker/docker-compose.yml` together with
`deploy/docker/Caddyfile` and the key-only `deploy/docker/api.env.example`.
The running host keeps its own copy at `/home/mikhailryu/docker/operatoros/`
under a recorded SHA-256 manifest; the repository copy is the reviewed source,
and the host copy is the deployed instance of it.

This record supersedes the Podman single-host proposal as the deployment target
for this host. The Podman record remains in history and still describes a
possible future topology; nothing in it is implemented in production today.

## Context

The host has run two Docker Compose services, `operatoros-api` and
`operatoros-caddy`, since 2026-11-17. The API image is a local tag built from
commit `2863aff0` on 2026-11-03 and marked `pull_policy: never`; the Caddy image
is a local tag. Before this decision the Compose file, Caddyfile, and env file
existed only on the host, protected by `production.sha256`. A fresh clone could
not reconstruct the deployment, and a lost host directory would have left no
reviewed definition.

## Consequences

- The service topology, security options, health checks, resource bounds, and
  volume layout are reviewable in Git. Secret values are not: the API reads
  them from a host-managed env file with mode 0600, referenced by
  `OPERATOROS_API_ENV_FILE`.
- Host-specific paths and the image tag are inputs, not constants. The same
  file renders the current host and a rehearsal host.
- This decision adds no deploy automation. Image build, tag selection, and
  service replacement remain manual, and the Podman-based scripts under
  `scripts/` do not target this stack. Tracked separately as deployment
  automation work.
- The Caddyfile is copied byte-for-byte from the running host file, so the
  reviewed definition and the deployed reverse proxy cannot drift silently.
- `deploy/podman/Containerfile.api` remains the single image build definition.
  Its directory name is historical; moving it is a separate change because it
  would touch release scripts and provenance checks.

## Verification

- `docker compose -f deploy/docker/docker-compose.yml config` renders both
  services with the expected image, user, read-only root, dropped capabilities,
  published loopback ports, volumes, and health checks.
- `sha256sum -c production.sha256` on the host still proves the deployed copy
  matches the reviewed copy.
- `docker inspect` confirms the running containers match the rendered values.

## What this record does not authorize

It does not authorize a rebuild, a redeploy, a secret change, or a change to
the running services. It records where the definition lives and how to review
it.
