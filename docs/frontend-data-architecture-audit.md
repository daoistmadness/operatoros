# Frontend Data Architecture Audit

## Scope and method

This Phase 8.0 audit was completed before the TanStack implementation. It inventories the request layer, server data held in React state, effects that initiate requests, mutation refresh behavior, and migration risk. The frontend has no Axios dependency. All production HTTP traffic ultimately uses `apiRequest()` in `frontend/src/lib/api/client.js`, whose only direct `fetch()` call applies the canonical API base URL, credentials, timeout, response parsing, and global 401 event.

## API communication inventory

| Location | API/domain | Methods | Purpose | Current pattern | Risk |
|---|---|---:|---|---|---|
| `context/AuthContext.tsx` | `/api/auth/login`, `/logout`, `/me` | GET, POST | Session bootstrap and lifecycle | `useEffect`, local user/loading state | Low |
| `pages/BackupManagement.tsx` | `/api/admin/backups` | GET, POST | Status, list, create, restore | effect + local loading/error; mutations call `load()` | Low |
| `pages/ExecutiveReports.tsx` | `/api/reports` | GET | Filters, monthly/annual reports, exports | effect + local loading/error; imperative generation | Medium |
| `pages/Dashboard.js` | analytics, students, configuration | GET | Dashboard aggregates | effect + combined local state | Medium |
| `pages/UploadHistory.js` | upload history | GET | Upload audit list | effect + manual refresh | Low |
| `pages/Settings.js` | system/settings | GET, POST | Health and guarded configuration | effect + local state | Medium |
| `pages/AttendanceReview.js` | review/classes | GET, mutation | Review queue and overrides | effects + mutation refresh | Medium |
| `pages/ClassMapping.js` | students/classes | GET, PUT | Class mapping | multiple dependent effects and Promise.all refresh | Medium |
| `pages/AbsenceReasons.jsx` | absence reason config/coverage | GET, mutation | Reasons and coverage | multiple callbacks/effects, coordinated refresh | Medium |
| `pages/StudentProfile.jsx` | student history/summary | GET | Student detail analytics | two callback-driven effects | Medium |
| `pages/HebConfig.jsx`, `JenjangConfig.jsx` | config | GET, mutation | Configuration dictionaries | effect + local state | Medium |
| `pages/ManagementAnalytics.tsx` | analytics | GET | Dense management analytics | dependent requests and local results | High |
| `components/report-builder/ReportBuilderPanel.tsx` | report builder | GET, POST, PATCH, DELETE | Templates, branding, preview/export | combined bootstrap and mutation refresh | High |
| `components/academic/AcademicConfigPanel.tsx` | academic config/grades | GET, POST, PUT, DELETE | KKM and term configuration | dependent effects and coordinated mutations | High |
| `components/enrollment/EnrollmentPanel.tsx` | grades/enrollment | GET, POST, DELETE | Dynamic enrollment matrix | dependent queries and batch mutations | High |
| `pages/GradeLedger.tsx`, `components/grades/GradeMatrix.tsx` | grades | GET, POST | Spreadsheet-style grade editing | dependent effects and local editable grid | High; excluded |
| legacy JS pages via `api.js` and `lib/api/endpoints.js` | analytics/config/review/system | GET, POST, PUT, PATCH, DELETE | Shared endpoint functions | Axios-like facade over `apiRequest()` | Medium |

The API modules under `frontend/src/api/` are request functions, not server-state hooks. Some domain calls also remain in `lib/api/endpoints.js` and the compatibility facade in `api.js`; these are overlapping abstractions, but both delegate to `apiRequest()`. Consolidating them is outside Phase 8.

## React state and effect audit

Most screens repeat `data`, `loading`, and `error` state, populate them from an async callback, and invoke that callback in `useEffect`. Mutations commonly call the same callback after success. This produces duplicated request lifecycle code, no shared cache, and screen-specific stale-data behavior.

Risk classification:

- Low: one-time GET effects in authentication, Backup Management, and Upload History. These are direct query migrations.
- Medium: effects parameterized by filters or multiple endpoints, including Reports, Class Mapping, Attendance Review, Dashboard, and configuration screens. Query keys must include every server-side input.
- High: effects coordinating dependent metadata and editable state in Academic Config, Enrollment, Management Analytics, Report Builder, and Grade Ledger. Migration must separate remote snapshots from local draft state. Grade Matrix is explicitly excluded.
- No mutation-in-effect pattern was selected for the pilots. The main observed hazard is callback/effect dependency drift and repeated Promise.all refreshes after mutations.

## Mutation and invalidation inventory

| Mutation family | Invalid data after success |
|---|---|
| Login/logout/session expiry | current user (`auth.me`) |
| Create backup | backup list and backup status |
| Restore backup | all cached server state; reauthentication flow remains authoritative |
| Attendance override/reason/config updates | affected review/list/summary plus related analytics |
| Student/class/enrollment changes | student, class, enrollment, grade ledger, and analytics queries in the affected context |
| Grade saves/imports | grade ledger and relevant analytics/report queries |
| Academic configuration | config plus analytics/report queries using the affected academic year |
| Report template/branding mutations | matching report-builder list/detail queries |

Phase 8 will standardize named mutation hooks and query-key-based invalidation for the selected pilots. Later migrations should invalidate the narrowest domain/context prefix that is definitely stale.

## Migration candidates and order

1. Query client/provider and shared key/config policy.
2. Authentication `/api/auth/me`, login, and logout.
3. Backup Management queries and create/restore mutations.
4. Backup List as the TanStack Table pilot, retaining its existing markup and classes.
5. Executive Reports filters and generated report request as the second production screen.
6. Upload History and simple configuration lists.
7. Dashboard and filtered attendance/report screens.
8. Enrollment, Academic Config, Report Builder, and Management Analytics after focused design work.
9. Grade Ledger/Grade Matrix only under a separate virtualization/editing architecture phase.

## Testing strategy

- Unit-test query retry policy, keys, auth cache transitions, mutation invalidation, and table sorting/filtering.
- Update existing Auth, Backup Management, and Executive Reports tests to render with an isolated test QueryClient.
- Run the complete Vitest suite and Vite production build.
- Run the repository browser smoke test against the development application, verifying login/session restore, administrator permission handling, backup list/create affordances, report generation, and table sorting/filtering without visual redesign.
- Treat 401 as session invalidation with existing redirect behavior and 403 as a surfaced permission error; do not retry either response.
