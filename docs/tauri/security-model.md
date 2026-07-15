# Desktop Security Model

React/WebView is untrusted. FastAPI keeps authentication, role authorization, validation, destructive guards, audit trails, and constraints. Rust is a privileged supervisor with a small typed command surface and must reject arbitrary commands, URLs, arguments, or paths.

```text
Untrusted WebView -> authenticated /api -> FastAPI -> SQLite/files
                  -> narrow typed commands -> Tauri -> approved OS actions
```

- Bind only to `127.0.0.1` on an ephemeral port and verify no LAN exposure.
- Pin WebView navigation, CSP `connect-src`, and CORS to the exact origin; disable remote content/new-window navigation.
- Use a per-launch nonce for sidecar identity; health exposes no secrets.
- Loopback is accessible to other local processes, so sessions, setup tokens, CSRF/origin review, and OS-user isolation remain necessary. Tauri cannot defend a compromised user account.

Start with no WebView shell/process spawn, unrestricted filesystem, remote HTTP, clipboard-read, notification, or updater permission. Rust alone launches the allowlisted sidecar. Add only clipboard-write, scoped native open/save, and approved `https:` OS-browser opening if needed. Canonicalize every path and enforce operation-specific roots. CSP forbids remote scripts/styles and `unsafe-eval`.

Database, backups, audits, configuration, and logs use current-user-only ACLs. Logs rotate and redact passwords, cookies, secrets, credentials, and sensitive bodies. No password, API/session/setup secret, signing/encryption key, or database credential enters the frontend bundle.

Backups contain sensitive school data. Desktop v1 supplies OS ACLs, not encryption at rest; encryption requires a separate key-recovery/portability design. Release gates include pinned/audited dependencies, SBOM, bundled-resource scan, and future executable/installer signing.
