# OperatorOS FastAPI Sidecar Contract

- Status: **Frozen for Phase 11.1B–11.1D**
- Last reviewed: 2026-07-15

## Topology

```text
OperatorOS.exe
  -> trusted Tauri runtime
      -> managed operatoros-sidecar.exe
          -> FastAPI serves React assets and /api on 127.0.0.1:<dynamic-port>
              -> React uses the existing API client with HttpOnly cookie sessions
```

The production desktop topology is same-origin loopback: after readiness, the WebView navigates to the exact FastAPI origin, and FastAPI serves both the built React application and canonical `/api/<domain>/...` endpoints. This avoids a custom-protocol-to-loopback credential boundary. If implementation evidence shows this topology cannot be delivered safely, Phase 11.1 stops for architecture review; it must not fall back to browser tokens, wildcard CORS, or weakened cookies.

Browser/Vite and Docker deployments remain unchanged.

## Responsibility boundary

### FastAPI sidecar owns

- HTTP API and built frontend asset serving in desktop mode;
- database access, SQLAlchemy, migrations, and SQLite pragmas;
- authentication, sessions, password hashing, authorization, and first-admin provisioning;
- business rules, validation, reporting, imports, backups, restore, audit behavior, and scheduler services;
- `/health`, application version reporting, and orderly FastAPI lifespan shutdown;
- validation of all runtime paths and security-sensitive environment supplied at launch.

### Tauri owns

- single desktop-instance enforcement;
- immutable resource and sidecar executable resolution;
- canonical directory preparation;
- dynamic loopback port selection and sidecar launch configuration;
- Windows Job Object ownership, readiness monitoring, crash detection, and shutdown escalation;
- navigation of the WebView only to the verified runtime origin;
- bounded, redacted diagnostics and recovery UI.

Tauri does not access SQLite, implement authentication or authorization, inspect passwords/cookies/session tokens, apply database migrations, or reproduce business logic.

### React owns

- presentation, route guards, loading/error states, and authenticated API requests;
- setup and session bootstrap through canonical FastAPI APIs.

React does not launch processes, discover ports, read filesystem credentials, or decide whether backend authorization succeeds.

## Executable and launch contract

The production executable is named `operatoros-sidecar.exe`. It is installer-controlled and allowlisted by resolved resource path. It accepts only validated, documented arguments or environment values. It always uses one Uvicorn worker, never enables reload, and never accepts an arbitrary ASGI module.

Required launch inputs are absolute data/backup/log/runtime/export paths, loopback host, dynamic port, application version, and a per-launch identity nonce. Security-sensitive values must not appear in command-line arguments where other processes can inspect them. The sidecar binds only to IPv4 `127.0.0.1`; `0.0.0.0`, LAN addresses, and fixed production ports are forbidden.

## Port and identity contract

Tauri selects an ephemeral port dynamically for every launch. No production component assumes port 8000, 18080, or any other fixed port. Port scanning is prohibited.

The implementation must address the reserve-to-bind race through inherited socket ownership or bounded retry. Readiness is accepted only from the launched child and requires both the expected health response and verification of the per-launch nonce through a private launcher-side handshake. The nonce is not an authentication token and is never exposed to React.

The WebView receives the verified origin as native-owned immutable startup configuration by navigating to that origin. If a runtime configuration object remains necessary, only Tauri may create it before React executes, and its value must exactly match the verified loopback origin.

## Health contract

The public readiness endpoint is:

```http
GET /health
```

Success is HTTP 200 with JSON containing at least:

```json
{
  "status": "ok",
  "version": "x.x.x"
}
```

`status` is exactly `ok`. `version` is the packaged OperatorOS application version and must match the Tauri release version. The response contains no paths, secrets, nonce, database details, user data, or stack traces. HTTP 200 is returned only after path validation, database initialization/migrations, and required services are ready. Tauri uses a bounded timeout and treats child exit as a startup failure immediately.

The current backend health response lacks `version`; Phase 11.1B must add it without changing the endpoint path.

## Failure behavior

Startup failures are non-zero and diagnostic. The sidecar must not silently choose a different database, data root, port, secret, or migration path. After readiness, unexpected sidecar exit transitions Tauri to `CRASHED`; no automatic infinite restart loop is allowed.
