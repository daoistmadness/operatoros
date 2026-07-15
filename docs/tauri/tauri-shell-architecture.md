# Tauri shell architecture

## Boundary

Phase 11.0 adds a native window, not a second application layer:

```text
React 19 + TanStack Query
          |
          v
existing frontend API client
          |
          v
FastAPI (separate development process)
```

The Rust crate contains only the Tauri application bootstrap. It exposes no commands, owns no database, starts no child process, and duplicates no backend behavior.

## Layout

The Tauri project lives at `frontend/src-tauri`, Tauri's conventional location relative to the frontend package. This keeps `npm run tauri:dev` additive while preserving all browser scripts.

- `frontend/src-tauri/src/main.rs` delegates to the library bootstrap.
- `frontend/src-tauri/src/lib.rs` creates and runs the Tauri application.
- `frontend/src-tauri/tauri.conf.json` connects Vite development and production assets.
- `frontend/src-tauri/capabilities/default.json` explicitly grants no frontend native permissions.
- `frontend/src-tauri/icons/icon.ico` is a placeholder until final branding work.

## Frontend integration

Development loads `http://127.0.0.1:5173`. Production embeds `frontend/build`. No Tauri detection branch was added to React, and the canonical `/api/<domain>/...` contract remains intact.

## Application metadata

- Product name and title: OperatorOS
- Identifier: `com.edelweiss.astrx`
- Version: `0.1.0`
- Default window: 1280 x 800
- Minimum window: 960 x 640
- Bundle/installers: disabled for Phase 11.0

## Deferred work

FastAPI sidecar supervision, PyInstaller, runtime API injection, desktop database ownership, installers, signing, updates, native dialogs, notifications, and tray behavior are explicitly deferred.
