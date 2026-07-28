# Frontend Route Foundation

## Decision

OperatorOS uses `BUILD_TYPED_LAZY_ROUTE_BOUNDARIES_BEFORE_FULL_TYPESCRIPT_AND_API_CLIENT_MIGRATION`.

This milestone converts only the browser entry and application shell to TypeScript, introduces typed route infrastructure, and defers every routed page with dynamic imports. It does not change backend code, API contracts, database schema, route paths, authorization rules, providers, or page internals.

## Original architecture

`App.js` eagerly imported every routed page. A production build transformed 2,176 modules into one JavaScript asset:

| Baseline measurement | Value |
| --- | ---: |
| JavaScript assets | 1 |
| Initial JavaScript raw | 1,394.67 kB |
| Initial JavaScript gzip | 376.80 kB |

Chart.js, Management Analytics, reporting, grades, enrollment, upload, and administration code were consequently part of the initial application transfer.

## Route inventory

All 34 registered paths remain present. No route was added or removed. The two legacy redirects remain:

- `/mapping` → `/enrollment`
- `/reports` → `/reports/monthly`

Routes are metadata-organized into `CORE`, `ATTENDANCE`, `ACADEMIC`, `GRADES`, `REPORTS_ANALYTICS`, and `SYSTEM_ADMINISTRATION`. Grouping is descriptive only and does not create artificial Rollup chunks.

Authorization remains at the same boundaries: all application routes remain under `RequireAuth`; existing `RequireRole` and `RequireCapability` wrappers remain attached to the same paths.

## Lazy boundary

Thirty page modules are deferred, including Login, Dashboard, attendance workflows, academic management, grades, enrollment, reports, Management Analytics, uploads, backups, and system administration. The named exports for dismissal policies and early departure use a typed named-export adapter. React, router infrastructure, providers, authentication guards, layout, sidebar, loading UI, and route error recovery remain eager.

`App.tsx` places `Suspense` and route error recovery around the routed `Outlet` inside the persistent `AppShell`. The sidebar and global providers therefore remain mounted while a page chunk loads or fails. Login has its own equivalent boundary outside the authenticated shell. Provider ordering and Strict Mode mounting are unchanged.

The shared loading state uses `role="status"`, polite live announcements, stable explanatory text, and a bounded responsive surface. It does not rely on animation or a spinner to communicate progress.

The error boundary displays “This page could not be loaded,” an operator-readable explanation, Retry, and safe navigation. It resets on retry and route-location changes, logs diagnostics only in development, and never renders raw errors, stack traces, chunk URLs, filesystem paths, or session data.

## Performance result

The route-split production build transformed 2,182 modules. Its initial entry is 361.03 kB raw and 113.02 kB gzip, approximately a 70% gzip reduction and below the preferred 150 kB target.

Management Analytics is a separate 64.58 kB raw / 12.91 kB gzip route chunk. The largest deferred route is Dashboard at 138.89 kB raw / 45.10 kB gzip. Chart.js is deferred into a separate shared asset and is not an initial login dependency. No manual vendor-chunk configuration was introduced because natural dynamic-import boundaries already produce the required deferral and manual grouping would couple unrelated routes to bundler policy.

Browser asset inspection on the sign-in URL observed only the initial entry script before route navigation. Analytics, report-builder, grades, enrollment, and administration page chunks were absent. The production build provides identifiable page chunk names, while content hashes remain intentionally unstable.

## Verification

- Focused route tests cover the complete route inventory, redirects, authorization metadata, not-found behavior, accessible loading status, safe failure UI, raw-error suppression, and retry recovery.
- Complete Bun and Node Vitest runs each passed 245 tests.
- Bun and Node production builds passed.
- Isolated E2E smoke passed 7 backend and 14 web checks. Desktop was skipped because existing desktop infrastructure is unavailable; no Tauri files changed.
- The protected attendance database was inspected only through immutable SQLite and retained its checksum and expected counts.

## TypeScript differential

Classification: `PRE_EXISTING_GLOBAL_TYPESCRIPT_DEBT_NO_ROUTE_REGRESSION`.

Baseline and feature strict checks each produce 47 pre-existing diagnostics across the same 22 files. The feature introduces zero new diagnostics, and changed route-milestone files produce zero diagnostics. Compiler options remain unchanged and strict. Global typecheck is not reported as passed.

Required limitation: `GLOBAL_TYPESCRIPT_ZERO_ERROR_GATE_DEFERRED_TO_TYPESCRIPT_COMPLETION`.

The full JavaScript-to-TypeScript migration remains separate because it must resolve existing API, page, test, and state-model debt while removing all remaining JavaScript and JSX files. See `FRONTEND_TYPESCRIPT_DEBT_BASELINE.md`.
