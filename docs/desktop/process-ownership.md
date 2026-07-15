# Desktop Process Ownership

## Boundary

The minimal Tauri v2 core under `frontend/src-tauri/` is the trusted owner of the packaged FastAPI sidecar. React receives no general process or shell API. Normal browser development remains `npm run dev`; the desktop prototype is `npm run tauri:dev`.

```text
OperatorOS Tauri core
  -> named desktop-instance mutex
  -> kill-on-close Windows Job Object
  -> AstryxBackend.exe process group
  -> PyInstaller descendants
```

## Startup

The core resolves the executable, `%LOCALAPPDATA%\Astryx` (or the explicit disposable test root), and a loopback port. It creates the desktop mutex, starts the executable with a new process group, assigns it to a Job Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, and polls `http://127.0.0.1:<port>/health` for at most 75 seconds. The webview is not created when readiness fails.

The sidecar separately takes one atomic lock at `<data-root>\runtime\sidecar.lock` before migrations or SQLAlchemy initialization. This canonical data-root lock rejects another scheduler/database owner even when it requests a different port.

## Lifecycle

Internal states are `STOPPED`, `STARTING`, `READY`, `FAILED`, `STOPPING`, and `CRASHED`. Startup is explicit and bounded. No automatic restart loop exists. A deliberate future retry may transition `CRASHED` to `STARTING`.

Failure evidence includes the exit code, bounded/redacted stdout and stderr tails, latest health result, and detected port-conflict status. Authentication and setup secrets are never emitted.

## Shutdown and crash

Normal close sends `CTRL_BREAK_EVENT` to the sidecar process group and waits at most 20 seconds. If it remains alive, the core terminates the Job Object. Closing the Tauri process—normally or by parent crash—closes the job handle, and Windows terminates every assigned descendant. The permanent Windows contract verifies parent-only forced termination, port release, SQLite integrity, and restart.

## Scope

This is a process-ownership prototype. Installer, signing, updater, native dialogs, and production packaging are intentionally absent.
