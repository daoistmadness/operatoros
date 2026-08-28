# Git history data remediation

Date: 2026-08-28

The repository history contained database runtime artifacts. This remediation
removed only confirmed operational and runtime paths. It did not change
application source behavior.

Original main:

`60cd734e1dbb8decf339300687fc5e27ef3d4ce3`

Sanitized main after the path rewrite:

`09176a1d090911ef3a70825e343f864b85c4b4de`

The purge set was:

- `attendance.db`
- `attendance.db-shm`
- `attendance.db-wal`
- `backend/ci-test.db-shm`
- `backend/ci-test.db-wal`
- `backend/.venv/bin/attendance.db`
- `backend/.venv/bin/attendance.db-shm`
- `backend/.venv/bin/attendance.db-wal`

The rewrite covered 65 branches and one tag. The remediation mirror also
rewrote 72 local pull-request refs. Provider-managed pull-request refs may
require separate GitHub cleanup. This document does not claim provider-side
object erasure.

Verification used path and object reachability scans. The rewritten retained
refs contain zero purge paths and zero reachable recorded exposed blobs. The
current main tracks no runtime database, WAL, or SHM files.

No credential-bearing `.env` file was found. `.env.example` is a template.
Credential rotation is not required by this finding.

Phase 14.7 architecture checks passed on the rewritten main. The data-directory
insertion remains pending and must resume from the new sanitized main with a
new branch.
