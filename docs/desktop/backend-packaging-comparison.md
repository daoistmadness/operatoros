# Backend Packaging Comparison

Measurements are from the 2026-07-14 Windows x64 host in `windows-validation-environment.md`.

| Criterion | PyInstaller 6.21 | Nuitka 4.1.3 |
| --- | --- | --- |
| Result | One-file PE built and executed | Standalone compile not completed within the spike window |
| Build time | 151.14 s | More than 20 minutes; stopped during C compilation after Nuitka scalability warnings |
| Artifact size | 50,356,812 bytes (one file) | Not available |
| Cold readiness | 33.352 s on first measured one-file launch | Not available |
| Runtime validation | Health, schema, setup/login, backup, restore, integrity, graceful shutdown passed | Not available |
| Process model | One-file bootloader creates an extracted child; parent-only force kill orphaned it | Not available |
| Setup complexity | Python env plus spec/hooks | Python env, dependency analysis, downloaded Dependency Walker and MinGW, native compiler cache |
| Filesystem behavior | Built from WSL UNC source/output | UNC intermediate build failed (`ccache ... Permission denied`); native `C:\` output required |
| Portability warning | Clean no-Python VM still required | Also warned `msvcp140.dll` and `concrt140.dll` were not bundled without Visual Studio |
| Debugging/maintenance | Familiar spec file, fast feedback, readable warnings | Long optimization/C compile cycle and a substantially larger toolchain |

## Decision

Select **PyInstaller provisionally** for the Phase 11 sidecar prototype. It is the only candidate that produced a functioning executable and it offers materially faster, simpler developer feedback. The result is not a production approval: the 33-second one-file cold start is poor, so Phase 11 should compare PyInstaller one-directory mode and optimize imports before choosing the final artifact layout.

The Tauri supervisor must own the entire PyInstaller process tree through a Windows Job Object. Graceful CTRL_BREAK passed; a parent-only forced kill demonstrably left the extracted child alive until explicit tree cleanup.

Nuitka is not rejected permanently, but it is not currently evidence-backed. Reconsider only if a native Windows CI runner can complete reproducible builds, bundle/declare VC runtime requirements, and demonstrate a meaningful runtime or security benefit that offsets maintenance cost.

PyInstaller artifact SHA-256 from this run: `E4DE35FA5DE3EAE9A293E49898BC34220E7E1E2AB1E2E4E0995E3396D3103329`.
