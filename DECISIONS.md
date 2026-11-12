---
status: current
last_reviewed: 2026-11-12
---

# OperatorOS stability decisions

## Decisions from the 25 most recent pull requests

- Keep security gates fail-closed when hosted evidence finds a runtime or
  artifact problem. Do not turn a blocked release green by suppressing the
  finding.
- Bind rehearsal and release evidence to the exact source commit, image digest,
  and bytes that were actually tested. A local smoke test cannot stand in for
  an exact-artifact rehearsal.
- Preserve sanitized stage and guard diagnostics. Do not retain raw secrets,
  database files, private paths, or unbounded command output.
- Verify data across migration, backup, restore, restart, and rollback
  transitions. Startup health alone does not prove preservation.
- Treat prepared host procedures and synthetic tests as preparation. They do
  not prove target-host, independent-device, or off-host recovery acceptance.

## Current decisions

- Keep the existing single-server design: Elysia API, browser frontend, and
  file-backed SQLite. Do not add a database service or broaden the runtime
  migration without evidence and review.
- PR #380 was squash-merged at `e410a562bce588e70573cc8eb0d0d83b6e0e9106`
  after all seven required checks passed. Keep the embedded-runtime release
  gate in force; the merge does not qualify the current Bun/SQLite runtime.
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
