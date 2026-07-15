# OperatorOS Desktop Process Lifecycle Contract

- Status: **Frozen for Phase 11.1B–11.1D**
- Platform: Windows 11 x64
- Last reviewed: 2026-07-15

## Ownership invariant

Exactly one Tauri process owns exactly one sidecar process tree and one canonical data root. Tauri holds the desktop single-instance primitive and a Windows Job Object configured to terminate descendants when its final handle closes. The sidecar also holds an atomic data-root lock before migrations or service startup. Port collision alone is never the ownership mechanism.

## State machine

| State | Meaning | Allowed next states |
|---|---|---|
| `STOPPED` | No owned sidecar exists and resources are released | `STARTING` |
| `STARTING` | Resources are resolving, directories/config are preparing, child is starting, or readiness is pending | `READY`, `FAILED`, `STOPPING` |
| `READY` | Verified sidecar is healthy and the frontend may be shown | `STOPPING`, `CRASHED` |
| `FAILED` | Startup did not reach readiness; no usable frontend is opened | `STARTING` after explicit Retry, `STOPPING`, `STOPPED` |
| `STOPPING` | New launches are blocked and graceful/forced cleanup is underway | `STOPPED` |
| `CRASHED` | A previously ready sidecar exited unexpectedly | `STARTING` after explicit Retry, `STOPPING`, `STOPPED` |

Only one transition executes at a time. Retry first proves that the prior process tree, port, and locks are released. There is no unbounded or silent automatic restart.

## Startup sequence

```text
OperatorOS starts
  -> acquire single-instance ownership
  -> resolve and validate packaged resources
  -> resolve canonical %LOCALAPPDATA%\OperatorOS paths
  -> prepare/protect runtime directories
  -> generate validated in-memory launch configuration and per-launch nonce
  -> select/reserve a dynamic 127.0.0.1 port
  -> create kill-on-close Windows Job Object
  -> launch operatoros-sidecar.exe in an owned process group
  -> assign the complete sidecar tree to the Job Object
  -> wait for verified GET /health readiness within a bounded timeout
  -> navigate/show the React frontend at the verified origin
```

Tauri must assign ownership early enough that no PyInstaller child can escape. If any step fails, it captures bounded/redacted diagnostics, terminates the owned tree, releases the port and handles, transitions to `FAILED`, and shows Retry, Open Logs, and Exit. The main application UI is not shown before `READY`.

The sidecar startup order is separately governed by `migration-contract.md`: it obtains the data lock, validates paths and secrets, validates/initializes/migrates the database, starts required services, then permits health readiness.

## Normal shutdown

```text
Frontend/window requests close
  -> Tauri enters STOPPING and prevents another launch
  -> request graceful sidecar termination
  -> FastAPI stops accepting new mutations and drains bounded active work
  -> FastAPI lifespan stops scheduler/services and disposes database resources
  -> sidecar exits
  -> Tauri verifies the process tree is gone
  -> release Job Object, port, locks, and runtime handles
  -> STOPPED and exit
```

Graceful shutdown has a documented bounded timeout. If it expires, Tauri terminates the Job Object/process tree and records that escalation. It must not kill during an atomic database replacement without recording a critical recovery diagnostic; restore coordination remains owned by FastAPI.

## Crash behavior

```text
OperatorOS/Tauri crashes
  -> Windows closes the Job Object handle
  -> the operating system terminates the sidecar and PyInstaller descendants
  -> OS file locks and port are released
  -> startup/sidecar logs retain the last bounded diagnostics
```

If only the sidecar crashes, Tauri transitions from `READY` to `CRASHED`, disables the application UI, captures exit/health evidence without secrets, and offers explicit Retry, Open Logs, or Exit. Retry verifies database integrity according to the migration contract before returning to `READY`.

## Second launch

A second OperatorOS launch must not start another sidecar. It focuses the existing window when safe; otherwise it exits with a user-visible diagnostic. A second sidecar pointed at the same canonical data root must fail before migrations, SQLAlchemy initialization, or scheduler startup, even when using another port.

## Diagnostic contract

Logs record timestamps, application/sidecar version, lifecycle transitions, process exit code, timeout class, port-bind class, migration result, and redacted stdout/stderr tails. They never record passwords, cookies, session/setup/auth secrets, nonce values, sensitive bodies, or database contents.
