# Phase 11.1 — Production FastAPI Sidecar Integration Plan

Audit date: 2026-07-15

## 1. Current status

OperatorOS has a mature React/FastAPI application, server-side authentication, a health endpoint, configurable database/backup paths, a minimal Tauri v2 shell, an experimental PyInstaller entry point, and Windows-only lifecycle tests. It does not yet produce an installable Tauri application that owns a production FastAPI sidecar.

Overall Phase 11.1 readiness: **61%**.

| Area | Score |
|---|---:|
| Frontend | 80% |
| Backend | 70% |
| PyInstaller | 55% |
| Tauri | 35% |
| Security | 90% |
| Windows data lifecycle | 45% |

## 2. Blocking issues

1. No production `operatoros-sidecar.exe` build.
2. No complete, ordered desktop migration mechanism.
3. Tauri bundle disabled and no sidecar resource configured.
4. No Rust process owner, readiness state machine, shutdown escalation, or crash recovery UX.
5. No native-to-frontend runtime API URL injection.
6. No implemented `%LOCALAPPDATA%\OperatorOS` data/log/export contract.
7. No defined CSP for the packaged frontend and loopback API.
8. No end-to-end clean Windows 11 x64 release validation.

## 3. Required code changes

Preserve the architecture. Add a production Python bootstrap that configures absolute runtime paths, validates/applies approved SQLite migrations, configures logs, then starts one loopback Uvicorn worker. Package it with PyInstaller. Extend Rust only to own process lifecycle, runtime directory setup, endpoint handoff, and window startup/error state. Keep authentication and business logic in FastAPI.

## 4. File-by-file modification plan

| File/area | Planned change |
|---|---|
| New production sidecar entry under `backend/` or `desktop/` | OperatorOS data-root setup, persistent secret, complete migrations, loopback-only arguments, rotating logs, fail-closed startup. |
| New production `.spec` and PowerShell build script | Emit `operatoros-sidecar.exe`; include all approved migration/package resources; pin build tools. Leave `desktop-spike/` as historical evidence. |
| `backend/src/core/config.py` | Add only the minimum explicit runtime path/log settings needed; preserve environment-based configuration and PostgreSQL behavior. |
| Migration support near `backend/migrations/` | Define ordered schema versioning and transactional upgrade/rollback policy compatible with existing databases. Do not bypass `database.py` safety filters. |
| `frontend/src-tauri/Cargo.toml` | Add the minimum Tauri/process/single-instance dependencies or plugins required for internal supervision. |
| `frontend/src-tauri/tauri.conf.json` | Rename product metadata, activate Windows bundle, declare external sidecar/resource, icons, and a real CSP. |
| `frontend/src-tauri/src/lib.rs` plus focused modules | Resolve AppData, reserve/select endpoint, spawn sidecar in a Windows Job Object or equivalent owned tree, poll `/health`, inject immutable runtime config, show UI only after readiness, and terminate on exit. |
| `frontend/src/lib/api/client.js` | Retain current API abstraction; adjust only if the selected secure injection mechanism requires a small bootstrap hook. Do not hardcode localhost or add tokens. |
| `frontend/src/App.js` / bootstrap | Add a bounded backend-starting/failure experience only if native startup cannot delay window navigation. |
| `tests/desktop/` | Point fixtures at production artifacts; cover installer path, spaces/non-ASCII paths, upgrade, crash/orphan cleanup, occupied ports, secret persistence, auth, backup/restore, and second-instance behavior. |
| CI/release workflow | Build signed/checksummed Windows artifacts and run unit/contract gates; keep clean-machine validation as a release gate. |
| Documentation | Record data lifecycle, support logs, upgrade/uninstall/rollback, and renamed legacy-data migration. |

## 5. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Incomplete migration corrupts or strands a database | Medium | Critical | Versioned backups, integrity checks, transactional migrations, upgrade fixtures, fail closed. |
| Orphaned sidecar holds DB/port | Medium | High | OS-owned process tree, graceful timeout then forced tree termination, restart tests. |
| Cookie/CORS mismatch in WebView | Medium | High | One explicit origin contract and packaged auth E2E test; never fall back to bearer tokens. |
| Secret regenerated or exposed | Low/Medium | Critical | Persistent ACL-restricted file, atomic creation, redacted logs, restart/upgrade tests. |
| PyInstaller misses dynamic dependency/data | Medium | High | Clean offline Windows test matrix and artifact smoke tests. |
| Backup scheduler duplicates | Low if one instance enforced | High | Single-instance and data-root locks plus one backend worker. |
| Product rename loses legacy data | Medium | High | Explicit Astryx-to-OperatorOS discovery/migration with backup and rollback. |

## 6. Testing strategy

1. Keep backend and frontend unit suites green.
2. Add Python bootstrap tests for paths, migrations, secrets, logging, corrupt state, and loopback enforcement.
3. Build the real sidecar and run existing Windows lifecycle tests against it.
4. Add Rust tests for state transitions and Windows integration tests for process-tree ownership.
5. Run packaged Tauri E2E: first setup, login, `/api/auth/me` restoration, protected/role routes, import, reports, backup/restore, logout, restart, and shutdown.
6. Test fresh install and upgrades from representative legacy databases, including `%LOCALAPPDATA%\Astryx`.
7. Validate on a clean Windows 11 x64 VM without Python, Node, Rust, source files, or network access.
8. Inspect filesystem writes and confirm none occur beside the installed executable.

## 7. Rollback strategy

Before every application/schema upgrade, create and verify a database backup plus metadata. Keep the previous signed installer and sidecar artifact. If startup migration fails, do not launch the UI against a partially upgraded database; retain logs and restore the pre-upgrade snapshot through a documented recovery flow. Application downgrade is allowed only when its schema compatibility is explicitly verified. Product-name data migration must copy/verify first and leave the Astryx source untouched until OperatorOS completes multiple successful starts. Uninstall must preserve user data unless the user separately confirms destructive removal.

## Recommended execution order

1. Freeze the Windows data, secret, origin, migration, and process-ownership contracts.
2. Productionize and independently validate `operatoros-sidecar.exe`.
3. Implement Tauri supervision and immutable API endpoint handoff.
4. Activate/configure the Windows bundle and CSP.
5. Run packaged auth/data/backup lifecycle tests.
6. Complete clean-machine, upgrade, rollback, signing, and release acceptance.
