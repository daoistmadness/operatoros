# S3.11B Windows Bun Tauri Acceptance

Result: PASS

- Source commit equality and clean worktrees verified before launch.
- Windows Bun 1.3.14 launched Tauri from the NTFS `frontend` workspace.
- WSL Bun 1.3.14 launched the managed backend/frontend session.
- Runtime ports: frontend 5174, backend 8002; Windows connectivity and `/health` passed.
- A debug-only, explicit-URL Tauri bridge opened the managed WSL frontend without bundling or starting the production sidecar. Release-mode sidecar behavior is unchanged.
- Native `operatoros-desktop.exe` compiled and opened successfully. Cargo emitted a non-blocking PDB filename-collision warning.
- Real-browser smoke passed: login, Dashboard, Academic & Student Management, Class Allocation, Student Enrollment, empty candidate/enrollment states, server online state, and Vite client presence.
- Browser console error inspection returned no errors.
- The standardized disposable E2E smoke independently verified populated academic hierarchy and candidate loading without enrollment-fingerprint mutation.
- Disposable Tauri development database ended with `student_enrollments = 0`.
- Normal `CloseMainWindow()` returned success; Tauri exited normally and the matching WSL session released ports 5174/8002.

An earlier diagnostic close used forced process termination and correctly produced a nonzero Cargo result; it is not counted as acceptance. The clean normal-close rerun is the PASS result.
