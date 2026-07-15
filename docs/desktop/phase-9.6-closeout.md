# Phase 9.6 Closeout

Status: **IMPLEMENTED BUT NOT CLOSED**.

## Decisions

- Architecture: Tauri v2 trusted supervisor -> Windows Job Object -> loopback FastAPI sidecar -> app-data SQLite.
- Packager: PyInstaller, provisionally selected from the completed feasibility comparison.
- Ownership: Tauri holds a kill-on-close Job Object for the full session; the sidecar holds an atomic canonical data-root lock.
- Lifecycle: bounded readiness and graceful shutdown, deterministic job termination fallback, no uncontrolled restart loop.

## Automated evidence

The permanent suite under `tests/desktop/` covers packaged startup, readiness, configuration rejection, migrations, authentication, backup/restore, graceful shutdown, forced crash recovery, data-root single instance, and Tauri-parent Job Object termination/restart. The final 2026-07-14 acceptance run passed **9 tests in 300.52 seconds**, with no xfail. The run force-killed the Tauri parent, observed Job Object cleanup and port release, checked SQLite integrity, and restarted on the same data root.

## External acceptance

Clean no-Python Windows validation is **not executed** because a suitable VM is unavailable. Follow `clean-windows-validation-runbook.md`. This missing external result prevents official Phase 9.6 closure.

## Remaining limitations

- Clean Windows 10/11 evidence without developer tools.
- Release-mode artifact layout and cold-start optimization.
- Installer, signing, updater, and SmartScreen/antivirus validation remain out of scope.

## Phase 11.1 prerequisites

Before production sidecar integration continues, pass the clean-machine runbook, retain the complete Job Object contract evidence, select release artifact layout, and preserve the no-shell-command frontend boundary.
