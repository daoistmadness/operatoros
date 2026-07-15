# OperatorOS Desktop Release Candidate

## Version
`v0.11.1-rc1`

## Features
* **Tauri v2 desktop runtime:** A lightweight, secure WebView2-based shell for the desktop application.
* **FastAPI packaged sidecar:** High-performance local backend packaged via PyInstaller, managing business logic and analytics.
* **Offline-first operation:** Operates entirely locally with no external cloud dependencies, storing data in a local SQLite database (WAL mode).
* **Windows desktop lifecycle management:** Managed sidecar process lifetime tied directly to the frontend window via Job Objects and Instance Locks.
* **Secure session authentication:** Dynamic authentication cookie layer with cryptographically secure session storage.
* **Backup and restore foundation:** Integrated SQLite backup system supporting scheduled and manual operations.

## Known Limitations
* **Clean Windows acceptance still required:** Initial testing phase; requires smoke testing on clean Windows 11 targets.
* **Installer not yet finalized:** Current release is a standalone executable structure; NSIS/MSI installer bundles will be added in subsequent phases.
* **Code signing not yet completed:** The executables are unsigned and will trigger smart-screen warnings on first launch.
