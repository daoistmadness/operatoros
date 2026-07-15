# Windows Validation Environment

Validation date: 2026-07-14.

| Item | Observed |
| --- | --- |
| Host | Windows 10 Pro label, build 26200, x64 (Windows 11-family kernel reported by packaging tools) |
| Python | CPython 3.12.10 installed on the build/validation host |
| Node/npm | Node 24.13.1, npm 11.10.0 |
| Packaging tools | PyInstaller 6.21.0; Nuitka 4.1.3; downloaded MinGW GCC 15.2 for Nuitka |
| Rust/Cargo | Not installed; not required by this no-Tauri spike |
| Repository | Sources on a WSL UNC filesystem, builds invoked by Windows PowerShell |

The backend built and executed as a native Windows PE executable. SQLite data, migrations, health, authenticated API, backup, restore, and graceful CTRL_BREAK shutdown were validated outside WSL with disposable Windows paths.

## Limitations

- This was not a clean machine: Python is installed. The executable was launched directly, but absence of an accidental system-Python dependency is not yet proven on a no-Python VM.
- Node/frontend startup was not retested because Phase 9.6 changes no frontend and the executable feasibility is independent of Node.
- Rust and WebView2 were not evaluated; both belong to Phase 11/Tauri work.
- Code signing, installer, updater, antivirus reputation, and non-Windows targets were not tested.
- The source/build split matters: PyInstaller can consume this UNC tree, while Nuitka compiler intermediates must be placed on a native Windows filesystem.

## Clean-machine gate

Before Phase 11 implementation is approved, copy only the produced candidate artifact to a clean Windows 10/11 x64 VM with no Python or development environment. Re-run health, setup/login, report generation, Excel import/export, backup/restore/restart, and process-tree cleanup. Record installed VC runtime/WebView2 state and verify no repository or user Python path is accessed with Process Monitor.
