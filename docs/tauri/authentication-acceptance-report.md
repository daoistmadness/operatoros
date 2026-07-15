# Tauri Authentication Acceptance Report

## Environment

- Date: 2026-07-14
- Runtime: Windows Tauri v2 WebView2 development shell
- Tauri CLI: 2.11.4
- Tauri Rust crate: 2.11.5
- WebView2 Evergreen Runtime: 150.0.4078.65
- Frontend: OperatorOS 0.1.0, React 19, Vite 6.4.3, TanStack Query 5
- Backend: FastAPI application 0.9.0, Python 3.12
- Database: disposable SQLite database with the migration-owned identity and first-admin schemas
- Backend endpoint: disposable external instance on `127.0.0.1:18081`
- Frontend endpoint: Vite on `127.0.0.1:5173`, proxying `/api` to the disposable backend
- WebView profile: isolated disposable WebView2 user-data directory reused only for restart checks

No existing database, user account, credential, or normal WebView profile was used.

## Test Results

### First-run setup: PASS

- The setup screen rendered correctly in the Tauri WebView.
- Client validation rejected a password shorter than 12 characters.
- A disposable administrator was provisioned through `POST /api/setup/admin` with HTTP 201.
- Setup closed after exactly one administrator was created.
- The existing product contract redirects to normal sign-in after provisioning. Provisioning itself does not issue a session cookie; the subsequent login creates the session. This behavior was preserved because Phase 11.0.1 must not redesign authentication.

### Login: PASS

- Empty fields displayed the expected required-field messages.
- An incorrect password returned HTTP 401 and displayed the generic `Invalid username or password` message.
- The password input was cleared after the failed attempt.
- Correct credentials returned HTTP 200, populated the authenticated user state, and opened the dashboard.
- A direct WebView request to `/api/auth/me` returned the disposable administrator and role.

### Cookie persistence: PASS

- WebView2 stored one `astyx_session` cookie with `HttpOnly`, `Secure`, `SameSite=Lax`, domain `127.0.0.1`, and path `/`.
- The backend stored only the HMAC session digest; the raw cookie value was not written to the database.
- The Secure cookie was accepted and sent by WebView2 on the loopback development origin.
- No token or credential key appeared in local storage or session storage before setup, after login, after restart, or after logout.

### Restart: PASS

- The Tauri window closed normally without a forced kill.
- Reopening the shell with the same isolated WebView2 profile restored the authenticated dashboard without a login prompt.
- Bootstrap performed one `/api/auth/me` request and received HTTP 200; no duplicate authentication loop was observed.

### Window reload: PASS

- Reloading the React page retained the Secure HttpOnly cookie.
- The authenticated user and dashboard were restored.

### Logout: PASS

- Logout returned HTTP 204 and redirected to `/login`.
- The `astyx_session` cookie count became zero.
- The backend session was revoked.
- Authenticated UI state was removed, and direct navigation to a protected route redirected to `/login`.
- TanStack Query's auth entry was cleared through the existing logout mutation contract.

### Expired session: PASS

- The active disposable database session was manually expired.
- The next application bootstrap received exactly one HTTP 401 from `/api/auth/me`.
- No infinite retry loop occurred.
- Authenticated navigation and user details disappeared, and the login recovery path rendered.
- The backend marked the expired session unusable. The stale browser cookie remained until replacement or explicit logout, but it no longer authorized any request.

## Security Checks

| Check | Result | Evidence |
| --- | --- | --- |
| localStorage tokens | PASS | No keys before setup, after login, restart, expiry, or logout |
| sessionStorage tokens | PASS | No token or credential keys; the setup notice was transient and removed on login render |
| HttpOnly cookie | PASS | WebView2 cookie metadata reported `httpOnly: true` |
| Secure cookie | PASS | WebView2 cookie metadata reported `secure: true`; `/api/auth/me` returned 200 |
| SameSite policy | PASS | WebView2 cookie metadata reported `Lax` |
| Raw session storage | PASS | Backend session rows contain HMAC digests, not raw cookie values |
| 401 invalidation | PASS | One 401 cleared authenticated UI and exposed the login recovery path |
| Desktop auth bypass | PASS | No bypass, token store, Rust command, or desktop-only auth branch was introduced |

## TanStack Query Synchronization

- Login populated the existing `auth.me` query data and immediately rendered the user.
- Restart used `/api/auth/me` as the source of truth.
- Logout cleared the auth query and protected UI.
- The existing unauthorized event cleared auth data after the expired-session 401.
- Backend session state, WebView cookie state, and rendered React state remained consistent through the tested lifecycle.

## Screenshots

- Setup: `.artifacts/tauri/auth-acceptance-20260714T2020/screenshots/setup-screen.png`
- Login after provisioning: `.artifacts/tauri/auth-acceptance-20260714T2020/screenshots/login-screen.png`
- Authenticated dashboard: `.artifacts/tauri/auth-acceptance-20260714T2020/screenshots/dashboard-authenticated.png`
- Logout state: `.artifacts/tauri/auth-acceptance-20260714T2020/screenshots/logout-state.png`
- Expired-session recovery: `.artifacts/tauri/auth-acceptance-20260714T2020/screenshots/expired-session-login.png`

## Automated Coverage

Existing frontend coverage exercises auth bootstrap, login mutation state, logout invalidation, unauthorized-event handling, and protected route behavior. Existing backend coverage exercises cookie flags, session hashing, `/api/auth/me`, logout, expired and revoked sessions, first-admin setup, password policy, and audit behavior. No duplicate authentication implementation was added for this acceptance phase.

## Regression Verification

- Frontend tests: 21 files and 110 tests passed.
- Frontend production build: passed; 2,130 modules transformed.
- Backend tests: 296 passed.
- Windows Tauri development check: passed.
- Windows Tauri optimized custom-protocol build: passed.
- Rust formatting check: passed.
- Repository Markdown link check: passed.

The existing Vite large-chunk warning and Cargo PDB filename-collision warning remain non-failing and unchanged.

## Multiple-instance Behavior

Phase 11.0 registers no single-instance plugin or multiple-window guard. Multiple-instance protection remains deferred to Phase 11.1 as specified; no behavior was added in this phase.

## Known Limitations

- First-admin provisioning and login are deliberately separate operations in the existing product contract.
- The test used an external development backend and Vite proxy. Packaged-sidecar startup, runtime API injection, and packaged-origin acceptance remain Phase 11.1 work.
- The disposable WebView profile, database, credentials, session rows, and audit mirror were removed after verification; only screenshots were retained under ignored `.artifacts` evidence.

## Acceptance Decision

Phase 11.0 authentication lifecycle: **PASS**.

Phase 11.1 production sidecar integration: **READY TO BEGIN**.
