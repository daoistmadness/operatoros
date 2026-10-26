# Tailscale HTTPS development

`./start-dev.sh --tailnet-origin` optionally serves the browser workflow over a
Tailscale HTTPS endpoint. Vite and the API bind to `127.0.0.1`; Tailscale Serve
terminates HTTPS and proxies to Vite. Vite proxies `/api`, `/health`, `/ready`,
and `/openapi` to the selected loopback API port.

Local development remains independent of Tailscale:

```bash
./start-dev.sh
```

## Configure a development endpoint

Inspect the node, all existing Serve routes, and Funnel state before selecting
ports:

```bash
systemctl is-active tailscaled
tailscale status
tailscale serve status --json
tailscale funnel status --json
ss -lntp
```

Use the exact DNS name for this node, ending in `.ts.net`. Select an HTTPS port
and frontend port for this development endpoint. Set `DEV_HTTPS_PORT` to the
administrator-selected HTTPS port only after verifying that it is unused.
Do not assume any example or previously inspected port is available.

Check the `TCP` and `Web` maps in both status responses. The chosen HTTPS port
must not appear as an existing Serve/Funnel listener, and the selected
`hostname:port` must not have an existing route or `AllowFunnel: true` entry.
Check the local frontend port with `ss -lntp` as well. If either status command
fails, returns invalid JSON, or leaves route ownership unclear, stop and ask the
Tailscale administrator to resolve it before proceeding.

First verify the selected local service ports without adding a Serve route:

```bash
export DEV_HTTPS_PORT='<administrator-selected-unused-https-port>'
export DEV_TAILNET_HOST='<this-node>.<tailnet>.ts.net'
export FRONTEND_PORT='<verified-free-local-vite-port>'
export BACKEND_PORT='<verified-free-local-api-port>'
./start-dev.sh
```

In another terminal, confirm the Vite proxy responds on loopback:

```bash
curl --fail "http://127.0.0.1:$FRONTEND_PORT/health"
```

Then stop the local stack with Ctrl+C. Re-read both Serve and Funnel status
immediately before configuring the route; there is no atomic compare-and-set
operation across separate Tailscale administrators. If the selected port
became occupied, choose another port and repeat the local check.

Create the development endpoint only after confirming that the chosen port is
still unclaimed:

```bash
tailscale serve --bg --https="$DEV_HTTPS_PORT" "http://127.0.0.1:$FRONTEND_PORT"
tailscale serve status --json
tailscale funnel status --json
```

Confirm that the new `hostname:port` route targets the selected loopback Vite
port and is not Funnel-enabled. Then start the managed stack with that exact
origin and the same selected service ports:

```bash
FRONTEND_PORT="$FRONTEND_PORT" BACKEND_PORT="$BACKEND_PORT" \
  ./start-dev.sh --tailnet-origin "https://$DEV_TAILNET_HOST:$DEV_HTTPS_PORT"
```

The launcher verifies the local node, the exact HTTPS route, its Vite target,
and the selected endpoint's background and foreground Funnel state before it
creates a session or starts services. A secondary worktree must use a Serve
route that targets its selected frontend port; the launcher stops if the
configured route differs. The launcher does not change or reset Tailscale
configuration.

To disable only the development route you created, first confirm that the
selected port and root path still belong to this endpoint, then use:

```bash
tailscale serve --bg --https="$DEV_HTTPS_PORT" off
```

Do not run that command against a route owned by another service. Do not use
`tailscale serve reset` or `tailscale funnel` for this development workflow.
Background Serve configuration persists after OperatorOS stops.

The Funnel check is a startup snapshot. It cannot prevent an administrator from
changing Serve or Funnel exposure after validation; inspect the status again
when exposure may have changed. Tailscale ACLs remain the access-control
boundary for private Serve routes.

## Authentication and HMR

Tailnet mode sets `COOKIE_SECURE=true`, an exact `ALLOWED_ORIGINS` value, and
the existing HttpOnly/SameSite cookie behavior. Cookie-authenticated
`POST`/`PUT`/`PATCH`/`DELETE` requests still require the exact Origin. It does
not add a trusted forwarded-IP source: `TRUSTED_PROXY_ADDRESSES` remains empty
in managed development. First-administrator setup remains loopback-only; use
the localhost URL for first-run setup, then sign in through the Tailnet URL.
Local mode uses insecure cookies and exact localhost origins for its selected
port.

Vite 8.3.4 is the checked-in version. It is configured with the exact node
hostname in `server.allowedHosts`; `server.ws` uses `wss`, the selected HTTPS
port, and the selected local frontend port. The API remains same-origin in the
browser; no frontend API base URL is set.

Configuration and local readiness are checked by the launcher. Remote browser
and React HMR were exercised through a temporary HTTPS route on Tailscale
1.104.2. The browser preview loaded the app, connected Vite WSS, and received a
CSS hot update. A direct HTTP/1.1 WebSocket handshake returned 101; an HTTP/2
RFC 8441 extended CONNECT failed, and the Serve endpoint did not advertise
`SETTINGS_ENABLE_CONNECT_PROTOCOL`. The preview does not expose the browser's
negotiated WebSocket transport, so clients that use HTTP/2 extended CONNECT
remain unverified. Tailscale tracks this open Serve issue:
[Tailscale issue #20882](https://github.com/tailscale/tailscale/issues/20882).
Ordinary HTTPS success does not prove WebSocket compatibility.
