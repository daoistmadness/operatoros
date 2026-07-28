# S4.3 Schema-Head Architecture

## Decision

OperatorOS uses `BASELINE_BOOTSTRAP_PLUS_INCREMENTAL_MIGRATIONS_IS_AUTHORITATIVE`.
The immutable fresh-install baseline is `20260724_s42`; the current source and
runtime head is `20260725_s43`.

The earlier implementation conflated those concepts. Its manifest ended at
S4.1, its fresh initializer recorded S4.2 while full ORM metadata silently
created the three S4.3 tables, and startup accepted only S4.2. Explicitly
applying S4.3 therefore produced a correct ledger head that startup rejected.

## Canonical sequence

Fresh installation follows this visible sequence:

1. Require an absent, absolute SQLite path.
2. Import the explicit model registry.
3. Create the S4.2 baseline table allowlist.
4. Exclude exactly `attendance_follow_ups`, `attendance_follow_up_notes`, and
   `attendance_follow_up_audit`.
5. Record `20260724_s42`.
6. Run the registered `20260725_s43` migration.
7. Create the three follow-up tables and append-only audit triggers.
8. Record `20260725_s43` exactly once.
9. Validate the current schema fingerprint before application startup.

Full current `Base.metadata.create_all()` is never used to define the S4.2
baseline.

## Existing databases

- An existing S4.3 database receives validation only and may start.
- An existing S4.2 database fails with `DATABASE_MIGRATION_REQUIRED`; ordinary
  startup never upgrades it.
- An absent configured database is the only state eligible for automatic fresh
  bootstrap.
- Unknown, malformed, or semantically incomplete databases fail closed.

Operators must run the controlled `upgrade-s43` migration command against an
approved copy or deployment database before starting code that expects S4.3.
The repository’s protected `backend/attendance.db` deliberately remains at
S4.2 and was not opened through application configuration or migrated.

## Contract classification

- Schema design change: none.
- New migration: none.
- Existing migration activated: `20260725_s43`.
- API runtime contract change: none.
- Startup schema-head policy: corrected.
- Existing S4.2 compatibility: explicit migration required before startup.

