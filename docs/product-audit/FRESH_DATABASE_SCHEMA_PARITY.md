# Fresh-Database Schema Parity

## Release gate

Run:

```bash
make fresh-db-parity
```

This Ubuntu WSL-only command uses `backend/.venv/bin/python`, creates isolated
temporary databases under `/tmp`, runs the focused parity and startup smoke
suite, removes its temporary root, and fails on any mismatch. It is required
before releases that change models, migrations, schema bootstrap, database
startup, migration registration, or model registration.

## Coverage

The gate proves:

- the S4.2 baseline contains no S4.3 table;
- the manifest has a unique, ordered chain ending at `20260725_s43`;
- the CLI exposes the existing S4.3 migration;
- baseline plus migration equals canonical fresh bootstrap;
- current ORM metadata equals the S4.3 database semantically;
- the explicit database-only attendance composite index is the sole ORM
  exception;
- S4.3 is recorded once and a second migration/startup is idempotent;
- S4.2 startup fails without mutation;
- S4.2 ledger plus hidden S4.3 tables is rejected;
- S4.3 ledger with a missing S4.3 table is rejected;
- missing model/table/column and manifest registration/order defects are
  detected;
- an absent database bootstraps through S4.2 and S4.3 before application
  health and setup-status requests succeed;
- the protected database path is rejected by the S4.3 migrator.

## Semantic snapshots

Snapshots are sorted and contain no row data, timestamps, or temporary paths.
They normalize SQLite affinity, defaults, nullability, primary-key position,
foreign keys and actions, unique and non-unique indexes, partial predicates,
generated-column flags, exposed checks, migration version/predecessor pairs,
`user_version`, and the application head.

The migration ledger is an intentional database-only table. The additional
`idx_attendance_student_date` index is intentional database-only compatibility
infrastructure. No other table, column, primary-key, foreign-key, unique, or
index difference is allowed.

## Safety evidence

All fixture data is synthetic and starts from nonexistent paths. The gate never
copies, attaches, migrates, or configures the application against
`backend/attendance.db`. Immutable evidence keeps the protected head at
`20260724_s42`; S4.3 is applied only to temporary databases.

