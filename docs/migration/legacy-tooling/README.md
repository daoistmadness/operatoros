# Archived one-shot tooling

[s43_migration.tar.gz](s43_migration.tar.gz) preserves the unchanged
historical S4.2→S4.3 migration wrapper previously stored at
`scripts/s43_migration.py` (and later as `s43_migration.py` in this
directory). It is evidence, not a supported current command, and is not part
of development, CI, or E2E gates. Its original imports and
repository-relative paths remain frozen; do not execute the archived copy.

The archive is deterministic (`tar` with fixed member metadata plus `gzip
-n`); extracting it reproduces the exact bytes below. Verify with:

```sh
tar -xzf docs/migration/legacy-tooling/s43_migration.tar.gz -O | sha256sum
# 1f25481c6d5653754f09ff735ba4634dcda1449668650b6c695fe10a4675b38c
```

The [current operations runbook](../../operations/DATABASE_OPERATIONS.md) marks
the S4.3 event complete. S4.2 rollback uses the designated historical application
on `maintenance/s42-rollback`. The current TypeScript forward-migration authority
accepts recognized S4.6/S4.7 sources and validates S4.8. It does not support
S4.2→S4.3. No replacement wrapper was added for this completed operation.

Normal development commands must preserve older databases and refuse to migrate
or adopt them. Read-only status may classify their migration requirement. Any
future decision to support this legacy operation requires a separately invoked,
fingerprint-gated TypeScript command before Python tooling is removed; it must
not be added to startup or ordinary database commands.
