# Desktop Sidecar Feasibility Report

## Executive summary

The OperatorOS backend is **technically suitable** for a Tauri-managed FastAPI sidecar, with PyInstaller as the provisional prototype packager. A native Windows executable successfully ran Uvicorn/FastAPI/SQLAlchemy, initialized and migrated SQLite, authenticated through Argon2 and cookie sessions, created/restored a verified backup, passed integrity checks, and shut down gracefully through CTRL_BREAK.

Phase 9.6 is **implemented but not closed** because the required clean no-Python Windows-machine test has not run. Nuitka did not complete within the bounded spike. The minimal Tauri v2 supervisor now implements Windows Job Object ownership, and the permanent packaged-sidecar contract proves parent-crash process-tree cleanup, database integrity, port release, restart, and simultaneous-instance rejection.

## Evidence

- PyInstaller build: 151.14 seconds; artifact 50,356,812 bytes; SHA-256 recorded in the comparison.
- First measured one-file readiness: 33.352 seconds.
- Health returned `{"status":"ok"}`.
- Fresh database contained identity, setup, operational, academic, report, scheduler, and audit tables; `PRAGMA integrity_check` returned `ok`.
- First-admin setup, login, `/api/auth/me`, manual backup, restore, and restore-required reauthentication succeeded.
- Tauri-free supervisor received readiness and CTRL_BREAK produced Uvicorn application shutdown completion with exit code 0.
- Occupied-port and invalid-secret startup attempts exited non-zero.
- A parent-only forced kill left the PyInstaller extracted child alive; explicit `taskkill /T` removed it. This proves Job Object/process-tree ownership is mandatory.
- No application data was written to Program Files, Desktop, or the repository during runtime validation.

The initially observed 8.37 MB value was the PyInstaller bootloader parent, not total process-tree memory, so it is deliberately not reported as runtime memory. Accurate tree-level peak working set remains part of the clean-VM run.

## Packaging decision

Use PyInstaller for the Phase 11 prototype because it alone completed and passed functional validation, its build feedback was far faster, and its maintenance model is simpler. First compare one-directory mode and import trimming because the one-file extraction/startup time is not acceptable as a final UX assumption.

## Confirmed architecture

```text
Tauri v2 supervisor -> loopback FastAPI sidecar -> app-data SQLite
```

FastAPI remains owner of auth, reports, backup/restore, scheduler, validation, and business logic. Tauri owns single instance, OS paths, child supervision, native dialogs, and recovery UI.

## Known limitations and open gates

- No clean Windows VM without Python has executed the artifact.
- The permanent Windows suite in `tests/desktop/` passed 9 contracts with no xfail on 2026-07-14; see `sidecar-lifecycle-contract.md`.
- No complete Excel/PDF report parity suite was run against the executable.
- One-file cold start was 33.352 seconds and needs optimization/one-directory comparison.
- Total/peak process-tree memory was not measured reliably.
- Nuitka did not produce an artifact and raised native filesystem/toolchain/runtime concerns.
- The original spike exposed an orphan when only the bootloader parent was killed. The Tauri supervisor now places the full sidecar tree in a kill-on-close Job Object; a parent-only forced-kill contract proves cleanup, port release, integrity, and restart.
- Code signing, installer, updater, SmartScreen/antivirus, and WebView2 were out of scope.

## Phase 11 gate status

| Gate | Status |
| --- | --- |
| Packaging approach selected | Provisional: PyInstaller |
| Backend executable works | Passed on build host |
| Clean no-Python machine | Blocked: environment unavailable |
| Python runtime not required | Expected from bundle, not independently proven |
| SQLite/migration lifecycle | Passed on disposable Windows paths; production versioning still required |
| Health/API/auth/backup/restore | Passed |
| Graceful lifecycle | Passed |
| Crash/orphan/single-instance lifecycle | Passed locally through Job Object parent-crash and canonical data-root lock contracts |
| Security boundaries | Documented |

Do not call Phase 9.6 fully complete or start production desktop packaging until the remaining clean-machine gate passes. Crash/process-tree, single-instance, port-release, integrity, and restart contracts already pass locally.
