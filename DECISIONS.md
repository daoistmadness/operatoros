---
status: current
last_reviewed: 2026-11-13
---

# OperatorOS stability decisions

## Decisions from the 25 most recent pull requests

Reviewed the 25 newest GitHub PRs returned on 2026-11-12: #357–#381, including
the open Phase 7 follow-up #381. Their descriptions and recorded hosted/local
failure evidence show these recurring lessons:

- **Keep release gates fail-closed and evidence tied to the artifact.** PRs
  #358, #360, #366, #380, and #381 bind verification to source, run, artifact,
  and image identity. Keep the embedded SQLite finding in the SBOM and block
  attestation while G3 is open; scanner scope or an adapter smoke test is not a
  security disposition.
- **Test state changes, not only health.** PRs #360, #375, and #376 distinguish
  application rollback from database recovery and preserve a unique write made
  after backup across restart, rollback, and interrupted recovery. Require the
  same invariant in future rehearsal evidence; a healthy endpoint or
  pre-backup row is insufficient.
- **Carry one verified runtime context through every operation.** PRs #362,
  #369, #371, and #374 exposed storage configuration drift, a non-empty
  bootstrap root, and a validator that lost the accepted private Podman
  context. Pass the validated context to validators and units, assert effective
  identity and paths, and do not loosen a guard to make a mismatched runner
  pass.
- **Make failures and cleanup auditable without leaking internals.** PRs
  #359, #367, #368, #370, #372, #373, and #375 show that stale stage names,
  missing exit/operation identity, combined stdout/stderr, and incomplete
  cleanup can hide the first failure. Keep stable allowlisted failure classes,
  the last completed guard, operation and exit status, and cleanup status. Keep
  raw stderr, secrets, database files, private paths, and shared stores out of
  retained evidence.
- **Keep privileges and host acceptance narrow.** PRs #363, #377, #378, and
  #379 separate preparation from live host changes, allow only the Caddy
  capability required by the pinned image, and disable the unused Caddy admin
  endpoint. Synthetic runner success still does not prove target-host,
  independent-device, or off-host recovery acceptance.
- **Prefer small, measured changes.** PR #357 consolidated duplicate UI
  ownership but measured no meaningful bundle-size improvement. Retain such a
  change for simpler dependency ownership, not as a performance claim; avoid
  broad migrations without measured benefit and end-to-end acceptance.

The resulting order is to qualify the runtime, build one exact candidate, run
the isolated lifecycle and recovery checks against that digest, then verify
independent recovery and access controls before any production decision. Keep
the single-server SQLite architecture and production NO-GO boundary in place.

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
- Keep G3 blocked. A source audit found 19 production modules using `bun:sqlite`
  or Drizzle's Bun adapter. The `better-sqlite3` smoke test shows adapter
  feasibility, but a driver swap leaves Bun's embedded SQLite in the executable
  and does not pass the current runtime gate. Do not pursue that migration as a
  G3 fix without a reviewed disposition for the embedded component. No security
  exception is active.
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
