# Docker Usage Audit

Date: 2026-07-14

## 1. Executive Conclusion

**Status: ACTIVE**

Docker is an actively supported secondary runtime for OperatorOS, alongside the primary direct-process local development workflow. It is not merely a historical documentation reference:

- `.github/workflows/ci.yml` contains a dedicated `compose` job that runs `docker compose config` on every supported push and pull request.
- `docker-compose.yml` defines a coherent backend, frontend/Nginx, and PostgreSQL 16 topology with a persistent database volume and health-gated backend startup.
- `scripts/backup.sh` and `scripts/restore.sh` detect the Compose-owned `attendance_db` container and use `docker exec` for PostgreSQL operations, with local PostgreSQL tooling as a fallback.
- `README.md`, `docs/WSL2_DEVOPS.md`, `COMMANDS.md`, and the component READMEs document and cross-reference the same container workflow.
- `frontend/nginx.conf` depends on the Compose service name `backend`, while Compose passes the database service name `db` to the backend.

Direct local development does not require Docker: `start-dev.sh` runs FastAPI and Vite directly and defaults to SQLite. This does not make the independently automated Compose workflow obsolete.

No Docker resources were removed because the conditional cleanup gate permits removal only for `LEGACY` or `NOT USED`.

## 2. File Inventory

| File or reference | Current purpose | Referenced by | Classification | Recommended action |
| --- | --- | --- | --- | --- |
| `docker-compose.yml` | Orchestrates FastAPI, Nginx-hosted frontend, and PostgreSQL 16 with persistent storage | CI, README, WSL2 guide, commands guide, component READMEs | Active | Keep |
| `backend/Dockerfile` | Builds the Python 3.12/Uvicorn backend image with two workers | Compose, backend README | Active | Keep; separately verify authenticated container startup |
| `frontend/Dockerfile` | Builds the Vite frontend with Node.js 22 and serves the output through Nginx | Compose, frontend README | Active | Keep; align its build argument with Vite |
| `frontend/nginx.conf` | Serves the SPA and forwards `/api/` to the Compose `backend` service | Frontend image, README, WSL2 guide | Active | Keep |
| `.github/workflows/ci.yml` `compose` job | Validates the Compose model on pushes and pull requests | GitHub Actions | Active automation | Keep; consider adding image-build validation |
| `scripts/backup.sh` | Uses `attendance_db` for containerized PostgreSQL backup, with local `pg_dump` fallback | Operator workflow | Active optional path | Keep |
| `scripts/restore.sh` | Uses `attendance_db` for containerized PostgreSQL restore, with local tools fallback | Operator workflow | Active optional path | Keep |
| `README.md` Docker section and environment table | Documents Compose startup, topology, authentication, worker, database, and API routing constraints | Main onboarding | Active documentation | Keep; close the configuration gaps below |
| `docs/WSL2_DEVOPS.md` Docker sections | Documents Compose validation, startup, logs, persistence, networking, and reset safety | WSL2/operator guidance | Active documentation | Keep |
| `COMMANDS.md` Docker commands | Records Compose build, validation, logs, and shutdown commands | Developer command index | Active documentation | Keep |
| `backend/README.md` and `frontend/README.md` | Explain image runtimes and container integration | Component onboarding | Active documentation | Keep; frontend README contains unrelated pre-Vite command drift |
| `AGENTS.md`, `MEMORY.md`, `PROJECT_CONTEXT.md`, `ERRORS.md` | Preserve architecture, volume safety, and API-routing decisions | Repository governance | Active documentation | Keep |
| `docs/security/backup-restore.md` | Records the two-worker container restore restriction | Security/operations guidance | Active documentation | Keep |

No `.dockerignore`, `docker/`, `containers/`, `deployment/docker/`, alternate Compose file, image-publishing workflow, registry login, Buildx job, Kubernetes definition, or container-scanning workflow was found.

## 3. Workflow Evidence

### Frontend

The canonical package manager is npm and the runtime baseline is Node.js 22. The commands supported by `frontend/package.json` and CI are:

```bash
cd frontend
npm ci
npm test
npm run build
npm run dev
```

The Docker builder also uses Node.js 22 and `npm ci`; it does not introduce Bun or pnpm.

### Backend

The documented direct-process setup is:

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.main:app --reload --host 127.0.0.1 --port 8000
```

The repository also supports `./start-dev.sh`, which starts the FastAPI backend and Vite frontend directly. The launcher supplies a persistent local authentication secret and an absolute SQLite URL when explicit database/authentication settings are absent.

### Container workflow

The documented container entry point is:

```bash
docker compose config
docker compose up --build
```

Compose provides PostgreSQL at the internal hostname `db`, exposes FastAPI on port 8000, and serves the frontend through Nginx on port 80. This path is validated structurally in CI but CI does not build or launch the images.

### Production and packaging evidence

The repository contains no image publication, container registry, Kubernetes, cloud-container, systemd, Windows-service, Tauri, or release-packaging configuration. Therefore, the evidence establishes Compose as an actively supported container workflow, but does **not** establish it as the actual production deployment mechanism.

## 4. Risk Assessment

Removing Docker would not prevent direct Vite/FastAPI/SQLite development or the normal npm and pytest suites. It would, however:

- break the CI `compose` job;
- remove the only repository-defined full-stack PostgreSQL 16 provisioning workflow;
- break documented Nginx same-origin `/api` deployment behavior;
- remove the container-specific PostgreSQL branches in backup and restore operations;
- invalidate onboarding, operations, architecture, and security documentation;
- eliminate a supported build/runtime path without a documented replacement.

PostgreSQL compatibility in SQLAlchemy and migrations is not intrinsically Docker-dependent, but Compose is the repository's concrete PostgreSQL provisioning example. Backup scheduling itself is Python/SQLite functionality and does not require Docker; the shell backup/restore utilities deliberately support both containerized and locally managed PostgreSQL.

The audit also found active-workflow risks that should be handled separately from this removal decision:

1. Compose passes `VITE_API_BASE_URL`, but `frontend/Dockerfile` declares and exports `REACT_APP_API_URL`. Vite reads `VITE_API_BASE_URL`; the current same-origin default may mask the mismatch.
2. CI sets `REACT_APP_API_URL` for Compose validation while Compose now declares `VITE_API_BASE_URL`.
3. The backend requires a persistent `AUTH_COOKIE_SECRET`, but `docker-compose.yml` does not declare/pass it. The README correctly warns that protected deployment configuration must supply one, yet a host variable is not automatically injected into a service unless Compose maps it or another configuration mechanism is used.
4. CI validates Compose syntax only. It does not build the images, start the services, exercise health checks, or verify authenticated application startup.
5. The backend image intentionally runs two workers. Restore and the in-process scheduler fail closed outside the supported single-worker maintenance/runtime profile, as documented.
6. `frontend/README.md` and parts of `COMMANDS.md` still mention CRA-era `npm start` and `REACT_APP_API_URL`; this is general Vite documentation drift, not evidence that Docker is obsolete.

These gaps make runtime verification incomplete; they do not make the Docker workflow unreferenced or safe to delete.

## 5. Cleanup Recommendation

**KEEP DOCKER**

Retain all Docker files, automation, scripts, and documentation. A focused follow-up should repair and test the active Compose workflow: align the Vite build argument, define a safe secret-injection contract, and add at least image-build and service-health validation without committing secrets.

## Phase 9.1 Configuration Map

This map records the pre-hardening state discovered on 2026-07-14.

| Concern | Current source | Consumer | Expected value | Status before hardening |
| --- | --- | --- | --- | --- |
| Frontend API base URL | Compose `VITE_API_BASE_URL` build argument | `frontend/src/lib/api/client.js` via `import.meta.env.VITE_API_BASE_URL` | Empty for same-origin `/api` routing through Nginx, or an explicit browser-reachable URL | Mismatch: Dockerfile consumed `REACT_APP_API_URL` |
| Auth cookie secret | External Compose interpolation | FastAPI authentication/session digest layer | Persistent secret of at least 32 characters, supplied outside version control | Missing: Compose did not map the value into the backend service |
| Database connection | Compose `POSTGRES_*` environment | SQLAlchemy settings URL builder | PostgreSQL service hostname `db` with matching user, password, database, and port | Valid topology; password had a development fallback |
| PostgreSQL readiness | Compose database health check | Backend `depends_on` | Check configured user and database | Partial: check hardcoded user `postgres` |
| Backend readiness | No backend health check | Frontend dependency and operators | Unauthenticated `/api/system/health` response | Missing |
| Nginx backend upstream | `frontend/nginx.conf` | Nginx reverse proxy | Compose service name `backend:8000` | Valid |
| Frontend readiness | No frontend health check | Compose/operators | Nginx serves the SPA locally | Missing |
| Scheduler persistence | PostgreSQL operational tables | In-process scheduler | Database-backed configuration, `next_run_at`, and history | Valid when PostgreSQL volume persists |
| Backup/audit persistence | Backend default `./backups/` | Backup, restore, scheduler, and audit services | Writable persistent container path | Missing volume; artifacts were ephemeral |

The selected frontend architecture is same-origin: the Vite bundle uses an empty API base, browser calls remain under canonical `/api/...`, and Nginx proxies that prefix to `backend:8000`. Docker-only hostnames are never embedded in browser code.

### Phase 9.1 hardening outcome

- Compose, the frontend Dockerfile, and Vite now use only `VITE_API_BASE_URL`; the obsolete CRA variable was removed from the image path.
- Nginx preserves `/api/...` when forwarding canonical routes to FastAPI.
- Compose requires externally supplied `POSTGRES_PASSWORD` and `AUTH_COOKIE_SECRET` values and never embeds either secret.
- Compose also requires an external `ASTRYX_SETUP_TOKEN` while first-run web provisioning is exposed; completed database state makes that token permanently unusable for further provisioning.
- PostgreSQL readiness uses the configured database/user, the backend has a real unauthenticated health check, and the frontend waits for backend health.
- Fresh PostgreSQL volumes initialize the migration-owned identity and scheduler schemas from read-only SQL mounts. Existing volumes remain under the documented explicit migration process.
- Compose intentionally runs one backend worker so scheduler startup and restore safety agree with runtime configuration.
- `db_data` persists PostgreSQL state; `backend_data` persists application backup and audit artifacts.
- CI checks the Docker/application configuration contract before running `docker compose config` with test-only interpolation values.

## Remaining Docker References

All discovered project-owned Docker references remain intentional:

- runtime definitions: `docker-compose.yml`, both Dockerfiles, and `frontend/nginx.conf`;
- automation: the GitHub Actions Compose validation job;
- operations: container-aware PostgreSQL backup and restore paths;
- onboarding and operations: README files, `COMMANDS.md`, and `docs/WSL2_DEVOPS.md`;
- architecture and safety: `AGENTS.md`, `MEMORY.md`, `PROJECT_CONTEXT.md`, `ERRORS.md`, and backup/restore security documentation;
- a `.bak` launcher reference that identifies Docker-owned port processes for diagnostics, not application startup.

Generated dependency and build directories were excluded from the audit because they do not define supported project behavior.
