# OperatorOS Desktop Security Boundary

- Status: **Frozen for Phase 11.1B–11.1D**
- Last reviewed: 2026-07-15

## Trust model

```text
Untrusted React/WebView
  -> authenticated HTTP request with browser-managed HttpOnly cookie
      -> FastAPI validates session and authorizes action
          -> SQLAlchemy accesses the OperatorOS database

Privileged Tauri supervisor
  -> owns only resources, process lifecycle, approved navigation, and diagnostics
```

Loopback is transport isolation, not authorization. Other processes running as the same Windows user may reach `127.0.0.1`; every protected FastAPI endpoint remains authenticated and role-authorized.

## Allowed responsibilities

React may submit credentials to FastAPI login/setup forms, make authenticated API requests, render authorization outcomes, and request logout. FastAPI alone validates credentials and sessions, enforces roles and destructive-action guards, hashes passwords, provisions the first administrator, and records security audit events. Tauri may launch the allowlisted sidecar, protect runtime paths, verify child identity/readiness, and constrain WebView navigation.

## Forbidden designs

- authentication or refresh tokens in `localStorage` or `sessionStorage`;
- JavaScript-readable session cookies;
- bearer-token replacement for the desktop build;
- Rust authentication, authorization, password hashing, session validation, database access, or administrator creation;
- a desktop-only authentication bypass or unauthenticated privileged endpoint;
- default administrator username/password or passwords in configuration files;
- passwords, cookie values, session tokens, setup/auth secrets, or database credentials in logs, command-line arguments, frontend bundles, or generic Tauri IPC;
- wildcard credentialed CORS, arbitrary remote navigation, or weakening `SameSite` to make integration pass.

The existing `sessionStorage` login notice may hold display text only; it must never carry credentials, tokens, or authorization state.

## Session contract

FastAPI generates a cryptographically random opaque token on successful login. Only its keyed digest is stored in the database. The browser receives it only through a cookie with:

- `HttpOnly=true`;
- `SameSite=Lax`;
- path `/`;
- a bounded `Max-Age`/expiry matching the absolute server-side session limit;
- no JavaScript access;
- `Secure=false` only for the approved loopback HTTP desktop origin; `Secure=true` for HTTPS deployments.

The WebView uses `credentials: include`. Identity restoration is `GET /api/auth/me`; frontend memory/query state is not an authentication authority. Server-side idle and absolute expiry remain enforced. Logout revokes the database session and deletes the cookie. Restore and cookie-secret rotation revoke sessions and require reauthentication. Session continuity across an application restart depends on the persistent database and cookie secret, not browser storage tokens.

## Password contract

Passwords travel only in request bodies from the approved login/setup UI to FastAPI. FastAPI hashes them with Argon2id and stores only password hashes. Existing password policy, generic login failures, dummy-hash behavior, account lockout, and audit controls remain. Passwords are never passed to or inspected by Rust and are cleared from UI state promptly after submission.

## First-admin provisioning

There are no default credentials. First-admin creation remains the existing one-time, transactional FastAPI operation. Production desktop setup must use a cryptographically random, per-install setup token delivered through a trusted native-to-sidecar channel that is not exposed in URLs, logs, browser storage, or command-line arguments. The token is removed or invalidated after successful provisioning. Competing local processes must not be able to win an unauthenticated provisioning race. A repeated provisioning request fails closed and cannot create a second administrator.

The precise trusted delivery mechanism is a Phase 11.1B implementation prerequisite; if it cannot satisfy these constraints without Rust learning the administrator password or implementing authentication, implementation stops for review.

## WebView and network controls

The production WebView loads only the verified same-origin loopback application. Navigation, new windows, CSP, and `connect-src` are pinned to packaged/verified content and the active origin; remote scripts and `unsafe-eval` are forbidden. The sidecar binds only to `127.0.0.1`. Public `/health` reveals no secret or sensitive state. A private per-launch nonce proves child identity to Tauri but grants no API authorization and is never sent to React.

## Files and diagnostics

Database, backups, logs, exports, locks, and the cookie secret follow `runtime-contract.md`. Current-user ACLs are the desktop v1 at-rest boundary; backups and exports remain sensitive school data. Logs and crash reports are redacted and never collect database/backup contents by default.

## Regression gates

Phase 11.1D must inspect browser storage/cookies, test login/session restoration/expiry/logout/restore invalidation, verify protected and role APIs, attempt first-admin races, scan logs and process command lines for secrets, prove loopback-only binding, and verify Rust has no database/authentication path.
