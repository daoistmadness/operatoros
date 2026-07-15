# Phase 11.1D — Full Frontend API Route Audit

## Outcome

PASS for the WSL development route-integration gate. The five reported pages and the other legacy page-level API consumers now use the canonical `/api/<domain>/...` contract. All five pages were verified in a real browser with an authenticated administrator session. No Tauri/Rust, business logic, model, or backend route compatibility alias was changed.

## Initial failures and network evidence

The five pages called paths outside `/api`. Vite treated those paths as frontend navigation and returned its HTML application shell with HTTP 200. FastAPI received no request. The pages then attempted to consume HTML as their expected JSON schema, producing their generic load errors.

| Page | Obsolete request | Method | Status/type | Reached FastAPI | Response |
|---|---|---:|---|---|---|
| `/mapping` | `/students` and `/students/classes` | GET | 200 `text/html`, 779 bytes | No | Vite application HTML |
| `/upload-history` | `/uploads/history` | GET | 200 `text/html`, 779 bytes | No | Vite application HTML |
| `/config/jenjang` | `/config/jenjang` | GET | 200 `text/html`, 779 bytes | No | Vite application HTML |
| `/config/heb` | `/analytics/heb?...` | GET | 200 `text/html`, 779 bytes | No | Vite application HTML |
| `/config/absence-reasons` | `/config/absence-reasons?...` | GET | 200 `text/html`, 779 bytes | No | Vite application HTML |

Corrected requests through `http://127.0.0.1:5173` returned HTTP 200 `application/json`: `/api/students` (4,100 bytes in the sampled response), `/api/uploads/history` (745 bytes), `/api/config/jenjang` (35 bytes), `/api/analytics/heb` (39 bytes), and `/api/config/absence-reasons` (2 bytes for an empty result).

Cookies are included by the shared client through `credentials: "include"`. The browser smoke restored `/api/auth/me` as user `codex-route-smoke`, then the temporary account and all of its sessions were removed.

## Root causes

1. Twenty-eight production page-level calls retained pre-canonical bare paths.
2. The shared client intentionally preserves the supplied path; it does not prepend `/api`. This is required to avoid `/api/api/...` in development and packaged runtime resolution.
3. Vite proxies only `/api`, so bare paths received SPA HTML rather than reaching FastAPI.
4. Page load handlers did not distinguish authentication, permission, route, and server failures.
5. An unused Create React App `setupProxy.js` retained a hardcoded localhost backend fallback even though this application uses Vite.

## Canonical backend route inventory

Inventory source: actual registrations in `backend/src/main.py` plus route decorators.

| Domain | Methods | Canonical route family | Router | Current backend auth requirement |
|---|---|---|---|---|
| Health | GET | `/health`, `/api/system/health` | `main.py`, `api/system.py` | Public |
| Setup | GET, POST | `/api/setup/status`, `/api/setup/admin` | `api/setup.py` | Provisioning safeguards |
| Authentication | GET, POST | `/api/auth/login`, `/logout`, `/me` | `api/auth.py` | Login public; me/logout session-based |
| Students/mapping | GET, POST, PATCH | `/api/students`, `/classes`, `/assign-class`, student history/summary | `api/students.py` | No router-wide dependency |
| Uploads | POST, GET | `/api/uploads/upload`, `/history`, `/missing-records`, `/sample-template` | `api/uploads.py` | Upload requires session; read endpoints currently public |
| Attendance review | GET, POST | `/api/review/classes`, `/attendance`, override/history/mass override | `api/review.py` | Mass override session-based; other handlers have no explicit dependency |
| Configuration | GET, PUT, POST, DELETE | `/api/config/jenjang`, `/heb`, `/absence-reasons` | `api/config.py` | No router-wide dependency |
| Grades | GET, POST, DELETE | `/api/grades/...` | `api/grades.py` | No router-wide dependency |
| Academic config | GET, POST, PUT, DELETE | `/api/academic-config/...` | `api/academic_config.py` | No router-wide dependency |
| Interventions | GET, POST, PATCH, DELETE | `/api/academic-interventions/...` | `api/academic_interventions.py` | No router-wide dependency |
| Analytics | GET | `/api/analytics/...` | `api/analytics.py` | No router-wide dependency |
| Reports | GET | `/api/reports/...` | `api/reports.py` | Session required router-wide |
| Report builder | GET, POST, PATCH, DELETE | `/api/report-builder/...` | `api/report_builder.py` | No router-wide dependency |
| Backups/scheduler | GET, POST, PUT | `/api/admin/backups...` | `api/backups.py` | Admin required |
| System administration | POST, GET | `/api/system/clear-data`, `/health` | `api/system.py` | Clear-data admin + destructive guard; health public |

Legacy backend aliases remain only for `/analytics/...` and `/students/...` compatibility. New frontend code does not use them.

## Frontend request inventory and corrections

Existing API modules under `frontend/src/api/` and `frontend/src/lib/api/endpoints.js` were already canonical. The audit corrected every noncanonical production `api.<method>` literal:

| Frontend file | Feature/calls | Previous prefix | Canonical prefix | Methods checked |
|---|---|---|---|---|
| `ClassMapping.js` | classes, student list/create, bulk mapping | `/students` | `/api/students` | GET, POST, PATCH |
| `UploadHistory.js` | upload history | `/uploads` | `/api/uploads` | GET |
| `JenjangConfig.jsx` | cutoff list/available/save/delete | `/config` | `/api/config` | GET, PUT, DELETE |
| `HebConfig.jsx` | jenjangs, calculated HEB, override save/delete | `/config`, `/analytics` | `/api/config`, `/api/analytics` | GET, PUT, DELETE |
| `AbsenceReasons.jsx` | SIA list, coverage, copy, bulk save | `/config`, `/analytics` | `/api/config`, `/api/analytics` | GET, POST |
| `AttendanceReview.js` | classes, records, history, override actions | `/review` | `/api/review` | GET, POST |
| `AttendanceReport.js` | classes and report | `/students`, `/analytics` | `/api/students`, `/api/analytics` | GET |
| `StudentProfile.jsx` | monthly history and summary | `/students` | `/api/students` | GET |
| `Settings.js` | guarded clear-data | `/system` | `/api/system` | POST |

No `/api/api/...` path or production hardcoded backend origin remains. The unused `frontend/src/setupProxy.js` was removed; Vite remains the sole development proxy.

## Static protection and tests

- `canonical-route-contract.test.js` recursively scans production JS/JSX/TS/TSX and rejects literal `api.*` or `fetch` backend calls outside `/api`, local port-8000 origins, and double prefixes. Tests and static/navigation strings are excluded deliberately.
- `LegacyApiRoutes.test.js` locks the five pages' load and mutation routes.
- `errors.test.js` covers safe 401, 403, 404, 405, 500, and validation messages.
- `test_frontend_route_contract.py` verifies actual FastAPI path/method registration and confirms config/upload legacy aliases were not added.
- Existing API-client tests confirm cookies, 401 dispatch, 403 behavior, runtime base resolution, and multipart handling.
- Existing backend config, student, review, upload, authorization, reports, and destructive-operation tests exercise mutation behavior without changing live acceptance data.

## WSL browser smoke matrix

The application was running through `./start-dev.sh`. Browser console warnings/errors after the smoke: zero.

| Page/feature | Principal request | Status | UI result |
|---|---|---:|---|
| Mapping | `/api/students`, `/api/students/classes` | 200 | 107 students rendered; no error alert |
| Upload History | `/api/uploads/history` | 200 | Three successful workbook imports rendered |
| Jenjang Config | `/api/config/jenjang`, `/available` | 200 | Correct empty-state guidance rendered |
| HEB | `/api/config/jenjang/available`, `/api/analytics/heb` | 200 | Correct 2026 empty state rendered |
| Absence Reasons/SIA | `/api/config/absence-reasons`, date range | 200 | Correct July 2026 empty state rendered |
| Dashboard | analytics/students/config batch | 200 | System Analytics rendered |
| Upload | canonical upload contract | previously accepted 200 | Import screen rendered |
| Attendance Review | `/api/review/classes` | 200 | Review screen rendered |
| Academic management | grades/academic config APIs | 200 | Screen rendered |
| Enrollment | grade enrollment APIs | 200 | Screen rendered |
| Grade Ledger | grade metadata APIs | 200 | Screen rendered |
| Management Analytics | summary/trends/impact | 200 with frontend-shaped parameters | Screen rendered |
| Executive/attendance/rekap/tardiness reports | report and analytics APIs | 200 | Four report pages rendered |
| Settings | `/api/system/health` | 200 | Settings rendered; destructive actions untouched |
| Backups/scheduler | `/api/admin/backups...` | 200 as admin | Status, list, scheduler, history JSON valid |

The authenticated API smoke additionally covered session restoration, dashboard KPIs, grades, academic configuration, report builder, backups, scheduler, and health. No create/update/delete action was executed against live data; those method contracts and transactions were checked in automated tests.

## Verification results

- Backend full suite: `306 passed` in 228.06 seconds.
- Frontend full suite: 26 files, `134 passed` in 9.30 seconds.
- Targeted frontend contract/error/page tests: `15 passed`.
- Targeted backend route/upload tests: `3 passed`.
- Production frontend build: passed; 2,131 modules transformed.
- Static contract scan: passed with no noncanonical calls or hardcoded backend origin.
- `git diff --check`: passed.
- Lint: no lint script is configured in `package.json`.
- Standalone TypeScript check: unavailable because `typescript` is not declared or installed locally. `npx` was stopped before fetching an undeclared dependency. Vite production compilation passed.

Existing Pydantic/SQLAlchemy deprecation warnings and the existing Vite large-chunk advisory remain unchanged.

## Packaged desktop reassessment

The fixed calls use the shared runtime resolver and canonical `/api/...` paths, so they are compatible with the packaged dynamic sidecar origin. No desktop-specific defect or reason to alter Tauri/Rust was found. A clean Windows packaged candidate was not available in this WSL task, so mapping, upload history, configuration pages, and XLSX upload must still be retested in the clean Windows acceptance gate. No runtime-accepted tag was created.

## Remaining defects and release recommendation

1. Several existing backend domains do not enforce authentication router-wide (see inventory). This audit did not broaden security behavior because the requested defect was route integration and security changes require a separately scoped authorization review. The shared frontend still preserves cookies and protected-route behavior, and no authentication was weakened.
2. A standalone TypeScript compiler should be added only through an approved dependency/tooling change if it is required as a release gate.
3. Clean Windows packaged acceptance remains mandatory.

Recommendation: accept the WSL frontend-to-backend route gate and proceed to clean Windows packaged acceptance. Do not create `v0.11.1-runtime-accepted` until that gate passes.
