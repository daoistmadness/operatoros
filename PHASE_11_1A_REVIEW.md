# Phase 11.1A — Desktop Runtime Contract Freeze Review

- Status: **Complete**
- Date: 2026-07-15
- Scope: documentation and architectural contracts only

## 1. Completed contracts

| Contract | Frozen outcome |
|---|---|
| `docs/desktop/runtime-contract.md` | Exact `%LOCALAPPDATA%\OperatorOS` filesystem, ownership, persistence, upgrade/uninstall/reinstall, and immutable-binary rules |
| `docs/desktop/sidecar-contract.md` | FastAPI/Tauri/React responsibilities, same-origin loopback topology, dynamic port, child identity, launch inputs, and versioned `/health` |
| `docs/desktop/process-lifecycle.md` | Single owner, Job Object/process-tree behavior, bounded startup/shutdown, recovery behavior, and six lifecycle states |
| `docs/desktop/security-boundary.md` | HttpOnly session boundary, password/setup rules, WebView/network restrictions, and prohibited desktop regressions |
| `docs/desktop/migration-contract.md` | Forward-only version ledger, backup classifications, safe startup flow, failure behavior, and downgrade prohibition |

## 2. Decisions frozen

1. Desktop v1 is Windows 11 x64, Tauri v2, WebView2, one PyInstaller FastAPI sidecar, and one local SQLite database.
2. The canonical data root is `%LOCALAPPDATA%\OperatorOS` with exactly `Data`, `Backups`, `Logs`, `Runtime`, and `Exports`; the database is `Data\operatoros.db`.
3. Installed binaries/resources are immutable. Mutable files never use the installation directory, working directory, or PyInstaller extraction directory.
4. The production desktop origin is same-origin loopback: FastAPI serves built React assets and `/api` at a dynamic `127.0.0.1` port.
5. Tauri owns process/resource lifecycle only. FastAPI retains database, migration, authentication, authorization, and all business logic.
6. The executable name is `operatoros-sidecar.exe`; it uses one worker, loopback only, no reload, and no fixed production port.
7. Readiness requires verified child identity plus `GET /health` returning HTTP 200 with `status: ok` and the matching application `version` after migrations/services are ready.
8. Process states are `STOPPED`, `STARTING`, `READY`, `FAILED`, `STOPPING`, and `CRASHED`; retries are explicit and bounded.
9. Tauri uses a kill-on-close Windows Job Object; the sidecar uses an independent canonical data-root lock.
10. Authentication remains opaque server-side sessions with `HttpOnly`, `SameSite=Lax` cookies and Argon2id passwords. No browser-storage token, Rust auth/database access, default credentials, or desktop bypass is permitted.
11. The persistent cookie secret lives at `Runtime\auth-cookie-secret`, is atomically generated and current-user protected, and survives restart/upgrade/uninstall by default.
12. Migrations are ordered, checksummed, monotonic, and forward-only. Destructive/rebuild/data-transforming changes require a verified pre-migration backup. Silent deletion, silent fallback, automatic restore, and automatic schema downgrade are forbidden.

## 3. Remaining assumptions

- FastAPI can securely serve the built React SPA and history-route fallback without altering browser/Docker behavior.
- The selected PyInstaller mode can bundle all Python dependencies, frontend assets, and the authoritative migration manifest with acceptable cold-start time.
- Windows Job Object assignment can cover the PyInstaller bootloader and descendants before any child escapes ownership.
- Current-user ACL creation for the data root and secret is reliable for supported Windows profiles.
- A setup-token delivery mechanism can protect first-admin provisioning without exposing the administrator password or moving authentication into Rust.
- Legacy `%LOCALAPPDATA%\Astryx` migration is a separate approved scope; Phase 11.1B must not silently migrate it.

Any failed assumption that would weaken authentication, migration safety, process ownership, or filesystem isolation reopens architectural review.

## 4. Risks before implementation

| Risk | Impact | Required control |
|---|---:|---|
| Incomplete inventory of current SQL/compatibility patches | Critical | Build the authoritative migration ledger and upgrade fixtures before release use. |
| Same-origin SPA serving changes web deployment behavior | High | Isolate desktop asset serving and keep canonical `/api` paths/browser modes unchanged. |
| Port reservation race or wrong-child health response | High | Socket inheritance or bounded retry plus private nonce verification. |
| Orphaned PyInstaller descendant | High | Early Job Object assignment and parent-crash contract testing. |
| Setup race from another same-user process | Critical | Trusted one-time token channel and transactional first-admin enforcement. |
| Secret/path ACL weakness | Critical | Fail closed on protection errors; scan logs/commands and test clean profiles. |
| Product rename strands or overwrites Astryx data | High | Separate backup-first, user-visible migration design. |
| Older binary opens newer database | High | Explicit minimum/maximum schema compatibility check and no downgrade. |

## 5. Phase 11.1B prerequisites

Before production sidecar coding is accepted:

1. Inventory every existing SQLite migration and `backend/src/core/database.py` compatibility patch into a proposed ordered schema ledger.
2. Select the desktop-only built-asset serving mechanism and SPA fallback while preserving browser/Docker startup.
3. Specify the private Tauri-to-sidecar launch nonce handshake and ensure it is neither an API credential nor renderer-visible.
4. Specify a trusted first-admin setup-token delivery channel that satisfies `security-boundary.md`.
5. Define the exact sidecar command/environment schema, redaction rules, log rotation, startup/shutdown timeouts, and exit codes.
6. Define the production PyInstaller spec inputs, dependency/resource manifest, version source, and clean Windows build environment.
7. Prepare fresh/current/historical/corrupt database fixtures and tests for the migration acceptance matrix.
8. Confirm how current-user ACLs and Job Objects will be implemented using pinned, reviewed dependencies or Windows APIs.

With these prerequisites addressed, Phase 11.1B may implement the production FastAPI sidecar without reopening the core architecture. Phase 11.1C then implements Tauri ownership, and Phase 11.1D validates the packaged runtime.

## Scope verification

Phase 11.1A created documentation only. It did not modify source code, runtime configuration, authentication, dependencies, migrations, installers, or build artifacts.
