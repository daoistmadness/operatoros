# Podman and release integration

## Authorities

| Concern | Authority |
| --- | --- |
| Native interactive development | `mise` tasks, `start-dev.sh`, Bun and Vite |
| OCI build definitions | `containers/Containerfile`, `containers/nginx.conf`, `.containerignore` |
| Development Quadlet templates | `containers/quadlet/dev/` in OperatorOS |
| Installed host Quadlets and secret files | The host infrastructure repository |
| Persistent container lifecycle | Rootless Podman Quadlet and the user systemd manager |
| CI verification and publication | `.github/workflows/ci.yml` |
| Release image identity | CI release manifest containing GHCR digest references |

`CONTAINER_RUNTIME_NOT_REQUIRED` applies to native offline development and use.
Podman is required only for the optional OCI build, smoke, and deployment path.
Docker Engine and Docker sockets are not used.

## Host Quadlet ownership and promotion

The installed `operatoros-dev.container` and `operatoros-dev.build` files, and
the separate host-side development Containerfile, belong to the host
infrastructure repository. OperatorOS does not overwrite those live files or
their secret environment file. The host repository must remove its duplicated
application definitions and promote the reviewed templates from
`containers/quadlet/dev/` after this change is merged.

The host integration change should pin an approved OperatorOS commit, materialize
its Quadlet source in a stable release directory, and copy the files into the
user Quadlet directory. It must not point a persistent service at a feature
worktree. The promotion should:

1. Show `mise run podman:quadlet:plan` output and review every changed unit.
2. Preserve a restorable copy of the current installed units and their mode.
3. Apply only after the host infrastructure change is approved.
4. Run `systemctl --user daemon-reload` and start only the OperatorOS units.
5. Verify `systemctl --user status` and application readiness separately.
6. Run the plan again; a non-empty diff is host configuration drift.

`mise run podman:quadlet:install -- --apply` performs the copy and keeps prior
changed definitions under `$XDG_STATE_HOME/operatoros/quadlet-backups/`. It is
not run by CI and has not been run against the live host in this migration.
The host repository still needs an approved integration change; until then,
the existing host definitions remain externally owned and may drift.

## Development modes

- Native foreground development remains `mise run dev`, `dev:api`, and
  `dev:web`; it does not require Podman.
- Containerized development uses the source-controlled Quadlet build and pod.
  API and Vite run as separate direct processes, use a lockfile-checked
  dependency volume, and share one rootless `slirp4netns` network namespace.
  Only Vite port 5173 is published, bound to `127.0.0.1`; the host's Tailscale
  Serve endpoint remains HTTPS/WSS on port 8444 and is tailnet-only.
- OCI deployment images are separate API and compiled static-web images. The
  production web image uses unprivileged Nginx and does not run Vite.
- OCI image output does not carry Podman healthcheck metadata. Readiness checks
  are defined by Quadlet or by the disposable Podman smoke invocation, where
  the runtime observes health state directly.

The development API uses disposable bootstrap only when its database file is
absent. The Quadlet data volume is preserved by normal down, restart, and
rebuild tasks. No development command selects the protected operational
database.

## CI, publication, and deployment limits

The Podman CI job builds and smokes the committed OCI definitions, checks the
rootless runner, scans for HIGH/CRITICAL vulnerabilities and secrets, and
generates CycloneDX SBOMs. Its synthetic database must report schema
`20261002_s48`. The GHCR job is limited to a successful `main` push after the
required checks and uses that job's `GITHUB_TOKEN`; pull requests and merge
groups do not receive package-write permissions.

The repository currently has no GHCR packages. Publication and registry digest
pull verification remain unverified until an authorized `main` push runs the
job. The publisher is disabled unless repository variable
`OPERATOROS_ENABLE_GHCR_PUBLISH=true` is set, and targets the `oci-publish`
environment. Before enabling it, configure that environment with required
reviewers and protect `main` with pull request review and the API, frontend,
and `podman-images` required checks. The branch is currently unprotected, so
the fail-closed variable is intentionally unset. A local Podman manifest digest
is not a GHCR release digest.

`mise run deploy:check` and `deploy:plan` are non-mutating. Planning requires an
explicit environment and a CI release manifest whose API and web references
are GHCR digests. Remote `deploy:apply` remains blocked until the host
infrastructure owner provides an approved target and adapter. No staging host
or credentials were supplied. `deploy:verify` runs the OCI application against
disposable S4.8 data; `deploy:rollback` fault-injects a missing local OCI
digest, restores the prior local release reference atomically, and verifies
the old application becomes healthy again. This is a local simulation, not a
staging or production deployment.

Database schema changes still require an explicit migration and backup/restore
plan. Image rollback alone does not reverse a database migration.
