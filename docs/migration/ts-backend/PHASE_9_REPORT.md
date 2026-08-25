# Phase 9 safety services migration

Status: local acceptance ready. PR and CI remain required.

Base: `15447144aac9eb21fbfe350f04c5a43c720d8aef`

Branch: `codex/ts-backend-phase9-safety-services`

## Implemented

- Disposable SQLite backup creation with serialized committed state.
- SHA-256 checksum metadata.
- Integrity and required-table validation.
- Backup execution history.
- Read-only backup status, listing, and recovery history.
- Restore preflight with source and active checksums.
- Admin-only restore authorization.
- Destructive-operation gate.
- Exact filename and `RESTORE_DATABASE` confirmation.
- Safety snapshot before replacement.
- Atomic replacement with rollback recovery.
- Session revocation after restore.
- Single-instance scheduler start and clean stop.
- Scheduler configuration persistence.

## Evidence

- Full golden replay: 40/40 `EXACT_MATCH`.
- Deliberate mismatch suite: 40/40 `MIGRATION_DEFECT`.
- TypeScript tests: 49/49 passed with 264 expectations.
- Focused safety tests: 2/2 passed with backup, restore, corruption, session,
  rollback-safe replacement, and scheduler lifecycle coverage.
- Typecheck passed.
- Frozen Bun install passed.
- Phase 0 restore replay: 5/5 `EXACT_MATCH`.
- Protected database access: 0.

## Explicit later disposition

Phase 10 must classify the remaining FastAPI safety surface, including backup
delete/download aliases, clear-data behavior, portability operations, and any
unmapped scheduler or recovery routes. FastAPI remains available.

The frontend has not cut over. Phase 10 has not started.
