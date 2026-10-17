# Deployment

Ubuntu-first deployment hub for the supported runtime: a local Elysia API
(`apps/api`) with one SQLite data root, and the React frontend (`apps/web`) in a
browser. PostgreSQL and container runtimes are not supported
(`POSTGRESQL_NOT_SUPPORTED`, `CONTAINER_RUNTIME_NOT_REQUIRED`).

## Read in this order

1. [Ubuntu server deployment and supervision](ubuntu-server.md) - service unit,
   paths, environment file, first start, upgrade/rollback, backup, and
   monitoring. This runbook is the current Ubuntu deployment runbook of the
   integrated Phase 3 documentation bundle.
2. [Production origin and cookie profile](production-profile.md) - the exact
   environment contract for `ALLOWED_ORIGINS`, `COOKIE_SECURE`,
   `TRUSTED_PROXY_ADDRESSES`, the secrets, the single-worker rule, and the
   enablement matrix.
3. [Offline install and start](offline-install.md) - primed Bun cache install,
   direct API start, prebuilt web assets, and the explicit network limits.
4. [Log rotation](log-rotation.md) - the JSONL audit-log policy, journald caps,
   and the rotation drill.
5. [systemd unit](systemd/operatoros-api.service) - the service template used by
   the runbook.

Phase 3 status: `ubuntu-server.md` (P3-01), `production-profile.md` (P3-10),
`offline-install.md` (P3-11), `log-rotation.md` (P3-08), and
`systemd/operatoros-api.service` (P3-01) are part of the integrated Phase 3
documentation bundle; if one of the links above does not resolve, the checkout
predates the bundle's integration.

## Prerequisites

- Ubuntu server with systemd.
- `curl` for health checks.
- `lsof` for the backup/restore handle checks; a missing `lsof` fails those
  checks closed.
- `python3` for the documented secret generation command.
- Native Linux Bun 1.4.3, installed through mise or exposed on a stable path;
  never a Windows/WSL-interop binary.

For backup safeguards, schema state, and rollback rules see
[Database operations](../operations/DATABASE_OPERATIONS.md). For the security
model see [Security hardening](../security/SECURITY_HARDENING.md); for secret
rotation see [Secret rotation runbook](../security/ROTATION_RUNBOOK.md).
