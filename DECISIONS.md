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
- Keep PR #380 open for maintainer review. Its checks and nonpublishing
  qualification passed, but no review decision is recorded.
- Keep G3 blocked. The embedded SQLite finding remains open; an adapter smoke
  test does not replace Bun's embedded database. No security exception is
  active.
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
