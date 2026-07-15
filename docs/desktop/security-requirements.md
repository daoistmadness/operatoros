# Sidecar Packaging Security Requirements

- Installation files and the packaged executable are read-only for ordinary use. Writable database, backup, audit, configuration, log, and runtime files live under `%LOCALAPPDATA%\Astryx` with current-user ACLs.
- No password, cookie, auth/setup secret, database credential, or encryption key is embedded in the executable/frontend/defaults. The spike creates the auth secret at runtime outside the binary; production should harden ACL creation or use an OS credential facility.
- Only the Tauri owner launches the allowlisted signed sidecar with validated arguments. The sidecar binds to `127.0.0.1`, uses one worker, and accepts no arbitrary module/app argument.
- FastAPI continues enforcing authentication, roles, validation, destructive-operation flags, exact restore confirmation, and audit logging. Process ownership is not authorization.
- Other processes in the same Windows user session can reach loopback and read that user's files. Phase 11 needs a startup nonce, protected first-admin token, origin/CSRF review, and a clear local-malware threat boundary.
- Backups contain school data and inherit the same sensitivity as the live database. User-selected exports require explicit native choice and must not broaden permanent filesystem scope.
- Logs rotate and redact secrets/cookies/credentials/sensitive bodies. Crash reports must not collect the database or backup content by default.
- Production release requires dependency/SBOM scanning, reproducible clean CI builds, code signing, artifact hashes, and clean-machine antivirus/SmartScreen evaluation.
