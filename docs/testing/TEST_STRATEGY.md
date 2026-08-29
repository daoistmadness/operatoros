# Test strategy

Ordinary tiers run against disposable SQLite databases and require neither
Docker nor PostgreSQL. Database configuration, startup, path-safety, and schema
changes escalate through the classifier to the PR or release tier; migration
sensitivity also selects fresh parity and duplicate backend passes.

`make test-fast` is the iterative, changed-path-aware gate. It is the normal
gate for documentation-only work. `make test-pr` is the ordinary PR gate.
`make test-release` adds complete release coverage, fresh parity, deterministic
Playwright scenarios, and duplicate backend passes when schema/startup risk
requires them. `make fresh-db-parity` validates the fresh bootstrap sequence.

The classifier fails safe for unknown paths and automatically escalates schema,
migration, startup, and test-infrastructure work. All tests are not run after
every small edit because selection preserves feedback speed without weakening
release coverage. Playwright uses disposable databases and dynamic ports; it
uses observable readiness rather than arbitrary sleeps and removes successful
run artifacts. Each tier snapshots the protected S4.3 database before and after
the run using immutable read-only SQLite; it rejects handles, sidecars, invalid
schema state, or any mutation during that run without treating a live checksum
as a permanent repository constant. Historical orchestration evidence remains in Git history.
