# First-Run Administrator Threat Model

| Threat | Protection | Residual limitation |
| --- | --- | --- |
| Two operators submit simultaneously | SQLite `BEGIN IMMEDIATE`; PostgreSQL singleton row `FOR UPDATE`; atomic completed transition | PostgreSQL runtime behavior still requires integration testing against PostgreSQL 16 |
| Remote attacker guesses setup token | Externally generated high-entropy token, constant-time comparison, body transport, generic rejection | No general rate limiter exists; operators must restrict network exposure during bootstrap |
| Setup token remains configured | Completed database state is checked before token use and permanently disables provisioning | Operators should remove the deployment secret after setup |
| Password/setup token disclosure | Hidden CLI input; no CLI password argument; no secret logging, audit fields, URLs, or responses | Browser operators remain responsible for endpoint TLS outside localhost |
| Database failure after hashing | User and singleton audit state share one transaction and roll back | JSONL mirror is post-commit and may fail independently |
| JSONL audit failure | Atomic database setup record remains authoritative; failure is surfaced without secret data | JSONL and database record are not a distributed transaction |
| Existing users with missing bootstrap row | Any user closes setup; state is reconciled on the next locked provisioning attempt | Manual destructive database edits are outside the supported contract |
| CLI interruption | Input occurs before transaction; service rollback covers later failures | Host terminal/session security is operator-controlled |
| Stale setup page | Concurrent-completion error invalidates status and redirects to login | A disconnected browser updates after connectivity returns |
