# Operational S4.3 Migration Runbook

This runbook upgrades the protected SQLite database from `20260724_s42` to
`20260725_s43`. It is an offline event: stop OperatorOS, verify zero database
handles, acquire `/tmp/operatoros-s43-operational-migration.lock`, and retain
the verified rollback backup until the approved retention period expires.

## Versions and authorization

- Readiness source application: `30948a6f810db91d5dd2dbbe1148d3f51c9e4303`
- Historical rollback base: `b47632c4210720f81804212544452c7c900c928c`
- Rollback maintenance branch: `maintenance/s42-rollback`
- Rollback correction PR: [#30](https://github.com/daoistmadness/operatoros/pull/30)
- Approved rollback application: `c06a6220c2c0c2059521c1a396d1b914635aacff`
- Rollback tag: none; use the full approved SHA
- Source schema: `20260724_s42`
- Target schema: `20260725_s43`
- Migration: `20260725_s43`
- Human authorization token: `AUTHORIZE_OPERATIONAL_S43_MIGRATION`

The readiness phase must not mutate `backend/attendance.db`. The authorized
event is the only time the protected path may be supplied to the migration.

The historical base has a deployment-gate defect: it rejects the legitimate
S4.2 state where all eligible legacy students are still untouched and
unlinked. PR #30 applies a bounded, read-only correction on the rollback-only
maintenance branch. It accepts empty, untouched all-unlinked, and fully valid
linked states while continuing to reject partial, orphaned, ambiguous, or
mismatched linking. It does not add rows, schema, migrations, APIs, or a bypass.

The only supported rollback pairing is an S4.2 database at `20260724_s42` with
application SHA `c06a6220c2c0c2059521c1a396d1b914635aacff`. Never run current
main against a restored S4.2 database, and never execute the uncorrected
historical base as the rollback application. `BYPASS_STUDENT_LINKING_GATE`
remains prohibited during rehearsal and operation.

## Commands

From the repository root, with Ubuntu WSL and `backend/.venv/bin/python`:

```bash
export PYTHONPATH=backend/src
export DATABASE_URL=sqlite:////absolute/path/to/attendance.db
backend/.venv/bin/python scripts/s43_migration.py \
  --database /absolute/path/to/database.db \
  --confirm MIGRATE_S43_EXPLICIT_DATABASE
```

The wrapper requires an explicit path and confirmation token, rejects sidecars
and unsupported heads, and serializes the event with `flock`. It never supplies
a default database path and does not contain migration SQL.

## Event procedure

1. Stop the backend, desktop supervisor, frontend, test runners, and schedulers.
2. Confirm `pgrep`, `lsof`, and `fuser` show zero OperatorOS processes/handles.
3. Confirm no `attendance.db-wal` or `attendance.db-shm` exists.
4. Copy the source to a mode `0600` backup in a mode `0700` directory outside
   the repository; fsync the file and directory and verify SHA-256 equality.
5. Run the wrapper against the explicit operational path.
6. Validate head, one S4.3 ledger row, all three S4.3 tables, unchanged
   pre-existing counts, integrity, quick check, and zero foreign-key violations.
7. Start current main and run bounded readiness, login, attendance read,
   Follow-Ups, Jenjang Config, and Operator Work Queue smoke checks.
8. On any rollback trigger, stop the application and atomically restore the
   verified backup to a temporary sibling, fsync, `os.replace`, fsync the
   directory, then verify S4.2 and the original checksum. Never start current
   main against that restored database; use the rollback SHA only.

Immediate rollback triggers include any nonzero migration exit, wrong head,
missing/duplicate ledger, missing/unexpected schema object, changed protected
counts, failed integrity/quick/FK checks, failed application smoke, process or
handle leaks, or backup verification failure. Do not repair with ad hoc SQL.

## Rehearsal and cleanup

Use a mode `0700` temporary directory outside the repository. Copy the database
byte-for-byte, verify checksum and size, run the exact wrapper on the copy, and
perform the same post-migration checks. Restore the retained S4.2 backup into a
separate nonexistent destination using the atomic procedure, then validate it.
Run compatibility smoke from a detached worktree at the rollback SHA. Remove
all rehearsal copies, restored copies, sidecars, logs, and temporary manifests
after evidence is captured; never remove the retained operational rollback
backup immediately after the event.
