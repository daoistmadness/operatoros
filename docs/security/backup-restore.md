# Backup and Restore Security

This document describes the supported backup and restore paths for local, file-backed SQLite deployments. The authenticated API and the local CLI share the encrypted backup format but use different authorization and audit flows. PostgreSQL and container-backed database restore are not supported.

## Backup creation

Administrators use the canonical `/api/admin/backups` API, Backup Management page, or `backup-cli.ts backup`. Backup creation:

1. resolves the configured SQLite database to a canonical absolute path;
2. runs `PRAGMA wal_checkpoint(TRUNCATE)` and serializes the open database into a temporary snapshot;
3. runs `PRAGMA integrity_check`, `PRAGMA quick_check`, and `PRAGMA foreign_key_check`, and verifies required operational tables;
4. encrypts the snapshot with the configured AES-256-GCM backup key;
5. calculates SHA-256 over the final encrypted artifact;
6. writes protected metadata containing timestamp, trigger, size, checksum, schema version, source basename, encryption version, algorithm, key ID, and tool version;
7. publishes the encrypted artifact and writes metadata last, so incomplete pairs are not listed; and
8. applies count-based retention after the successful publication.

The connection layer sets `PRAGMA foreign_keys = ON` and does not configure WAL. A freshly bootstrapped database therefore uses SQLite's default rollback journal; an existing database may still be in WAL mode. Backup uses the checkpoint-then-serialize path, not the separate SQLite online-backup API. That path is supported only with the single API process described below.

Backup directories use mode `0700`; backup, metadata, and audit files use `0600`. The directory must not be web-served or inside the frontend. The live SQLite database remains unencrypted.

Before publishing a backup, API and CLI creation flush the encrypted artifact and
metadata files; after their atomic renames they flush both source and destination
directories.
On POSIX filesystems that honor `fsync`, this asks the operating system to make
both file contents and published names survive a crash or reboot. Restore also
flushes the verified candidate and both directories after cross-directory
renames, and flushes the validated restored database before writing the API
completion record. Retention directory changes are flushed after eviction.
Windows directory-entry flushing is unavailable through this Node filesystem
path, so Windows receives file-content flushes but no directory durability
claim. Retention deletion flushes are best-effort: a failure is audited, but the
new backup remains successful and older files may remain after a crash.
Filesystem and device behavior still governs the actual persistence; keep
encrypted copies off-host to recover from host or storage loss.

Backup Management downloads a recovery bundle containing the encrypted
artifact and its `.meta.json` sidecar. Keep both files together when moving a
backup off-host; restore validates their identity and checksum. The download
does not include encryption keys or decrypt the backup. Store and extract it in
a private location, then place both matching files in the configured backup
directory. The API and CLI restore paths only discover backups in that
directory. Use the normal API preflight and authorization flow or the CLI
restore flow after the pair is in place.

Retention keeps the newest 10 complete backup generations (`BACKUP_RETENTION_LIMIT`) after each successful API or CLI backup. The count covers manual, scheduled, and pre-restore snapshots. The newest generation and a backup selected as the restore source are never eviction candidates, so a directory can temporarily hold 11 generations while a restore source is protected; the next successful backup re-applies the limit. Incomplete artifact/metadata pairs are ignored, and a file that cannot be removed is skipped and audited. Each eviction writes a `backup_evicted` line to the operations audit; eviction failure never invalidates the newly published backup. Operators can still remove a specific backup through `DELETE /api/admin/backups/:filename`.

## Backup health status

`GET /api/admin/backups/status` checks destination accessibility and capacity,
artifact/metadata pair completeness, and the latest listed artifact's actual
file size, SHA-256, supported creation trigger, and encrypted-envelope metadata
consistency. A checksum is reported as `verified` only after reading and hashing
the current artifact.
Missing, empty, truncated, mismatched, or unreadable artifacts cannot produce
`HEALTHY`. Status reads do not write history or audit events.

SQLite integrity, quick-check, and foreign-key checks performed during creation
are historical evidence. Status does not decrypt or open the backup as SQLite; it reports
`latest_backup_integrity_status: "not_checked"`. `HEALTHY` describes the checks
above, not authenticated decryption, recoverability, or a restore rehearsal.
Restore preflight still performs decryption and database validation on demand.
API and CLI creation outcomes and retention events are appended to
`backup_operations_audit.jsonl`, outside the SQLite database so restore does not
rewind that history. `GET /api/admin/backups/history` returns the latest 200
creation outcomes. Status reports the latest outcome and recorded failure details;
missing or unreadable history leaves the outcome unknown, since a manifest alone
is not an execution record. Status reads do not write history or audit events.
Malformed records are skipped for history display; if the log's tail is malformed
or unterminated, status leaves its history-derived outcome and failure summaries
unknown rather than inferring them from an older event. Records larger than 1 MiB
are skipped so a damaged line cannot make the history reader accumulate unbounded
memory.
Older execution records without an explicit integrity result are returned with
unknown verification rather than inferred as verified.

Status hashes the complete current encrypted artifact on every request using
64 KiB reads. It parses the bounded envelope header and checks the serialized
ciphertext encoding while streaming; it does not decrypt the artifact or run
SQLite integrity checks. A local synthetic measurement on 2026-10-22 (Bun 1.4.3,
Intel i5-3470, Linux 7.0.0-38-generic) used synthetic base64 payloads and took
these median times over three authenticated status requests per size. The
measurement covers status validation, not AES-GCM decryption:

| Encrypted artifact | Full status request |
|---:|---:|
| 1.33 MB | 8.89 ms |
| 13.33 MB | 75.04 ms |
| 66.67 MB | 367.89 ms |

The verifier retains a 4 KiB header and one 64 KiB read buffer, independent of
artifact size. The benchmark process peaked at 192 MiB RSS while checking
artifacts through 66.67 MB, compared with 170 MiB in a separate 1.33 MB-only
run. Those values include Bun and API startup and run-to-run variation; they are
not memory limits or SLAs. Status still hashes every artifact byte on each
request, so latency grows with artifact size. Verification caching remains a
separate design decision.

API and CLI artifact encryption, decryption, and hashing use 64 KiB file chunks
while preserving the version-1 AES-256-GCM JSON envelope. Decrypted bytes go to
a private temporary file; restore validation and replacement start only after
the GCM tag and artifact checks succeed. SQLite snapshot serialization still
holds a database-sized buffer, so overall backup memory is not constant with
database size.

A synthetic CLI run on the same local machine used a 69.31 MB SQLite database
and its 92.42 MB encrypted artifact. `/usr/bin/time -v` measured these peak RSS
values before and after streaming file encryption/decryption; each operation
ran in a separate process against disposable data:

| Operation | Before | After |
|---|---:|---:|
| CLI backup | 538 MiB | 228 MiB |
| Full CLI restore, including its safety snapshot | 1,157 MiB | 253 MiB |

The measurements include Bun and SQLite startup, vary by machine, and are not
memory limits or SLAs. Backup preflight now reserves the plaintext snapshot,
the base64 envelope expansion, and bounded metadata/header space, with the
existing minimum floor for small databases.

Status precedence is restore in progress, backup in progress, destination
unavailable, incomplete pairs (`UNKNOWN`), no backup, failed artifact checks or
unknown capacity (`UNKNOWN`), low disk space, latest backup attempt failed, then
healthy. A missing destination
can remain available when its nearest existing ancestor is an accessible
directory where it can be created. Age is reported in seconds; status does not
apply aging/stale thresholds. Retention and restore eligibility are unchanged.

## Restore authorization and safeguards

Restore requires all of the following:

1. `ENABLE_DESTRUCTIVE_OPERATIONS=true`;
2. a validated `astyx_session`;
3. an active database user whose role is `admin`;
4. re-entry of the current password;
5. exact typed filename confirmation and the `RESTORE_DATABASE` phrase;
6. filename/path validation;
7. regular-file artifact/manifest, source identity, encrypted/plaintext size and hash, envelope metadata, and expected source/active checksum validation;
8. SQLite integrity, quick-check, foreign-key, required-table, and schema compatibility validation;
9. compatible `users` and `sessions` tables with required columns;
10. an active, unlocked administrator with an addressable username, a password hash accepted by the runtime, and a verified backup credential, or an empty database whose first-admin setup is still open;
11. a pre-restore safety snapshot;
12. isolated replacement with a rollback copy; and
13. post-replacement database reopen and restored-session revocation, followed by integrity/quick-check, foreign-key, administrator-state, and row-count inspection.

Preflight rejects a candidate without an active, currently unlocked `admin` account, an addressable username, or a password hash the runtime can parse, unless the database is empty and first-admin setup remains open. It cannot establish that an operator knows the password. Before the safety snapshot or replacement, API restore verifies either the current administrator credentials against the selected backup or the optional `candidate_admin_username` and `candidate_admin_password` supplied for one active backup administrator. It verifies that credential again after replacement; a mismatch rolls back. Credential values are excluded from logs and audit events. Open first-admin setup requires no backup credential.

CLI restore requires `--admin-user <username>` for a database with an existing administrator and prompts for that administrator's password without echo. `scripts/restore.sh` asks for the backup administrator username after confirmation and passes it to the CLI; leave the username blank only for an empty backup whose first-admin setup is still open. The CLI verifies the password before the safety snapshot and after replacement, revokes every session in the isolated candidate before replacement, and confirms no restored session remains active after replacement.

If no active backup administrator password is known, recover a controlled candidate copy before replacing the active database: use `backup-cli restore-disposable` into an existing empty directory whose resolved path is under the OS temporary root and outside the source data root (symlink escapes are refused), run the local `admin-recovery` CLI against that candidate root for an existing active administrator, create a new encrypted backup from the repaired candidate, then copy its artifact and metadata pair into the target backup directory. Complete the normal restore using that new administrator password. During preparation, this leaves the active database and original backup intact and creates a new encrypted generation. Do not use the recovery CLI against the protected legacy `attendance.db`.
The disposable restore command validates SQLite integrity, foreign keys, and the current physical schema before reporting the candidate as restored.

Legacy plaintext backups are refused unless `ALLOW_LEGACY_PLAINTEXT_BACKUPS=true`. Password recovery is performed on an isolated candidate copy; it is never silently applied by the API.

## Recovery objectives and limitations (P4-08)

These are planning objectives for the supported single-host, single-writer SQLite
runtime. They are not contractual SLAs and do not authorize a production deployment.

| Area | Current position |
|---|---|
| Recovery point objective (RPO) | No fixed guarantee. The maximum data-loss window is the interval between successful backups. An interval schedule targets its configured interval; a daily schedule targets at most 24 hours plus execution time. The scheduler is disabled by default, so the operator owns the cadence. |
| Recovery time objective (RTO) | No fixed guarantee. It depends on database size, disk speed, key availability, and operator action. The disposable-VM release-rollback drill (backup, upgrade, rollback, restore) completed in 146 seconds end to end on synthetic data; treat that only as a drill measurement. |
| Retention | Newest 10 complete generations; the newest backup and a restore source are protected; one audit line per eviction; manual deletion remains available. |
| Backup durability | Backups are written under the configured data root on the same host. Copy encrypted backups off-host to survive host or disk loss. |
| Verification | Every created API or CLI backup is checked for SQLite integrity, quick-check, foreign-key violations, required schema, and encryption; API restore preflight verifies checksum, integrity, quick-check, foreign keys, schema, identity columns, and an active, unlocked administrator with a runtime-parseable password hash or open first-admin setup. API restore verifies one backup administrator password before and after replacement. CLI restore verifies encrypted artifact identity/checksum/authentication, SQLite integrity, quick-check, foreign keys, schema, administrator/setup eligibility, and an unlocked administrator credential before and after replacement. Periodic restore rehearsal remains an operator responsibility. |

Limitations:

- **Single API process per data root.** Backup/restore also use process-local
  state, while the scheduler remains process-local. On Linux, the canonical API
  server and CLI share a data-root `flock`, so a second API or CLI operation
  fails closed. The lock does not coordinate tools that ignore it, and non-Linux
  API processes do not acquire it. Run one API process per SQLite data root;
  multi-worker restore is unsupported.
- **No point-in-time recovery.** There is no WAL archiving or incremental chain;
  the most recent successful backup is the recovery point.
- **No built-in off-host replication, object storage, or scheduled restore test.**
- **Key loss is unrecoverable.** Keep the active backup key and, during rotation,
  the previous keys. The backup key must differ from the cookie secret.
- **Retention is count-based, not time-based.** The scheduler's
  `keep_daily`/`keep_weekly`/`keep_monthly` fields are persisted but do not drive
  current eviction. Monitor capacity independently of backup age.
- **A protected restore source can exceed the visible limit.** The status count can
  read 11 while a restore source is protected; the next successful backup re-applies
  the limit.
- **Preflight cannot verify operator knowledge of credentials.** It verifies
  that an active unlocked administrator's hash is parseable by the runtime. API and CLI
  restore then require a password that matches an active, unlocked administrator in the
  selected backup. Use the isolated-candidate recovery procedure above when the
  backup password is unknown.
- **Some restore impact facts cannot be derived.** Preflight reports
  `source_is_older: null` because the active database has no authoritative
  content timestamp. `possible_data_loss` is `false` only when source and active
  database checksums match; otherwise it is `null` because table counts do not
  prove whether records were lost or replaced. The UI displays unknown values
  explicitly and warns that preflight is not a row-level difference report.
Counts for a missing or unreadable table and their deltas are also `null`; the
preview displays them as unknown and marks a backup with failed physical-schema,
integrity, quick-check, or foreign-key validation as ineligible before restore.
- **The live SQLite database is not encrypted at rest.** Only backup artifacts are.
  Protect host and filesystem access.
- **Audit rotation is operator-managed.** Losing an audit file does not invalidate
  backups, but it reduces traceability.
- **Schedules and filenames use UTC.** Account for local time when defining an RPO.

## Lifecycle

```mermaid
flowchart TD
  Request["Restore request"] --> Auth["Session and current-user admin authorization"]
  Auth --> Validate["Checksum, SQLite, foreign-key, schema, identity, and admin/setup checks"]
  Validate --> Snapshot["Pre-restore safety snapshot"]
  Snapshot --> Replace["Close database handle and replace SQLite file"]
  Replace --> Revoke["Revoke all restored sessions"]
  Revoke --> Verify["Integrity, quick-check, foreign-key, and row-count inspection"]
  Verify --> Login["Require browser reauthentication"]
  Verify -->|"failure"| Rollback["Restore safety copy and verify original"]
```

An API restore is reported complete only after the restored database reopens successfully, integrity and quick checks pass, no foreign-key violations are found, administrator/setup eligibility remains valid, the selected backup's administrator credential still verifies, and restored sessions are revoked. Preflight reports the actual foreign-key violation count; an unavailable check or any violation blocks restore. The response reports the measured post-restore foreign-key count and protected-table counts. Post-replacement failure enters rollback and emits a terminal audit event. The prior database file is not removed until the restore is committed. A failure before replacement reports `RESTORE_NOT_APPLIED`; unavailable operations-audit storage reports `RESTORE_AUDIT_UNAVAILABLE` with status 503. `RESTORE_ROLLED_BACK` is returned only after the prior database is restored and verified. If automatic rollback cannot be verified, the API responds with `RESTORE_ROLLBACK_FAILED`, leaves the surviving database and recovery files in the data root, and requires operator recovery before a retry; it does not delete the last on-disk copy.

The `backup-cli.ts restore` path verifies an encrypted artifact's manifest filename, source basename, creation timestamp, trigger, declared schema version, format version, algorithm, key ID, encrypted and plaintext byte sizes, encrypted SHA-256, plaintext SHA-256, and AES-256-GCM authentication. It compares the manifest schema version with the decrypted SQLite migration ledger, whose version order does not depend on wall-clock timestamps. The CLI validates SQLite integrity, quick-check, foreign keys, required tables, current schema, and administrator/setup eligibility before replacement and again after replacement. An active administrator must have `role='admin'`, `is_active=1`, an addressable username no longer than 255 characters, an unlocked account, and a password hash accepted by the runtime. The operator must also provide the matching username with `--admin-user` and its password through the hidden prompt. A database with no users remains eligible only while first-admin setup is incomplete. When an active database exists, the CLI validates the candidate credential before it creates the encrypted safety snapshot and uses the shared rollback transaction; post-replacement failure triggers rollback. Every session in the candidate is revoked before replacement and verified again after replacement; the source artifact remains unchanged. If rollback cannot be verified, the CLI preserves remaining recovery files and refuses another restore while a rollback file remains. A hard process or host interruption can leave the original database at that rollback path for operator recovery. Explicitly opted-in legacy plaintext receives the SQLite and credential checks but has no encrypted manifest, checksum, or authenticated-decryption evidence. Once a backup root is configured, the CLI attempts terminal restore audit records for path, artifact, manifest, decryption, candidate-validation, and swap failures; it writes a sanitized filename (or `unknown`) and a controlled reason category, with one operation ID shared across the operations and recovery-history logs. Audit writes are independent and best-effort; a missing backup root or unavailable audit storage can still prevent a record, and a failed post-commit audit does not undo the committed restore. Use the CLI only with all writers stopped and an approved recovery procedure.

A hard stop during API backup or restore, or CLI restore, can leave a plaintext
SQLite scratch file in the private data root. The next API startup or locked CLI
backup/restore operation removes recognized stale scratch files. If a rollback
database is pending, restore candidates remain for operator recovery. Cleanup
unlinks files but cannot guarantee secure erasure from the underlying storage.
The API no longer writes restore preflight plaintext under the shared OS temp
directory. Legacy `operatoros-backup-*` temp directories from earlier versions
are not auto-scanned because they cannot be safely attributed to one data root.

API preflight and restore execution refuse with `409 RESTORE_RECOVERY_PENDING`
while a rollback copy for the active database remains in the data root. The
refusal leaves active and recovery files unchanged and creates no safety backup.
Resolve the copy through an approved operator recovery procedure before retrying;
do not delete it merely to bypass the gate. CLI restore uses the same detection.

## Audit lifecycle

The canonical recovery-history audit is `backup_restore_audit.jsonl`. After administrator authorization, the API attempts to record `restore_requested`, then `restore_denied` for a refusal before replacement or `restore_started` immediately before replacement. A terminal event is `restore_completed`, `restore_rolled_back` only after verified rollback, or `restore_failed` when recovery is not confirmed. The CLI attempts the same lifecycle once its backup root is known. Records include one operation ID per attempt, target filename, authenticated username when verified, optional safety-snapshot filename, and a controlled reason code or error class; raw error messages, credentials, and paths are not recorded. CLI requests and refusals use no authenticated username; a username is recorded only after the selected backup's administrator credential has been validated. First-admin setup restores have no authenticated username. Unauthenticated and unauthorized HTTP requests are not written to this file. Lifecycle appends are best-effort, so missing or unwritable audit storage can leave gaps.

Before API replacement, the operations-audit path must be writable; if it is unavailable, restore stops before swapping databases and reports `RESTORE_AUDIT_UNAVAILABLE`. The canonical API completion record is the last fallible step inside the rollback-protected swap; if it cannot be written, the transaction rolls back. The operations-audit `restore_completed` line is written only after the swap commits, so a rolled-back attempt cannot claim completion there. That operations entry is best-effort after commit. CLI canonical and operations audit writes are best-effort after commit and do not undo a completed restore.

`GET /api/admin/backups/recovery-history` returns `{ entries, next_cursor }` with up to 200 valid lifecycle records per page. Each request scans at most 1 MiB of the active audit file and skips malformed lines. Administrators can page through older records without changing the append-only JSONL; operator-managed rotated archives are not combined. A cursor is bound to the active file and page boundary, and returns `409 RECOVERY_HISTORY_CURSOR_STALE` if the audit changes in a way that invalidates that position; refresh the history to start again.

## Concurrency and deployment restriction

Backup and restore use process-local operation locks. On Linux, the canonical API server also holds a nonblocking `flock` on the data root for its lifetime. CLI backup, restore, disposable restore, and migration commands acquire the same lock, so they refuse to run while that API server or another CLI operation holds it; a second canonical API process also fails at startup. The kernel releases the lock when its process exits. Data reset uses its own process-local guard and an immediate SQLite transaction. Run exactly one API process per SQLite data root; this lock does not coordinate tools that ignore it, and non-Linux API processes do not acquire this Linux lock.

CLI backup, restore, disposable restore, and migration commands also take a
nonblocking Linux `flock` in the data root. A second CLI operation on the same
root is refused before it can publish or replace data. The CLI requires
`flock` and `lsof` on `PATH`. The Linux API requires `flock` when using the
canonical data root; startup fails closed if the lock cannot be acquired.

The supported runtime is a single local API process. Docker/Compose and PostgreSQL are not supported runtimes; a multi-worker deployment is not a supported substitute. Do not claim multi-worker restore safety.

## Legacy scripts

`scripts/backup.sh` and `scripts/restore.sh`, where present, use the same
versioned encrypted backup envelope but remain separate operator tools. The CLI
restore path described above validates encrypted artifact identity, checksum,
authenticated decryption, SQLite state, and administrator/setup eligibility
before and after replacement. It creates a safety snapshot when an active
database exists, revokes restored sessions, and attempts rollback on failure.
Explicitly opted-in legacy plaintext lacks encrypted artifact verification.
The interactive restore menu orders same-second backup sequence suffixes
numerically, with the highest generated sequence first.
Use the CLI only with all writers stopped and an approved recovery procedure.
