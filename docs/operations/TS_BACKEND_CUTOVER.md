# TypeScript Backend Cutover and Rollback

Phase 12 makes Elysia the default backend. FastAPI remains available for
rollback and parity checks.

## Normal start

Use the managed launcher:

```bash
./start-dev.sh
```

It starts Elysia, then Vite. It uses the launcher-owned SQLite development
database. The frontend calls the backend through the same-origin Vite proxy.

Check health and readiness:

```bash
curl --fail http://127.0.0.1:8000/health
curl --fail http://127.0.0.1:8000/ready
```

The port can change when `--auto-port` is used. Use the URLs in the launcher
runtime state in that case.

## Forward cutover

1. Verify the accepted `origin/main` commit.
2. Verify the SQLite schema and migration fingerprint.
3. Verify the required backup or safety prerequisite.
4. Start Elysia with `./start-dev.sh`.
5. Check `/health` and `/ready`.
6. Verify login, session refresh, and logout.
7. Verify critical CRUD, attendance, import, grades, reports, and safety flows.
8. Verify one scheduler owner.
9. Monitor application errors.
10. Keep the FastAPI fallback available.

## Rollback

Use a disposable or approved rollback environment. Do not use
`backend/attendance.db` for a test.

1. Stop Elysia with `./stop-dev.sh`.
2. Start FastAPI with `OPERATOROS_BACKEND=fastapi ./start-dev.sh`.
3. Check FastAPI health.
4. Verify login and critical workflows.
5. Investigate the Elysia failure.
6. Stop FastAPI.
7. Start Elysia with `./start-dev.sh`.
8. Verify health and the critical smoke again.

Rollback uses the same accepted SQLite schema. It does not require reverse data
conversion or source-code edits.

## Safety rules

- Never test cutover with the protected operational database.
- Never start FastAPI and Elysia as normal backend owners at the same time.
- Never introduce JWT or localStorage authentication.
- Never disable authorization, audit, or SQLite safety checks.
- Keep Python source, dependencies, tests, and FastAPI routes during Phase 12.
