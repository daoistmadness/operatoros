# Database operations

`backend/attendance.db` is the protected operational database and is currently
S4.3 (`20260725_s43`). Do not use it in tests, E2E, development startup, or
fixtures. Ordinary application startup validates existing databases and never
migrates them automatically.

The S4.3 operational event is complete. Future operational migrations require
explicit user authorization, an exact target, no handles or sidecars, a fresh
verified backup outside the repository, exclusive lock, wrapper preflight, and
its process-local access context. Do not place local backup locations or live
checksums in committed documentation.

Normal operation pairs current main with S4.3. Rollback pairs a restored S4.2
database with application `c06a6220c2c0c2059521c1a396d1b914635aacff` on
`maintenance/s42-rollback`; `b47632c4210720f81804212544452c7c900c928c` is a
historical, unusable rollback base. See the completed migration record in
root execution contract ([AGENTS.md](../../AGENTS.md)).
