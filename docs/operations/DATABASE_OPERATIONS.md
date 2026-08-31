# Database operations

`backend/attendance.db` is the protected operational database and remains
S4.3 (`20260725_s43`) until a separately authorized operational migration.
Do not use it in tests, E2E, development startup, or fixtures. The current
application schema is S4.4 (`20260831_s44`) and ordinary startup validates
existing databases and never migrates them automatically.

The S4.3 operational event is complete. The isolated S4.4 academic timeline
migration preserves existing grade values and leaves historical period
attribution unknown. Future operational migrations require
explicit user authorization, an exact target, no handles or sidecars, a fresh
verified backup outside the repository, exclusive lock, wrapper preflight, and
its process-local access context. Do not place local backup locations or live
checksums in committed documentation.

Normal operation pairs current main with an S4.4 database. Until the protected
database is separately migrated, it must not be started with the S4.4
application. Rollback pairs a restored S4.2
database with application `c06a6220c2c0c2059521c1a396d1b914635aacff` on
`maintenance/s42-rollback`; `b47632c4210720f81804212544452c7c900c928c` is a
historical, unusable rollback base. See the completed migration record in
root execution contract ([AGENTS.md](../../AGENTS.md)).
