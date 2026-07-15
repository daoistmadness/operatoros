# Backend Communication Model

## Current flow

```text
React -> canonical /api/<domain>/... -> Vite or Nginx proxy -> FastAPI
```

The shared client uses `credentials: include` and resolves its base URL from runtime `window.__APP_CONFIG__.apiBaseUrl`, build-time `VITE_API_BASE_URL`, then same-origin. Feature wrappers do not hardcode a production host. Development defaults to `127.0.0.1:8000`; Docker uses same-origin Nginx proxying.

## Desktop decision

Retain FastAPI as a packaged sidecar. Rewriting authentication, reporting, backup, scheduling, validation, and business logic in Rust is rejected.

Prefer **same-origin loopback hosting**:

```text
Tauri -> FastAPI sidecar at 127.0.0.1:<ephemeral>
WebView -> http://127.0.0.1:<ephemeral>/ (React assets and /api)
FastAPI -> SQLite in OS application data
```

This avoids third-party-cookie/CORS ambiguity from a Tauri custom-origin page calling loopback. If assets cannot be served this way, a custom-origin prototype must prove the existing cookie contract; broad CORS or weaker cookies are not fallbacks.

## Startup and port discovery

1. Acquire Tauri single-instance and defense-in-depth data locks.
2. Resolve protected absolute data, backup, log, runtime, and resource paths.
3. Load/generate the persistent auth secret and a per-launch nonce.
4. Reserve an ephemeral loopback port and start one production sidecar worker bound only to `127.0.0.1`; never run `start-dev.sh` or `--reload`.
5. Poll bounded readiness and verify the nonce through a private handshake. Public `/health` alone does not prove child identity.
6. Open the exact loopback origin, then React checks setup status and `/api/auth/me`.

Port scanning and fixed public ports are prohibited. Close the reserve/bind race through socket inheritance or bounded retry plus nonce verification.

Tauri owns the child, captures rotated/redacted logs, detects crashes, and exposes recovery UI. Normal exit drains mutations and active jobs within a timeout, invokes FastAPI lifespan shutdown (which stops the scheduler), then terminates the process tree. Browser/Docker modes remain unchanged; desktop v1 is SQLite-only.
