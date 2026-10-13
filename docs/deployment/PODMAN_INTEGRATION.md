# Podman and release integration

## Authorities

| Concern | Authority |
| --- | --- |
| Native interactive development | `mise` tasks, `start-dev.sh`, Bun and Vite |
| OCI build definitions | `containers/Containerfile`, `containers/nginx.conf`, `.containerignore` |
| Containerized development entrypoints and environment names | OperatorOS application repository |
| Persistent host Quadlet units, host build context, service names, ports, data mounts and secret references | `daoistmadness/mikhailhomeserver` |
| Persistent container lifecycle | Rootless Podman Quadlet and the user systemd manager |
| CI verification and publication | `.github/workflows/ci.yml` |
| Release image identity | CI release manifest containing GHCR digest references |

`CONTAINER_RUNTIME_NOT_REQUIRED` applies to native offline development and use.
Podman is required only for the optional OCI build, smoke, and deployment path.
Docker Engine and Docker sockets are not used.

## Host Quadlet ownership and promotion

The infrastructure repository is the only source for persistent host units.
OperatorOS does not install, replace, start, or stop them. Its development
image target and direct API/Vite entrypoints are application contracts consumed
by those units. Host installation uses the infrastructure repository's
`mise run operatoros-dev:quadlet:plan`, `quadlet:check`, and explicitly gated
`quadlet:install` tasks. That repository compares installed units with its
source, preserves a restorable copy before changes, and reports drift. No
installation is authorized by this document.

The selected source checkout is a fixed path in the infrastructure Quadlet;
it is not a symlink into a feature worktree and does not invoke `start-dev.sh`.
Changing the checkout path requires a reviewed infrastructure change. The
existing development SQLite directory remains mounted at its current path; the
service does not migrate it. Before any live activation, the data owner and
classification, API environment, and source checkout must be confirmed.

## Development modes

- Native foreground development remains `mise run dev`, `dev:api`, and
  `dev:web`; it does not require Podman.
- Containerized development uses infrastructure-owned Quadlet build and pod units.
  API and Vite run as separate direct processes, use a lockfile-checked
  dependency volume, and share one rootless `slirp4netns` network namespace.
  Only Vite port 5173 is published, bound to `127.0.0.1`; the host's Tailscale
  Serve endpoint remains HTTPS/WSS on port 8444 and is tailnet-only.
- OCI deployment images are separate API and compiled static-web images. The
  production web image uses unprivileged Nginx and does not run Vite.
- OCI image output does not carry Podman healthcheck metadata. Readiness checks
  are defined by Quadlet or by the disposable Podman smoke invocation, where
  the runtime observes health state directly.

The development API bootstraps an absent database only when explicitly enabled
for disposable smoke tests; the persistent host unit leaves that flag unset and
fails closed. It never migrates an existing database on startup. The
infrastructure-owned bind mount preserves the existing development data path.
Ordinary stop/restart/rebuild tasks do not remove data. No development command
selects the protected operational database. See [container environment names](PODMAN_DEVELOPMENT_ENV.md).

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
