# Archived one-shot tooling

[s43_migration.py](s43_migration.py) is the unchanged historical S4.2→S4.3
migration wrapper previously stored at `scripts/s43_migration.py`. It is evidence,
not a supported current command, and is not part of development, CI, or E2E gates.
Its original imports and repository-relative paths remain frozen; do not execute
the archived copy.

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
