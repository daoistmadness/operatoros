# Platform portability

## Decision

`SQLITE_SUPPORTED_POSTGRES_EXPERIMENTAL`. SQLite is the supported local and
desktop dialect. PostgreSQL 16 has source-level support (`asyncpg`, Compose,
SQLAlchemy dialect branches, and partial-index declarations), but no real
PostgreSQL 16 contract, migration-parity, analytical-parity, or concurrency run
was executed for this specification. It must not be described as dual-dialect
production support.

## Database contract

Both dialects must prove the same business outcomes: fresh bootstrap records
S4.2 then S4.3; migration ledger ordering is idempotent; constraints and audit
append-only behavior hold; duplicate attendance/upload handling rolls back
atomically; date filtering, sorting, pagination, aggregates, window results,
JSON serialization, and nullable values are deterministic. SQL syntax alone is
not parity evidence.

SQLite-specific WAL/PRAGMA configuration is intentional. PostgreSQL validation
must use loopback-only PostgreSQL 16, synthetic credentials and data, a unique
temporary database, migration objects (not `create_all`), representative
analytical result comparisons, and bounded concurrency scenarios. Until then:
`POSTGRES_RUNTIME_VALIDATION_NOT_EXECUTED`.

Existing databases are never migrated by ordinary startup. Current applications
pair with S4.3; the protected operational database is never a test target.
