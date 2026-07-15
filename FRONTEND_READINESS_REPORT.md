# Frontend Readiness Report

Audit date: 2026-07-15

## Verified stack and flow

- React `^19.0.0`, React DOM `^19.0.0`, React Router DOM `^7.1.1`, Vite `^6.4.3`, and TanStack Query `^5.101.2` are declared in `frontend/package.json`.
- `frontend/vite.config.js` builds to `frontend/build`, serves development on loopback port 5173, and proxies `/api` to `DEV_API_PROXY_TARGET` (default `http://127.0.0.1:8000`). That absolute URL is development proxy configuration, not browser application code.
- `frontend/src/lib/api/client.js` resolves the API base in this order: `window.__APP_CONFIG__.apiBaseUrl`, `VITE_API_BASE_URL`, then same-origin. It sends `credentials: "include"`.
- Authentication restoration is `GET /api/auth/me` through TanStack Query. `AuthProvider` derives identity from that response; it does not reconstruct identity from a browser token.
- `SetupBoundary` checks `/api/setup/status` before mounting the authenticated application.
- `RequireAuth` protects application routes; `RequireRole` protects backup administration.

## URL and browser-storage findings

Production application API wrappers use canonical `/api/...` paths through `apiRequest`; no direct hardcoded backend origin was found in runtime frontend source. Absolute localhost strings occur in tests/mocks and Vite development configuration.

No authentication token is stored in `localStorage` or `sessionStorage`. One `sessionStorage` key, `astryx:login-notice`, carries transient user-facing notice text and is removed on login-page mount. This does not violate the session-token boundary, but should be renamed during the broader product-name cleanup.

## Phase 11.1 gaps

| Gap | Severity | Reason |
|---|---:|---|
| Tauri does not populate `window.__APP_CONFIG__` | Blocker | The API client supports runtime injection, but no implementation supplies the dynamic sidecar port. |
| Cross-origin desktop cookie behavior is not acceptance-tested in the Tauri WebView | High | `credentials: include`, CORS origins, cookie host, and the chosen frontend origin must work as one tested contract. |
| `BrowserRouter` production deep-link behavior is not proven for the Tauri custom protocol | Medium | Refresh/navigation behavior needs packaged-app verification or an explicit route fallback. |
| Legacy `astryx:*` event/storage names remain | Low | Naming debt, not an authentication defect. |

## Verdict

Readiness: **80% — conditionally ready**. The frontend architecture should remain unchanged. Phase 11.1 needs a secure runtime endpoint handoff and packaged WebView validation, not a new API client or authentication model.
