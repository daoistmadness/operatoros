# Authentication Model

Authentication correctly lives in FastAPI. Login generates a random token, stores only its HMAC digest, and returns `astyx_session` with `HttpOnly`, path `/`, `SameSite=Lax`, configurable `Secure`, and an absolute-timeout max age. Activity extends the idle expiry without exceeding the absolute expiry (defaults: six hours idle, 24 hours absolute). The frontend never reads the cookie, sends `credentials: include`, and restores identity with `/api/auth/me`. Logout revokes the database session and deletes the cookie. Restore revokes restored sessions and requires reauthentication. No auth token is stored in localStorage.

```text
Start sidecar -> verify readiness -> open approved origin
-> check setup -> GET /api/auth/me -> authenticated UI or Login
```

The frontend remains untrusted. Rust must not become an alternate authorization layer, and passwords/tokens must never cross generic IPC or enter logs.

The recommended topology loads React from the same `http://127.0.0.1:<port>` origin as FastAPI. This preserves host-only cookie behavior. `COOKIE_SECURE=false` is acceptable only for loopback HTTP bound exclusively to loopback with CSP/navigation pinned to the origin.

If assets use a Tauri custom origin, Phase 11 must prove on Windows WebView2: Set-Cookie acceptance, `SameSite=Lax`, credentialed fetch/CORS, login, idle/absolute expiry, dynamic-port restart, logout, restore invalidation, and WebView restart. Do not use localStorage tokens, wildcard origins, or weakened SameSite settings as fixes.

Generate a persistent auth secret of at least 32 characters and store it with current-user-only ACLs or an OS credential facility. Preserve it across upgrades and never expose it to React. Generate a one-time `ASTRYX_SETUP_TOKEN` and deliver it through a trusted first-run channel so another local process cannot race first-admin creation. Secret rotation must explicitly revoke every session.

Phase 11 tests cover login failures/lockout, roles, expiry, restart restore, logout, restore reauthentication, first-admin race protection, cookie attributes, and absence of secrets in browser storage/logs.
