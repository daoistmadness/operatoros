# Tauri development workflow

The browser workflow remains authoritative and unchanged. Tauri adds a Windows desktop shell around the same React application.

## Browser development

```bash
cd frontend
npm run dev
```

Vite serves the frontend at `http://127.0.0.1:5173` and proxies canonical `/api/*` requests to the independently running FastAPI server at `http://127.0.0.1:8000`.

## Desktop development

Start FastAPI using the existing project workflow. Then, from Windows PowerShell:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
cd frontend
npm run tauri:dev
```

Tauri starts `npm run dev`, waits for Vite, and opens the `main` WebView2 window. Do not start another Vite process on port 5173 before this command.

The desktop development path is:

```text
Tauri WebView2 -> Vite 127.0.0.1:5173 -> /api proxy -> FastAPI 127.0.0.1:8000
```

Because API requests remain same-origin at the frontend boundary, the existing `credentials: "include"` behavior and HttpOnly session cookie flow are unchanged in development.

## Verification

```powershell
cd frontend
npm test
npm run build
cd src-tauri
cargo check
cargo build
```

Build the desktop executable without producing an installer:

```powershell
cd frontend
npm run tauri -- build --no-bundle
```

The executable is generated under `frontend/src-tauri/target/release/`. The `target/` directory is ignored and must not be committed.

When validating without the Tauri CLI, include the production protocol feature explicitly:

```powershell
cargo build --release --features custom-protocol
```

Plain `cargo build --release` retains Tauri's development URL behavior and is not a production-shell acceptance check.

## Production asset integration

`tauri.conf.json` runs `npm run build` before a desktop build and embeds `frontend/build`. OperatorOS intentionally retains `build/` as its Vite output directory; changing it to the Vite default `dist/` would disrupt the existing Docker and browser workflow.

Phase 11.0 only proves the production React bundle can be embedded and rendered. It does not provide a packaged backend. API-dependent production-executable acceptance belongs to Phase 11.1, when the approved sidecar communication model is connected.
