# OperatorOS Platform Foundation v1

Historical Phase 9 release milestone: `v0.9.0-platform-foundation`.

This document is the immutable Phase 9 foundation inventory. The current completed milestone is [Phase 10 — Incremental Design-System Modernization](releases/phase-10-design-system-modernization.md); current status and the remaining Phase 9.6 external gate are tracked in the [roadmap](project-status/current-roadmap.md).

## 1. Platform overview

OperatorOS is a React 19/Vite administrative frontend backed by FastAPI, SQLAlchemy, and either local SQLite or PostgreSQL 16. The stabilized foundation consists of four cooperating layers:

```text
Identity Layer + Reporting Layer + Backup Operations + Deployment Infrastructure
```

TanStack Query owns server-state caching and invalidation. TanStack Table supports data-dense report and operations tables. Public application routes use `/api/<domain>/...`.

## 2. Authentication foundation

Implemented: first-run administrator setup, `User` and `UserSession` models, login, logout, session restoration, protected frontend routes, role guards, and backend admin authorization.

The identity schema is migration-owned. `users` stores Argon2id hashes, role, active state, and lockout state. `sessions` stores an HMAC-SHA256 digest of an opaque random token, idle and absolute expiry, revocation, and limited request context. Raw tokens exist only in HttpOnly, SameSite=Lax cookies. `AUTH_COOKIE_SECRET` is mandatory, persistent, shared by all workers, at least 32 characters, and never exposed to the frontend.

Canonical endpoints:

- `GET /api/setup/status`
- `POST /api/setup/admin`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Fresh installations have no default account or password. Provisioning is one-time and transactionally guarded; remote/non-loopback setup can require `ASTRYX_SETUP_TOKEN`. The frontend `SetupBoundary`, `AuthContext`, and route guards provide navigation behavior, but backend dependencies remain the security authority.

## 3. Executive reporting foundation

Implemented: monthly and annual reports, academic year/month/scope/class/subject filtering, deterministic grouping, PDF export, Excel export, and monthly/annual report pages.

Canonical endpoints:

- `GET /api/reports/filters`
- `GET /api/reports/monthly`
- `GET /api/reports/annual`
- `GET /api/reports/monthly/export`
- `GET /api/reports/annual/export`

`report_service.py` assembles report payloads, `report_grouping.py` owns scope rules, and `report_export.py` renders in-memory PDF/XLSX bytes. No report temporary files are written. Every report and export endpoint requires an authenticated database session. Admin and staff users may view/export reporting data; report-template administration remains governed by its existing API contract.

## 4. Backup operations foundation

Implemented: manual backup, guarded restore, scheduler configuration, execution history, retention, JSONL operations/authentication audit mirrors, and an admin-only Backup Management page.

Canonical endpoints live under `/api/admin/backups`. All operations require an admin database identity. Restore additionally requires destructive operations to be enabled, exact filename confirmation, a compatible authenticated snapshot, single-worker mode, a pre-restore safety snapshot, integrity checks, and post-restore session revocation.

These two mechanisms are intentionally separate:

- **Application scheduled backup:** file-backed SQLite snapshots managed by the in-process scheduler.
- **Operational PostgreSQL backup:** external `scripts/backup.sh` and `scripts/restore.sh` workflows; PostgreSQL snapshots are not produced by the application scheduler.

## 5. Development and deployment foundation

Implemented: hardened `start-dev.sh`, Docker build/runtime configuration, Docker contract checks, runtime frontend API configuration, and explicit SQLite/PostgreSQL migrations. Direct development uses Vite on port 5173 and FastAPI on port 8000; the Vite proxy forwards canonical `/api/*` requests. Docker uses Nginx for the frontend and PostgreSQL for persistence.

Migration order is dialect-specific and additive: identity, first-admin state, then backup scheduler. Startup compatibility patches remain non-destructive and do not replace production migrations. See [backend migration guide](../backend/migrations/README.md).

## Historical Phase 9.5 verification baseline

Phase 9.5 verification on 2026-07-14:

- Backend: 292 tests passed.
- Frontend: 19 files / 98 tests passed.
- Production frontend build: passed.
- SQLite migration/startup flows: exercised by automated tests.
- PostgreSQL migration contracts: statically tested; live PostgreSQL execution depends on an available PostgreSQL 16 service.

See [security review](security/platform-foundation-review.md) and [release notes](releases/platform-foundation.md).

## Current convergence status

The Phase 9.5 figures above are the release baseline and are intentionally preserved. The current 2026-07-14 convergence result is **296 backend tests**, **21 frontend files / 110 frontend tests**, a passing production build, and **9 Windows desktop contracts with no xfail**. Phase 9.6 remains implemented but not externally closed because clean no-development-tool Windows validation is pending. See `project-status/phases-8-to-10.md` and `project-status/current-roadmap.md`.
