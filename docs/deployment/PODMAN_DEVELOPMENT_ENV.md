# Containerized development environment

Native `mise run dev`, `dev:api`, and `dev:web` remain independent of Podman.
This document describes the optional development image consumed by the
infrastructure-owned rootless Quadlet services.

The API process uses these non-secret values from its Quadlet unit:

| Variable | Purpose |
| --- | --- |
| `HOST` | API bind address; container service uses `0.0.0.0`. |
| `PORT` | API port; container service uses `8090`. |
| `NODE_ENV` | Development runtime mode. |
| `OPERATOROS_DATA_DIR` | Explicit data root mounted by infrastructure. |
| `ALLOWED_ORIGINS` | Exact browser origin allowed for cookie-authenticated requests. |
| `COOKIE_SECURE` | `true` when accessed through the HTTPS Tailscale endpoint. |
| `ENABLE_DESTRUCTIVE_OPERATIONS` | Kept `false` for this development service. |
| `OPERATOROS_DEV_BOOTSTRAP` | Must remain unset for persistent data; only disposable smoke roots set it to `true`. |

The required external `api.env` file provides `AUTH_COOKIE_SECRET`, a secret of
at least 32 characters. `ASTRYX_SETUP_TOKEN` is optional; configure it when
the remote setup endpoint must require a token. These values stay outside both
repositories and image layers.

The existing
`/home/mikhailryu/.config/operatoros-dev/backup-encryption.env` reference is
preserved. It provides `BACKUP_ENCRYPTION_KEY` and
`BACKUP_ENCRYPTION_KEY_ID`; the backup key must differ from
`AUTH_COOKIE_SECRET`. Optional `BACKUP_ENCRYPTION_PREVIOUS_KEYS` supports key
rotation. Do not copy either secret file into a checkout or container image.

The Vite process receives `FRONTEND_HOST`, `FRONTEND_PORT`, `BACKEND_PORT`,
`DEV_API_PROXY_TARGET`, `VITE_HMR_HOST`, `VITE_HMR_PROTOCOL`,
`VITE_HMR_CLIENT_PORT`, and `OPERATOROS_DISABLE_ENV_FILES` from its Quadlet
unit. For the current endpoint, the approved values are loopback publication
on host port `5173`, HMR host `oprserver.taile856.ts.net`, protocol `wss`, and
client port `8444`. Vite's exact allowed-host list remains enforced by
`apps/web/vite.config.js`.

The development-only image target installs the locked dependencies with Bun's
hoisted linker so the API and Vite can share one root `node_modules` volume.
Its versioned dependency marker forces that volume to refresh if the layout
changes. Production image installs and runtimes are unchanged.

`DATABASE_URL` and `DATABASE_PATH` are intentionally not set. The API resolves
its SQLite files from `OPERATOROS_DATA_DIR`. Startup validates an existing
database but does not apply schema migrations. A missing database fails closed
unless `OPERATOROS_DEV_BOOTSTRAP=true` is explicitly set for a disposable data
root. Persistent host services never set this bootstrap flag. Verification uses
a separate disposable S4.8-compatible root.
