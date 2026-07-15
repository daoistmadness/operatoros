# Tauri development environment

OperatorOS Phase 11.0 targets a Windows Tauri v2 process. Run Tauri and Cargo from Windows, even when the repository is stored in WSL. The existing browser and backend commands may continue to run in WSL.

## Required tools

| Tool | Supported baseline | Audited on 2026-07-14 | Notes |
| --- | --- | --- | --- |
| Node.js | 22 LTS or newer | 24.13.1 | Installed through nvm-windows. Node 22 is the project baseline; Node 24 also passed the package workflow. |
| npm | Version supplied with Node | 11.10.0 | Existing `npm run dev`, `npm test`, and `npm run build` commands are unchanged. |
| Rust | Stable MSVC toolchain | rustc 1.97.0 | `stable-x86_64-pc-windows-msvc` is installed. |
| Cargo | Supplied by Rust | cargo 1.97.0 | Add `%USERPROFILE%\.cargo\bin` to `PATH` before running Tauri. |
| Tauri CLI | v2 | 2.11.4 in `frontend/package-lock.json` | Installed locally with `npm ci`; no global CLI is required. |
| WebView2 Runtime | Evergreen Runtime | 150.0.4078.65 | Found under `C:\Program Files (x86)\Microsoft\EdgeWebView\Application`. |
| Windows C++ tools | MSVC build tools and Windows SDK | Required by the Rust MSVC target | Install the Visual Studio Build Tools **Desktop development with C++** workload if linking fails. |

## Installation

1. Install Node 22 LTS with nvm-windows, or use a newer compatible Node release.
2. From `frontend`, run `npm ci`.
3. Install Rust with rustup and select the Windows MSVC toolchain:

   ```powershell
   rustup default stable-x86_64-pc-windows-msvc
   ```

4. Add Cargo to the current PowerShell session when it is not already on `PATH`:

   ```powershell
   $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
   ```

5. Install the WebView2 Evergreen Runtime if the application reports that WebView2 is unavailable.

Confirm the environment from PowerShell:

```powershell
node --version
npm --version
rustc --version
cargo --version
cd frontend
npm run tauri -- --version
```

## Known limitations

- The repository is on a WSL filesystem. Windows can build it through the `\\wsl.localhost\Ubuntu\...` path, but Windows-native storage is usually faster for Rust builds.
- Windows Cargo incremental lock files are not reliable on the audited UNC path. Set `$env:CARGO_INCREMENTAL = "0"` or set `CARGO_TARGET_DIR` to a Windows-native directory.
- Windows process creation cannot reliably launch the executable directly from the audited UNC path. Copy the generated executable to a Windows-native path for manual runtime checks.
- Rust was installed during the audit but its Cargo bin directory was not on the inherited PowerShell `PATH`; use the session command above or update the user `PATH` permanently.
- Phase 11.0 does not bundle FastAPI, create an installer, sign binaries, or add an updater.
- A production shell contains static frontend assets only. Live API and cookie validation in this phase uses `tauri dev` with the Vite proxy and a separately running FastAPI server.
