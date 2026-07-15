# Frontend Runtime Audit

Audit date: 2026-07-14. Scope: production code under `frontend/src`. No runtime behavior changed.

| Area | Current usage | Class | Desktop impact | Phase 11 action |
| --- | --- | --- | --- | --- |
| React/DOM | Mounting, body classes, scrolling, timers/events, confirm, Chart.js canvas | A — safe | Supported by WebView | Smoke-test rendering, charts, dialogs, printing, and deep routes. |
| API | `fetch`, `AbortController`, `FormData`, `Blob`; shared client | A/B | APIs exist, but origin/cookies matter | Validate the chosen loopback origin and retain `credentials: include`. |
| Runtime config | `window.__APP_CONFIG__.apiBaseUrl`, then `VITE_API_BASE_URL`, then same-origin | B | Read during module evaluation | Inject before imports execute, or prefer same-origin with empty base URL. |
| Downloads | Blob/object URLs, temporary anchors, direct template download | B | No controlled native destination | Add a scoped native save flow; retain browser flow and revoke URLs. |
| Uploads | File input and `FormData` | B | Picker behavior/permissions need proof | Prototype without broad filesystem access; backend keeps validation. |
| Clipboard | `navigator.clipboard.writeText` for import errors | B | Permission and user gesture required | Allow write-only permission and preserve failure feedback. |
| Printing | `window.print` and `afterprint` | B | Platform behavior varies | Validate Windows printers/PDF; retain exported-PDF fallback. |
| Local storage | Non-secret `enteredBy` convenience value | B | Persistent, client-controlled | Keep only as a hint or move to backend preferences; never use as identity. |
| Session storage | Setup/restore login notices | A/B | Non-secret and transient | Test across sidecar restart and WebView reload. |
| Routing | `BrowserRouter` | B | Custom-protocol refresh may differ | Prefer loopback hosting or prove history fallback. |
| Cookies | No direct access; HttpOnly cookie via fetch | B | Correct boundary; cross-origin behavior unproven | Follow `authentication-model.md`. |

No production use was found for extension APIs, WebSockets, service workers, notifications, unsafe `eval`, third-party scripts, or remote CDNs. There is currently no Category C remediation. Phase 11 should fail builds that introduce remote scripts/styles, `eval`, extension APIs, or unrestricted navigation.

`window`, `document`, canvas, standard events, timers, `fetch`, `Blob`, and `FormData` are WebView-compatible and do not justify a rewrite. Phase 11 acceptance must cover Windows WebView2 login/session restore, upload, every export format, clipboard, printing, routing/refresh, and startup configuration order.
