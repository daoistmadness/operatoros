---
status: current
last_reviewed: 2026-11-13
---

# OperatorOS stability decisions

## Decisions from the 25 most recent pull requests

Reviewed the 25 newest GitHub PRs returned on 2026-11-13: #362–#386. PR #386
was open; #362–#385 were merged. Review covered titles, descriptions, changed
files, and the hosted/local failure and validation evidence recorded in the PRs.
The recurring lessons are:

- **Bind each release result to its source and artifact.** PRs #366, #380, and
  #381 bind qualification to source, run, artifact, and image identity. PRs
  #382, #384, #385, and #386 show why those records also need exact merge and
  post-merge CI/CodeQL commits, with skipped release jobs reported as skipped.
  Keep signing fail-closed until the runtime inventory, scan, and security
  disposition match the same source and image digest.
- **Test state changes, not only health.** PRs #375 and #376 preserve a unique
  write made after backup across restart, rollback, and interrupted recovery.
  Require the same invariant in future rehearsal evidence; a healthy endpoint
  or pre-backup row is insufficient.
- **Carry one verified runtime context through every operation.** PRs #362,
  #369, #371, and #374 exposed storage configuration drift, a non-empty
  bootstrap root, and a validator that lost the accepted private Podman
  context. PR #383 found active systemd-managed monitors missing from the
  queried Podman listing, so that runtime context still needs reconciliation.
  Pass the verified context to validators and units, and assert effective
  identity and paths.
- **Make failures and cleanup auditable without leaking internals.** PRs #367
  through #375 show how stale stage names, missing operation identity, combined
  stdout/stderr, and incomplete cleanup can hide the first failure. Keep stable
  allowlisted failure classes, the last completed guard, operation and exit
  status, and cleanup status. Keep raw stderr, secrets, databases, private
  paths, and shared stores out of retained evidence.
- **Keep privileges and host acceptance narrow.** PRs #363 and #377–#379
  separate preparation from host changes, allow only the Caddy capability
  required by the pinned image, and disable its unused admin endpoint. PR #383
  hardened Windows checks but left the actual restore and Identity A/B results
  unverified. Static checks do not replace an authorized Windows run.
- **Make CI prerequisites deterministic.** PR #383 authenticated the existing
  checksum-pinned mise asset request with the workflow's read-only token after
  hosted bootstrap failures. Keep both asset and extracted-binary hashes
  pinned, and grant only `contents: read`.
- **Close each fix at the boundary that failed.** PRs #365 and #378–#379 added
  checks for the actual GitHub response shape and pinned image behavior; PRs
  #367–#376 added isolated rehearsal checks after recorded hosted failures.
  Keep a small regression test for each reproduced failure and run the exact
  image or host boundary that unit tests cannot cover.

The resulting order is to qualify the final image runtime, run exact-source CI,
bind the SBOM and provenance to one digest, exercise lifecycle and recovery
against that image, then verify independent recovery and access controls before
any production decision. Keep the single-server SQLite architecture and
production NO-GO boundary in place.

## Current decisions

- Keep the existing single-server design: Elysia API, browser frontend, and
  file-backed SQLite. Do not add a database service or broaden the runtime
  migration without evidence and review.
- PR #380 was squash-merged at `e410a562bce588e70573cc8eb0d0d83b6e0e9106`
  after all seven required checks passed. Keep the embedded-runtime release
  gate in force; the merge does not qualify the current Bun/SQLite runtime.
- Enforce squash-only merges in both the repository settings and the active
  `main` ruleset. Strict status checks, no-bypass enforcement, and branch
  deletion/force-push protection remain enabled.
- Fetch the checksum-pinned mise release asset using the workflow's
  read-only `contents` token. Anonymous GitHub API traffic shares a 60-request
  hourly limit by originating IP ([GitHub rate-limit policy](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api));
  keep the release asset ID and archive and binary checksums pinned, and do not
  grant the bootstrap write permissions.
- Keep the released source G3 gate closed until the exact reviewed candidate
  passes hosted CI, SBOM/scan/provenance checks, and signing. The local OCI
  candidate now uses Node 24.22.3 and `better-sqlite3` 13.1.1 with SQLite 3.54.1
  in both `node:sqlite` and the native addon; the final image contains no Bun
  runtime. The image base digest is pinned, the Node binary and both SQLite
  copies are probed from the image, and local synthetic API, worker, restart,
  encrypted-backup, and restore checks passed. Node 24.22.3
  is the official security release ([release](https://nodejs.org/en/blog/release/v24.22.3),
  [security advisory](https://nodejs.org/en/blog/vulnerability/november-2026-security-releases)).
  This candidate is local evidence only; it does not qualify a release artifact
  or production host. Bun remains the local build/development tool. No security
  exception is active.
- The first local Node-image lifecycle run exposed a shutdown bug: closing the
  raw adapter server bypassed Elysia `onStop` hooks, leaving the backup
  scheduler and employee-retention timer active while SQLite closed. The timer
  then queried a closed database, and SIGTERM did not exit cleanly. The server
  now calls `app.stop(true)` for both adapters so lifecycle hooks run before
  the database and operation lock close. The corrected exact-source image
  passed three clean SIGTERM stops, API readiness, encrypted backup and active
  restore, schema/integrity validation, and pre/post-backup sentinel checks on
  synthetic data. Evidence is recorded in the [stability report](STABILITY_REPORT.md).
- The hosted Node candidate scan on source `5dece3befffcdf3b4015918643b499d37ccb7255`
  found 19 CVEs: 6 High, 12 Medium, and 1 Low. Trivy located every finding in
  the Node base image's unused npm tree at
  `/usr/local/lib/node_modules/npm`; the application does not invoke npm at
  runtime. Remove npm and its `npm`/`npx` shims from the final image, and make
  the shared candidate and release verifier reject any unresolved High or Critical
  Trivy finding. Keep all scan findings in the retained SBOM/report; do not
  suppress them. The exact-source rescan remains pending.
- Do not rebind the development service or migrate its live database until a
  relaunchable s48 source and source-plus-database recovery path pass isolated
  tests, a fresh backup is verified, and development cutover is authorized.
- Do not change Tailscale, firewall, production routes, host services, or
  production data as part of readiness work.
- D2 access evidence must come from separate online Windows Tailscale sessions.
  Compare device and user fingerprints, have a tailnet administrator map them
  to the approved identities and verify effective grants, and require TCP 443
  to fail for both identities. A command-line identity label or an offline
  device is not authorization evidence.
- Keep the proposed audit-log rotation policy in draft until its host config,
  retention, disk budget, and named monitoring owner are accepted. A synthetic
  logrotate drill does not authorize changes to host logging configuration.
- Keep production NO-GO until all mandatory gates pass and the owner explicitly
  authorizes deployment.

These are status decisions, not replacements for the canonical architecture
and operating procedures linked below.

## Canonical decisions and runbooks

- [SQLite-only local runtime](docs/decisions/sqlite-only-runtime.md)
- [Podman single-host deployment](docs/decisions/podman-deployment.md)
- [Database operations](docs/runbooks/database-operations.md)
- [Ubuntu server deployment](docs/runbooks/ubuntu-server-deployment.md)
- [Backup and restore security](docs/runbooks/backup-restore.md)
- [Release bundle verification](docs/runbooks/release-bundles.md)
