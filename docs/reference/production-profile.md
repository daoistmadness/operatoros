---
status: draft
last_reviewed: 2026-11-01
---

# Production origin and cookie profile

Draft environment profile for a single local Elysia API process per SQLite data
root with a browser frontend. The application runtime is local-first; this
profile is not an approved production deployment procedure.

The defaults in `apps/api/src/config.ts` are loopback-oriented. A LAN, hostname,
or HTTPS deployment must set the variables below explicitly; the origin checks
fail closed when it does not.

## Environment contract

| Variable | Required | Rule | Source symbol |
| --- | --- | --- | --- |
| `ALLOWED_ORIGINS` | Yes for any browser origin that is not the loopback default | Comma-separated exact origins. Each entry must parse as `http`/`https` with no credentials, path, query, or fragment. Matching is exact (scheme + host + port); no wildcard, no substring match. | `parseAllowedOrigins`, `normalizeOrigin`, `isAllowedOrigin` in `apps/api/src/security/http.ts`; `allowedOrigins` in `apps/api/src/config.ts` |
| `COOKIE_SECURE` | Yes when the browser uses HTTPS | `true` sets the `Secure` attribute on the session and setup cookies. Default `false` for loopback HTTP. | `cookieSecure` in `apps/api/src/config.ts`; cookie headers in `apps/api/src/auth/routes.ts` |
| `TRUSTED_PROXY_ADDRESSES` | Only behind a reverse proxy | Comma-separated exact direct-peer IPs. Any non-IP value throws at startup. `X-Forwarded-For`/`Forwarded` are read only when the direct socket peer IP is listed exactly; otherwise the direct peer is the client address. Keep empty for direct local use. | `parseTrustedProxyAddresses` and `clientIp` in `apps/api/src/security/http.ts` and `apps/api/src/auth/service.ts` |
| `AUTH_COOKIE_SECRET` | Yes | At least 32 characters after trimming. HMAC secret for opaque server-side session digests. Never expose it to the browser; rotate per the rotation runbook. | `requireSecret` in `apps/api/src/auth/service.ts` |
| `BACKUP_ENCRYPTION_KEY` | Required for new backups | Canonical Base64 of exactly 32 random bytes. Must differ from `AUTH_COOKIE_SECRET` (`BACKUP_ENCRYPTION_KEY_REUSE`). Without a key, new backups refuse (`BACKUP_ENCRYPTION_KEY_REQUIRED`, "Plaintext backups are disabled"). | `parseBackupEncryptionConfig`, `keyBytes` in `apps/api/src/security/backup-crypto.ts`; `createBackup` in `apps/api/src/domains/safety.ts` |
| `BACKUP_ENCRYPTION_KEY_ID` | Together with the key | Short non-empty identifier, at most 64 characters from `A-Za-z0-9._-`. It is part of the authenticated envelope metadata and selects the key on decrypt; old keys go to `BACKUP_ENCRYPTION_PREVIOUS_KEYS`. | `keyId`, `metadata`, `encryptBackup`, `decryptBackup` in `apps/api/src/security/backup-crypto.ts` |
| `ENABLE_DESTRUCTIVE_OPERATIONS` | No | Keep `false` in production. Restore refuses with `RESTORE_DISABLED` and data reset with `DESTRUCTIVE_OPERATIONS_DISABLED` unless it is `true`. Enable only for a controlled restore/maintenance window. | `destructiveOperationsEnabled` in `apps/api/src/config.ts`; `restore` in `apps/api/src/domains/safety.ts`; `apps/api/src/domains/data-reset.ts` |
| `BACKEND_WORKERS` | No (declaration only) | No application code reads it. Keep one API process per SQLite data root; backup, restore, and scheduler guards are process-local module state and never coordinate separate processes. `docs/runbooks/backup-restore.md` documents the single-worker restore restriction; the admin backup status reports `restore_support_mode: single_process_only` and `restore_multi_worker_safe: false`. | No runtime symbol; `docs/runbooks/backup-restore.md` |
| `OPERATOROS_DATA_DIR` | Recommended; required for explicit layouts | Absolute data root. Derives `operatoros.sqlite`, `backups/`, and `logs/`. When `DATABASE_URL`/`DATABASE_PATH` is also set it must resolve to the derived database path or startup fails; when `BACKUP_DIR` is set it must equal the derived backups path. Ordinary startup validates databases and never migrates them. `OPERATOROS_DEV_DATA_DIR` is a deprecated alias. | `resolveOperatorOSPaths` in `packages/db/src/data-dir.ts`; path checks in `apps/api/src/config.ts` |

Related first-run variable: `ASTRYX_SETUP_TOKEN` protects initial administrator
provisioning. When it is set, `POST /api/setup/admin` requires it in the request
body as `setup_token`, `/api/setup/status` reports `setup_token_required: true`,
and the first-run screen asks for it. When it is unset outside managed
development, provisioning stays closed (`SETUP_AUTHORIZATION_UNAVAILABLE` /
`SETUP_AUTHORIZATION_REQUIRED`). It is required on a fresh production data root
and should be removed from deployed secrets after provisioning.

## Exact-origin behavior

- Any request that carries an `Origin` header not in `ALLOWED_ORIGINS` is
  rejected with 403 before routing. The `null` origin is treated as foreign.
- For an allowed origin, CORS returns that exact origin with
  `access-control-allow-credentials: true` and `vary: Origin`; preflight
  `OPTIONS` returns 204. A wildcard would be incompatible with credentials and
  is not supported.
- Safe methods (`GET`, `HEAD`, `OPTIONS`) do not require an origin.
- Cookie-authenticated unsafe requests (`POST`, `PUT`, `PATCH`, `DELETE` with
  `astyx_session` or `operatoros_setup_authorization`) require an allowed
  `Origin`; a missing origin is rejected with 403.
- Non-browser internal clients with neither cookie nor origin keep working;
  the checks are scoped to browser-relevant requests.

## Cookie and HTTPS profile

- `astyx_session` stays HttpOnly, SameSite Lax, path `/`; setup authorization
  uses SameSite Strict under `/api/setup`.
- Set `COOKIE_SECURE=true` when the page is served over HTTPS. The value is a
  literal string comparison; `True`, `1`, or `yes` do not enable it.
- Keep loopback HTTP deployments on `COOKIE_SECURE=false`, otherwise the
  browser drops the cookie and no session is created.

## Single-worker rule

Run exactly one API process against a data root. Restore replaces the SQLite
database in place, and the operation locks (`backupBusy`, `restoreBusy`) are
module-level state. Restore additionally refuses when destructive operations
are disabled. The baseline deployment is one supervised service instance.

## Enablement checklist (disposable root)

Reproduce before exposing the service beyond loopback:

| Check | Expected result |
| --- | --- |
| `POST /api/auth/login` with `Origin: https://attacker.example` | 403, no cookie |
| `POST /api/auth/login` with a listed origin and valid credentials | 200 plus `Set-Cookie` for `astyx_session` |
| Cookie-authenticated unsafe request without `Origin` | 403 |
| Cookie-authenticated unsafe request with a listed origin | Routed normally |
| An allowed origin with a path, query, or credentials (for example `https://host/@evil`) | Rejected as invalid |
| Origin differing only by suffix (`https://host.evil`) | 403 |
| HTTPS deployment | `COOKIE_SECURE=true`; `Set-Cookie` carries `Secure` |
| Second API process against the same data root | Not supported; stop instead |

## Test coverage

The profile is enforced by the API test suite. Relevant tests by name:

- `apps/api/tests/security.test.ts`: "uses the direct peer unless an exact
  trusted proxy is configured"; "rejects foreign Origins and protects
  cookie-authenticated unsafe requests"; "normalizes exact origins without
  substring matching"; "validates key size and forbids cookie-secret reuse";
  "fails closed for wrong keys, tampering, truncation, and unknown versions".
- `apps/api/tests/app.test.ts`: "derives the database, backup, and log paths
  from the canonical root"; "fails fast when DATABASE_URL disagrees with the
  canonical root"; "two apps use their own config values".

## Podman deployment status

A single-host Podman deployment is proposed in
[the Podman deployment decision](../decisions/podman-deployment.md). It is not
supported or approved until production image and Quadlet inputs exist and an
authorized Ubuntu rehearsal passes. The current rootless Podman workflow is for
local development only.

For a later approved deployment, use the designated rootless account to inspect
the approved Podman services. Treat observed host values as facts only after
checking the host inventory and release record.

For an authorized, non-invasive review, list container names, states, and
published ports. Inspect only explicitly selected metadata fields. Compare
observed listeners and routes with the approved exposure plan. A read-only
`GET` to a verified health URL may confirm service response; the direct API
`/health` contract is HTTP 200 with `{"status":"ok"}`. This does not establish
host-firewall or upstream reachability. Inspect TLS certificate subject,
issuer, validity, and fingerprint without exporting private keys. Review only a
bounded log window and sanitize it before recording.

Do not trigger a health check, log in, or send another state-changing request
without approval for that operation. Do not copy, hash, snapshot, or run
integrity checks on a production database. Never place credentials, cookies,
student data, database material, or unredacted logs in evidence. Record only
sanitized results and SHA-256 hashes of permitted evidence artifacts.

## Related

- [Ubuntu server deployment proposal](../runbooks/ubuntu-server-deployment.md) (draft).
- [Offline install procedure](../guides/offline-install.md) (draft).
- [Log rotation procedure](../runbooks/log-rotation.md) (draft).
- [Backup and restore](../runbooks/backup-restore.md), [Secret rotation](../runbooks/secret-rotation.md), [Security model](security-model.md).
