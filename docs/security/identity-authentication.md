# Identity and Authentication

OperatorOS is an offline-first local application with a **Minimal Identity Boundary Layer**. It is not an IAM platform and does not implement SSO, OAuth, LDAP, cloud identity, or an external identity provider.

## Trust architecture

```mermaid
flowchart TD
  Browser["Browser"] -->|"HttpOnly astyx_session cookie"| API["Elysia backend"]
  API --> Session["Validated database session"]
  Session --> User["Active database user"]
  User --> Role["Database role: admin or staff"]
  Role --> Protected["Protected operation"]
```

The active Elysia backend is the authorization authority. Frontend state is used only
to display identity, redirect anonymous users, and hide unavailable controls.
It cannot grant access.

Trusted authorization input is the validated session and its database user role. Request fields such as `request.role`, `reviewed_by`, `entered_by`, `uploaded_by`, and similar legacy attribution strings are untrusted metadata and are never authorization inputs.

## Users and passwords

The `users` table stores username, Argon2id password hash, role, active state, login-failure state, and timestamps. Plaintext passwords are not stored or logged. The password hashing service enforces a minimum length of 12 characters when a password is hashed.

Login deliberately returns the same `Invalid username or password` response for unknown users, incorrect passwords, inactive accounts, and locked accounts. Repeated failures increment the database counter and can temporarily lock the account.

## Sessions

Authentication uses opaque server-generated tokens. The browser receives the token only as a cookie; the database stores an HMAC-SHA256 digest rather than the raw token.

Cookie contract:

| Attribute | Value |
| --- | --- |
| Name | `astyx_session` |
| HttpOnly | enabled |
| SameSite | `Lax` |
| Path | `/` |
| Secure | controlled by `COOKIE_SECURE` |

Session lifecycle:

```text
create → validate → refresh idle expiry → expire/revoke → logout
```

Sessions have idle and absolute expiration limits. A logout request that reaches the route revokes the database session and clears the cookie. The browser clears its authenticated in-memory state and notifies other tabs only after the server confirms the logout. If the request is rejected or the network fails, the browser does not treat logout as confirmed: absent an authoritative `401`, it keeps the current authenticated state, sends no cross-tab notification, and shows a retryable failure because the server session may still be active. A later `401` remains authoritative and clears local state. API and CLI restore revoke restored sessions, so reauthentication is mandatory. CLI restore limitations are documented in [Backup and Restore Security](backup-restore.md).

No JWT, bearer-token storage, localStorage authentication, remember-me function, or frontend session-token access is implemented. Browser tabs keep authenticated query data in memory only. Login, logout, focus, and visibility changes trigger session revalidation; a different server session clears protected in-memory caches before its user is applied. Cross-tab notifications carry no credentials or user data, and the server session and database role remain authoritative.

## Authorization roles

- `admin`: backup management, restore, and destructive administrative operations.
- `staff`: authenticated normal application operations; administrative backup/restore routes return `403`.

Anonymous protected requests return `401`. Client-side role guards improve navigation but do not replace backend checks.

## Audit evidence

Authentication and authorization-denial events are written to `authentication_audit.jsonl` in the configured log directory. Restore writes `restore_completed` and `restore_failed` to the recovery-history and operations audit files; API restores record the authenticated username, while CLI restores record the OS user. See [Backup and Restore Security](backup-restore.md#audit-lifecycle). Audit records may contain a safe session digest and request context, but never raw cookies, tokens, passwords, password hashes, or `AUTH_COOKIE_SECRET`.

## Current limitations

OperatorOS does not implement MFA, SSO, OAuth, LDAP, password-reset email, cloud identity, granular permissions, or a user-management interface.
