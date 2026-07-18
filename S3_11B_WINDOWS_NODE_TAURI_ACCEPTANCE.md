# S3.11B Windows Node Tauri Acceptance

Result: PASS

- Source commit equality and clean worktrees verified before launch.
- WSL runtime state recorded `javascript_runtime: node` and `javascript_runtime_version: 22.23.1`.
- Windows resolved genuine Node v22.23.1 at `C:\nvm4w\nodejs\node.exe` and npm at `C:\nvm4w\nodejs\npm.ps1`; Bun was not substituted.
- npm launched the same native Tauri debug shell and synchronized dev URL.
- Frontend 5174, backend 8002, and health checks passed.
- Native window opened successfully; the previously accepted UI/API path remained available.
- Disposable development database remained at `student_enrollments = 0`.
- Normal `CloseMainWindow()` succeeded; the matching WSL frontend/backend session stopped and released both ports.
