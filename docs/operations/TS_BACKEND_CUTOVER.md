# Elysia Runtime Operations

Elysia is the authoritative OperatorOS backend. React uses the same-origin
proxy to reach it. FastAPI is no longer a runtime fallback.

## Normal start

Use the managed launcher:

```bash
./start-dev.sh
```

It starts Elysia, then Vite. It uses the launcher-owned SQLite development
database. Check health and readiness:

```bash
curl --fail http://127.0.0.1:8000/health
curl --fail http://127.0.0.1:8000/ready
```

The port can change with `--auto-port`. Read the selected URLs from launcher
state when that option is used.

## Startup checks

1. Verify the accepted `origin/main` commit.
2. Verify the SQLite schema and migration fingerprint.
3. Verify the required backup or safety prerequisite.
4. Start Elysia with `./start-dev.sh`.
5. Check `/health` and `/ready`.
6. Verify login, session refresh, and logout.
7. Verify critical CRUD, attendance, import, grades, reports, and safety flows.
8. Verify one scheduler owner.
9. Monitor application errors.

## Python history

The former FastAPI application is retired. Phase 13 retains migration reports,
golden fixtures, and disposable schema tooling where they still support audit
or regression work. These tools do not start a backend or serve requests.

## Safety rules

- Never use `backend/attendance.db` for tests or startup validation.
- Use explicit disposable SQLite databases.
- Never disable authorization, audit, or SQLite safety checks.
- Keep the Elysia scheduler single-owner.
- Keep generated evidence outside commits unless the repository tracks it.
