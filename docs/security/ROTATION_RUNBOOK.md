# Secret rotation runbook

## `AUTH_COOKIE_SECRET`

1. Generate a new random value with the approved secret-management tool.
2. Store it in the deployment secret configuration.
3. Restart the API.
4. Verify health, login, session creation, and logout.
5. Expect existing opaque session cookies to stop validating. Operators must
   sign in again.

The current implementation has no dual-secret verification. Remove the old
secret from the deployment configuration after the restart is verified.

## `BACKUP_ENCRYPTION_KEY`

1. Generate exactly 32 random bytes and encode them as canonical Base64.
2. Assign a new `BACKUP_ENCRYPTION_KEY_ID`.
3. Set the new key as `BACKUP_ENCRYPTION_KEY`.
4. Add the old key to `BACKUP_ENCRYPTION_PREVIOUS_KEYS` while retained backups
   still need it.
5. Restart the API and create a disposable verification backup.
6. Restore that backup in a disposable data root.
7. Retire the old key only after all backups using its ID expire or are
   intentionally removed.

The system never re-encrypts existing operator backups automatically. A wrong
key or unknown key ID fails closed. Do not decrypt directly over the live
database. Legacy plaintext restore requires explicit opt-in and is never the
default.

## Trusted proxy and rate limits

Set `TRUSTED_PROXY_ADDRESSES` only to exact direct proxy IPs. Keep it empty for
direct local use. Tune login limits only through the server environment. Do
not expose these settings to the browser.
