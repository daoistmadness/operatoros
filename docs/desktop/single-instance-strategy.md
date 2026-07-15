# Single-Instance Strategy

Two desktop instances must never own two schedulers or independently manage the same SQLite file.

The prototype now implements two coordinated enforcement layers and retains the third as the production Tauri launch policy:

1. The trusted Tauri core holds the named `Local\AstryxDesktopSingleInstance` mutex for the desktop lifetime. A second prototype launch exits before starting a sidecar. Production may later add focus-forwarding without weakening rejection.
2. The packaged sidecar holds `<data-root>\runtime\sidecar.lock` before migrations and SQLAlchemy initialization. Failure is fatal and must not fall through to another database or port.

The lock identity is the canonical database path, not the port. SQLite WAL can coordinate ordinary connections, but it does not make two schedulers, restore controllers, or lifecycle owners safe. Do not rely on port collision as the single-instance mechanism because ports are ephemeral.

Stale locks require proof that the recorded process is absent and the lock can be acquired atomically; never delete a lock solely because of age. Update/rollback must stop and verify the old sidecar before launching another version against the data directory.

The permanent contract starts two packaged processes on different ports against the same canonical data root and requires the second to fail. OS file-lock release makes parent/job crash recovery safe without deleting a stale sentinel by age.

The one-file PyInstaller spike also proved that killing only the bootloader parent can leave the extracted API child alive. The minimal Tauri core now places the sidecar tree in a Windows Job Object configured for kill-on-close, attempts graceful CTRL_BREAK first, and terminates the job after a bounded wait. The parent-crash contract deliberately kills only the Tauri PID and verifies port release, database integrity, and restart.
