# Security Regression Report

Audit date: 2026-07-15

## Preserved security boundary

The implemented web boundary is:

`React/WebView -> HttpOnly cookie -> FastAPI session validation -> database user/session records`

No Rust authentication logic or desktop password storage exists. No frontend authentication token was found in `localStorage` or `sessionStorage`.

## Verified controls

- Login sets the opaque session token as `HttpOnly`, `SameSite=Lax`, path `/`; `Secure` is environment-controlled.
- The frontend always uses `credentials: include`.
- Only an HMAC digest of each opaque token is stored in the database.
- Session idle and absolute expiry are enforced server-side; logout revokes the session and deletes the cookie.
- Authentication startup fails closed when the cookie secret is absent or shorter than 32 characters.
- Passwords use Argon2 via the backend security layer; login uses a dummy hash for unknown users and has account lockout controls.
- First-admin provisioning is transactional, one-time, optionally token-gated, audited, and rejects repeated setup.
- Protected backend endpoints depend on current-user/role checks; frontend guards are usability controls, not the authorization boundary.

## Findings

| Risk | Severity | Finding / Phase 11.1 control |
|---|---:|---|
| Dynamic loopback origin and cookies | High | Prove WebView origin, CORS allowlist, cookie domain/host, and SameSite behavior together. Do not weaken cookies or add bearer tokens. |
| Sidecar port exposure | High | Bind only to `127.0.0.1`; use a runtime-selected port and reject non-loopback host overrides. Local untrusted processes can still reach loopback, so all sensitive APIs must remain authenticated. |
| Runtime API URL injection | High | Treat the value as native-owned configuration; do not permit arbitrary remote origins or renderer-controlled mutation. |
| Persistent secret file | High | Store outside the install directory, apply restrictive Windows ACLs, never log it, and preserve it across upgrades. |
| CSP disabled | Medium | Replace `csp: null` with a policy compatible only with packaged assets and the selected loopback API endpoint. |
| Legacy product names | Low | Cookie name `astyx_session`, event names, setup variable, and spike paths remain. Rename with an explicit session/upgrade compatibility decision. |
| `sessionStorage` notice | Informational | `astryx:login-notice` contains display text, not credentials or a token. |

## Non-negotiable regression gates

No local/session-storage auth tokens; no desktop authentication bypass; no password or session token passed through Rust; no auth logic moved to Rust; no unauthenticated privileged loopback endpoint; and no generated-per-launch cookie secret.

## Verdict

Readiness: **90% — strong foundation with desktop-origin controls outstanding**.
