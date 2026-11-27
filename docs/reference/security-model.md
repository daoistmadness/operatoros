---
status: current
last_reviewed: 2026-11-28
---

# Security model

This document defines the active security model. It does not change product or
database semantics.

## Authentication and request trust

- `astyx_session` remains an HttpOnly, server-side session cookie.
- The API does not use JWTs or localStorage authentication.
- Existing account lockout remains active.
- Login adds three in-process limits. The default 60-second window allows 20
  attempts per direct IP, 10 attempts per trimmed account identifier, and 100
  attempts globally. The limiter keeps at most 10,000 keys and prunes them
  lazily. Successful login clears only the account bucket.
- The direct socket peer is the IP authority. `X-Forwarded-For` and
  `Forwarded` are ignored unless `TRUSTED_PROXY_ADDRESSES` lists the exact
  direct peer IP. A limited login returns 429 and `Retry-After` without
  revealing account status.

### Legacy student-route exception

`GET /api/students` remains an explicit limited open-read endpoint for
compatibility. It returns only the legacy student ID, name, jenjang, and class
fields. Other routes in that legacy route family require the existing student
or attendance capability. Staff attendance summaries and histories are
restricted to enrollment and attendance dates inside the staff member's active
class assignments. Summary totals for reported absence reasons are restricted
to the recorded class and month when the enrollment and assignment overlap that
month. Student creation and class mutations require their existing create/edit
capabilities. A successful response from the limited directory route does not
imply that other API routes are public.

## CSRF and CORS

Cookie-authenticated unsafe requests require an exact allowed `Origin`. The
same origin list configures CORS. Foreign origins fail closed. A request with
browser fetch metadata but no `Origin` fails closed. A request with neither
header remains available for non-browser internal clients and tests. Safe
methods do not require Origin validation.

The session cookie remains HttpOnly and SameSite Lax. Setup authorization uses
HttpOnly and SameSite Strict. `COOKIE_SECURE=true` is required for HTTPS.

## Encrypted backups

New application backups use an application-level envelope. The live SQLite
database is stored in plaintext. Full-disk encryption and OS-level account
isolation are strict deployment requirements. Do not deploy or operate
OperatorOS without both. Backup encryption protects backup artifacts only and
does not protect the live database.

| Field | Value |
| --- | --- |
| Magic | `OPERATOROS_BACKUP` |
| Version | `1` |
| Algorithm | `aes-256-gcm` |
| Nonce | 12 random bytes, Base64 encoded |
| Tag | 16-byte GCM authentication tag, Base64 encoded |
| Key ID | `BACKUP_ENCRYPTION_KEY_ID` |
| Key | `BACKUP_ENCRYPTION_KEY`, canonical Base64 for 32 bytes |

The magic, version, algorithm, and key ID form authenticated GCM metadata.
The SHA-256 value in the manifest covers the final encrypted artifact. The
backup file is written with restrictive permissions. Temporary plaintext
SQLite snapshots use a private temporary directory and are removed in a
finally block. This does not claim secure filesystem erasure.

The active key encrypts new backups. `BACKUP_ENCRYPTION_PREVIOUS_KEYS` is a
JSON object of key IDs to old Base64 keys for restore. Unknown key IDs, wrong
keys, modified metadata, modified ciphertext, modified tags, truncation, and
unknown versions fail closed. Existing plaintext backups are not rewritten.
Legacy plaintext restore is refused unless `ALLOW_LEGACY_PLAINTEXT_BACKUPS`
is explicitly enabled.

`BACKUP_ENCRYPTION_KEY` must differ from `AUTH_COOKIE_SECRET`. Never commit
either secret. See [the rotation runbook](../runbooks/secret-rotation.md).

For an OperatorOS Docker Compose deployment, keep the API env file outside the
repository and release archive with mode `0600`. Keep its parent directories at
mode `0700`.

The synthetic CI rehearsal keeps secret files at mode `0600` in a runner-owned
private directory. After it transfers the synthetic database to UID/GID 1000,
the directory uses group `1000` and mode `0710`. Group members can traverse the
directory but cannot list or create entries. CI removes the directory only
after it verifies Compose cleanup. The candidate archive includes env examples,
but no populated env file or secret values. Run
`bun scripts/check-backup-dir.ts <backup-dir>` to find unexpected entries,
incomplete encrypted pairs, and non-regular artifact or audit files. A clean
result verifies directory layout, not artifact encryption or recoverability.

Docker startup-failure reports retain only container state, health probe exit
codes, and allowlisted error categories; raw container logs and database
contents are discarded. Feature-ref rehearsals have `contents: read` and do not
retain a release archive. The separate protected-main Docker attestation job
receives OIDC and attestation permissions only after full validation and E2E
succeed.

The application currently has no FTS5 query path. Startup and restore checks
reject virtual tables by requiring ordinary table objects from SQLite's
`PRAGMA table_list`. This limits application exposure but does not patch the
SQLite engine embedded in Bun. The image runtime gate must verify Bun 1.4.5 and
SQLite 3.54.1. Protected-main Docker candidate run 44982611327 verified that
engine version and attested the archive for its exact source. This is an
engine-level fix in the candidate image, not a production deployment. CI
provenance for an image does not show that production runs it; production
acceptance requires a separate authorized deployment and runtime check.

## Dependency audit

For a local audit, run `mise exec -- bun run security:audit` so it uses the
repository-pinned Bun 1.4.5. The command uses Bun audit and fails on any
advisory outside the two reviewed exceptions in
[dependency-audit-exceptions.md](dependency-audit-exceptions.md). CI runs the
same command on pull requests, main pushes, and weekly schedule. The audit job
does not receive application data or secrets.

## Scope limits, exception governance, and incident handling

The application does not encrypt the live SQLite database and does not use JWT
or localStorage authentication. Backup artifacts use a separate encrypted
envelope. The protected operational database is never used by tests or
security checks. Changes to these boundaries require a separate security and
architecture review.

### Policy scope separation

Distinguish clearly between:

- **Mandatory application deployment requirements:** Active SQLite/attachment storage on LUKS2-encrypted storage, UID/GID `1000:1000` (`0700`/`0600`) OS isolation, cookie/origin/CORS controls, and AES-256-GCM encrypted backups (`BACKUP_ENCRYPTION_KEY != AUTH_COOKIE_SECRET`).
- **Established infrastructure prerequisites:** Valid LUKS header/recovery custody and isolated `docker-compose.yml` / Tailscale Serve loopback bindings.
- **Recommended host-security hardening (separate from application releases):** Removing unattended boot LUKS unlock keyscripts (`passdev`/keyfiles), modifying `/etc/crypttab`/GRUB/initramfs, historical disk sanitization, unrelated container credential rotation, and host reboots. Do not expand an ordinary application deployment into host hardening without a confirmed dependency and explicit owner authorization.

### Encrypted-storage and residual-risk clarifications

- Encrypted active storage (`dm_crypt-0` LUKS2) paired with an unattended on-disk unlock keyfile (`passdev`) does **not** protect against whole-server physical disk possession; interactive passphrase-only boot unlock requires separately authorized LUKS remediation.
- Encrypted backup artifacts do **not** establish encryption at rest of the live SQLite database.
- Moving legacy data to a `0700` quarantine directory does **not** eliminate physical-media exposure of historical unencrypted partitions.
- Deleting individual files does **not** establish physical-media sanitization.

### Security exception governance

1. Only the explicit system owner may authorize a temporary security exception.
2. Any permitted exception MUST remain narrowly scoped to active LUKS2-backed runtime storage with OS `0600`/`0700` isolation and verified interactive recovery credentials intact.
3. Exceptions MUST document exact scope, remaining physical/residual risks, and review conditions (such as a post-deploy hardening window), and MUST NOT silently convert a temporary operational exception (such as the S56 deferred-hardening exception) into permanent default policy.

### Credential exposure incident handling

Never place encryption keys, session secrets, personal records, or private document contents in commands, logs, chat messages, or reports. Record key identifiers (`key_id`), artifact filenames, and SHA-256 checksums instead. If an active credential is accidentally exposed, treat it as a targeted secret rotation incident under [the rotation runbook](../runbooks/secret-rotation.md) preserving `BACKUP_ENCRYPTION_PREVIOUS_KEYS` for historical backup recoverability, without triggering an unrelated infrastructure redesign.

The previously recorded backup-encryption-key exposure concern remains deferred
by the owner. The current key configuration is retained; this deferral does not
resolve or reduce the concern. No key material belongs in this document.
