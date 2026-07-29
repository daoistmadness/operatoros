# Database schema architecture

`20260724_s42` is the immutable fresh-bootstrap baseline. `20260725_s43` is
the current source, runtime, and protected operational schema. Fresh bootstrap
creates and records S4.2, then applies and records the registered S4.3
migration exactly once. Full current metadata is not used to silently add S4.3
objects to an S4.2 baseline.

Existing S4.3 databases are validated at startup. Existing S4.2 databases are
not upgraded automatically and require the controlled migration path. Tests use
disposable databases; protected operational data is never copied into fixtures.
See [database operations](../operations/DATABASE_OPERATIONS.md) and the
historical [schema-head record](../product-audit/SCHEMA_HEAD_S43_ARCHITECTURE.md).
