# Phase 11.1B — Production FastAPI Sidecar Implementation Report

- Date: 2026-07-15
- Status: **Implemented and independently runnable**
- Artifact: `dist/operatoros-sidecar.exe`
- Target: Windows 11 x64

## 1. Changes implemented

### Production runtime configuration

`backend/src/core/runtime.py` now resolves and validates the frozen desktop layout. Explicit `OPERATOROS_DATA_DIR`, `OPERATOROS_LOG_DIR`, and `OPERATOROS_RUNTIME_DIR` values take priority; the production fallback is `%LOCALAPPDATA%\OperatorOS`. It creates `Data`, `Backups`, `Logs`, `Runtime`, and `Exports`, resolves `Data\operatoros.db`, sets authoritative absolute backend environment values before application import, and persists the cookie secret at `Runtime\auth-cookie-secret`.

The runtime rejects relative paths, roots not named `OperatorOS`, path-role mismatches, invalid secrets, and non-directory collisions. A nonblocking OS-level `Runtime\sidecar.lock` prevents two sidecars/schedulers from owning the same data root.

### Production sidecar

`backend/src/sidecar_main.py` is the dedicated production entry point. It:

1. accepts a required dynamic port and loopback-only host;
2. resolves/prepares runtime paths and acquires the data-root lock;
3. configures rotating file and stderr logging;
4. applies the migration-owned identity and first-admin bootstrap resources;
5. imports and reuses the existing FastAPI app, routers, models, authentication, and services;
6. serves the packaged React build with SPA fallback in sidecar mode;
7. runs one Uvicorn worker without reload;
8. disposes the SQLAlchemy engine, releases the runtime lock, and flushes logging on orderly exit.

No authentication or business logic was duplicated.

### Health contract

`GET /health` now returns:

```json
{
  "status": "ok",
  "service": "operatoros-sidecar",
  "version": "<OPERATOROS_VERSION>"
}
```

It exposes no paths, credentials, database contents, or user information.

### Logging and shutdown

Rotating logs are written to `Logs\operatoros-sidecar.log` with five 5 MiB backups. Startup, runtime directories, migration result, Uvicorn lifecycle, fatal errors, and shutdown activity are recorded. Access logging is disabled to reduce sensitive request metadata. Passwords, cookies, session/setup secrets, and request bodies are not logged by the sidecar bootstrap.

The Windows verifier launches the executable in a new process group, sends `CTRL_BREAK_EVENT`, observes Uvicorn application shutdown, waits for process exit, and confirms the dynamic port is released. Phase 11.1C remains responsible for Job Object ownership and forced process-tree fallback.

### Reproducible Windows build and verification

`scripts/build-sidecar.ps1` creates a clean isolated Python 3.12 virtual environment under `%LOCALAPPDATA%\OperatorOSBuild\sidecar`, installs pinned application dependencies plus `pyinstaller==6.16.0`, packages migrations and frontend assets, builds locally, checks native exit codes, and copies only a successful `operatoros-sidecar.exe` to repository `dist`.

`scripts/verify-sidecar.ps1` copies the artifact outside the source tree and validates executable launch, dynamic health, all runtime directories, graceful shutdown, process exit, and port release.

## 2. Files modified or created

- `backend/src/core/runtime.py` — new runtime paths, persistent secret, environment handoff, and data-root lock.
- `backend/src/sidecar_main.py` — new production executable entry point.
- `backend/src/main.py` — expanded nonsensitive health response.
- `scripts/build-sidecar.ps1` — isolated pinned Windows build.
- `scripts/verify-sidecar.ps1` — executable-level Windows verification.
- `backend/tests/test_sidecar_runtime.py` — runtime, secret, lock, environment, and cleanup tests.
- `backend/tests/test_sidecar_health.py` — health contract test.
- `tests/desktop/conftest.py` — production artifact fixture.
- `tests/desktop/sidecar_harness.py` — OperatorOS runtime environment handoff.
- `tests/desktop/test_sidecar_lifecycle.py` — production path and health assertions.

No frontend source, authentication implementation, database model, router behavior, dependency version, or Tauri/Rust source was changed.

## 3. Build instructions

From Windows PowerShell at the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-sidecar.ps1
```

The build requires Python 3.12 and network/package-cache access only on the build machine. The resulting `dist\operatoros-sidecar.exe` bundles Python and application dependencies; the runtime machine does not require Python, pip, Node, or the source repository.

Verify it independently:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-sidecar.ps1
```

Tauri must later supply `OPERATOROS_VERSION` and the frozen absolute runtime paths plus a dynamic `--port`.

## 4. Test and build results

| Verification | Result |
|---|---|
| New sidecar unit/health tests after final lock change | **7 passed** |
| Full backend suite | **302 passed**, 4,250 existing deprecation warnings, 224.02 seconds |
| Windows PyInstaller 6.16.0 build | **Passed**; `dist\operatoros-sidecar.exe` produced |
| Executable verification | **Passed**; health, runtime tree, database/bootstrap, graceful shutdown, process exit, port release |
| Packaged lifecycle suite before lock fix | 6 passed, 2 failed; failures isolated to stale invalid-path text and missing data-root lock |
| Re-run of the two corrected packaged tests | **2 passed** in 66.84 seconds |

The final lock change is isolated to the new runtime module and is covered by the 7 passing focused tests and the two passing packaged tests. No orphaned `operatoros-sidecar` process remained after final verification.

## 5. Security regression check

- Authentication remains React/WebView → HttpOnly `SameSite=Lax` cookie → FastAPI session → database.
- No localStorage or sessionStorage authentication token was introduced.
- No Rust authentication/database code or desktop bypass was introduced.
- The existing Argon2id password layer and server-side session implementation were unchanged.
- The cookie secret is generated outside binaries, stored outside the install directory, not printed, and persists across restart.
- The sidecar binds only to `127.0.0.1`, uses one worker, and rejects alternate host arguments.
- A second sidecar against the same data root fails before migrations/application initialization.

## 6. Known limitations

1. The sidecar safely bootstraps the migration-owned identity and first-admin schemas and then uses existing `init_db()` behavior. The complete authoritative, checksummed, monotonic ledger for every historical SQLite migration required by `migration-contract.md` is not yet implemented. Historical in-place desktop upgrades must remain blocked until that inventory, fixtures, pre-migration backup classifications, and version compatibility checks exist.
2. The cookie secret receives exclusive-create and current-user filesystem protection intent. Clean-profile Windows ACL inheritance still requires Phase 11.1D certification.
3. The artifact is unsigned and has no installer, SBOM, or antivirus/SmartScreen acceptance evidence.
4. PyInstaller warnings for optional `jinja2`, `pysqlite2`, `MySQLdb`, and `psycopg2` were emitted. These are not used by the verified SQLite desktop runtime, but the warning manifest should remain a release review input.
5. The build currently installs the combined backend requirements, including test-only packages. Separating runtime/build requirements can reduce artifact/build size after dependency-boundary review.
6. Job Object ownership, private launch nonce verification, single desktop-instance focus behavior, and recovery UI belong to Phase 11.1C.
7. Legacy `%LOCALAPPDATA%\Astryx` migration remains intentionally unimplemented.

## 7. Readiness for Phase 11.1C

The sidecar is ready for Phase 11.1C process-manager integration as an independently built, loopback-only executable with dynamic-port startup, contracted health, canonical runtime paths, persistent authentication state, data-root locking, packaged frontend/API serving, and graceful console shutdown.

Phase 11.1C must add Tauri resource resolution, per-launch nonce verification, Windows Job Object ownership, bounded readiness, normal/forced shutdown escalation, immutable origin navigation, and crash recovery without moving authentication or database logic into Rust.

Phase 11.1D release approval remains blocked on the full historical migration ledger/upgrade matrix, clean Windows profile ACL validation, signing/installer work, and complete packaged lifecycle/security acceptance.
