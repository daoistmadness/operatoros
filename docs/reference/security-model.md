---
status: current
last_reviewed: 2026-10-28
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

## Dependency audit

For a local audit, run `mise exec -- bun run security:audit` so it uses the
repository-pinned Bun 1.4.4. The command uses Bun audit and fails on any
advisory outside the two reviewed exceptions in
[dependency-audit-exceptions.md](dependency-audit-exceptions.md). CI runs the
same command on pull requests, main pushes, and weekly schedule. The audit job
does not receive application data or secrets.

## Scope limits

The application does not encrypt the live SQLite database and does not use JWT
or localStorage authentication. Backup artifacts use a separate encrypted
envelope. The protected operational database is never used by tests or
security checks. Changes to these boundaries require a separate security and
architecture review.
