# Operational S4.3 migration record

> **Historical audit record.** For current execution rules, see
> [AGENTS.md](../../AGENTS.md) and [Database operations](../operations/DATABASE_OPERATIONS.md).

## Completed event

The protected operational database migration completed on 2026-07-29. Its
current schema head is `20260725_s43`; the S4.3 ledger is recorded once and
the follow-up, note, and audit tables are present. The event preserved the
pre-existing population and completed integrity, quick, and foreign-key checks.
S4.3 authorization is consumed and is not a pending operating instruction.

## Historical repair sequence

The first authorized attempt stopped before opening the database because the
wrapper imported configuration before operational authority existed. Normal
protected-path validation correctly rejected that import order. The repair
established a process-local context only after immutable preflight, verified
backup, exclusive lock, exact path, checksum, and S4.2 head; migration code is
lazy imported within it. Normal startup and direct migration calls remain
rejected.

## Current safeguards and future template

Future migrations require fresh authorization, a new verified backup outside
the repository, no handles or sidecars, wrapper preflight, lock, process-local
context, post-migration validation, and cleanup. Do not commit local backup
paths, operational checksums, or operational data.

Current main pairs with S4.3. Rollback pairs restored S4.2 only with
`c06a6220c2c0c2059521c1a396d1b914635aacff` on
`maintenance/s42-rollback`. The historical
`b47632c4210720f81804212544452c7c900c928c` base is audit-only and must not
execute. Do not repair failed operations with ad hoc SQL.
