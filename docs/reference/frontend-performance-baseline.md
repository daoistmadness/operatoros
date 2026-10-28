---
status: current
last_reviewed: 2026-10-28
---

# Frontend performance baseline

This page records a local measurement of the current React 19, Vite, and
TanStack Router application. It is a reproducible baseline, with no speedup
claim or performance target.

## Verified URL behavior

The shared TanStack Router search schema accepts strings and repeated arrays of
strings. Parsing keeps repeated values in URL order, ordinary unknown keys stay
available to pages, and `validateSearch` converts number and boolean values to
strings before TypeBox checks them. The parser, validator, and serializer drop
`__proto__`, `constructor`, and `toString`. This shared layer defines no
pagination range, sort allowlist, or date rules.

The current web consumers use URL state as follows:

| Concern | Current URL consumers | Observed behavior |
| --- | --- | --- |
| Page and sort | `AcademicAssessmentOperations` (`/grades/operations`) | Reads and writes `page`, `sort`, and `order`; the request uses `page_size: 25`. A non-positive or non-numeric page falls back to 1. The URL sort value is typed by cast in the page. |
| Page and sort | `StudentTrendInsights` and `StudentIndicatorInsights` | Read and write `page`, `sort`, and `order`; each request uses `page_size: 25`. The pages lower-bound the parsed page to 1, allowlist sort keys, and treat only `desc` as descending. |
| Page | `AttendanceCorrectionReview` (`/attendance-corrections`) | Reads and writes `page` with correction filters; its request uses `page_size: 25`. A non-positive or non-numeric page falls back to 1. |
| Table state | `AcademicAnalytics` and `AttendanceAnalytics` | Academic year, level, class, and date filters use URL parameters. Table search, sort, and page state stay in the component and are sent to the API without URL persistence. |
| Directory state | Student management | Search, filters, and pagination are component/API state; this page does not persist them in the URL. |
| Single date | `AttendanceReview`, `AttendanceCalendar`, `DailyAttendanceOperations`, and `ClassAttendanceEntry` | Read `date` from the URL. The calendar accepts the date only when it falls inside the selected academic year; the other pages keep their existing defaults and API behavior. |
| Date range | `ClassOverview`, `AttendanceAnalytics`, `AttendanceCorrectionReview`, and `TardinessReport` | Use their existing `attendance_date_from`/`attendance_date_to` or `date_from`/`date_to` parameters. No shared range is applied by the router. |
| Period | `RekapAbsensi`, `AttendanceReport`, `TardinessReport`, `AbsenceReasons`, and `AttendanceReconciliation` | Use their current `start_date`/`end_date`, period, month, year, or term parameters. Page-specific controls and API/domain rules remain responsible for validation. |

These observations come from the current page components in
`apps/web/src/pages/`. They describe URL initialization and serialization, not
a new API contract. This PR does not add date bounds, page limits, sort keys,
or business validation.

## Method

The opt-in Playwright case runs against the repository E2E runner's production
Vite build and preview with its synthetic SQLite fixture. It creates five new
Chromium contexts at a 1365 × 900 viewport, one worker, and measures the login
form, an authenticated dashboard document entry, first and repeat SPA visits to
Academic Analytics, table filtering and sorting, a score-chart hover, and a
dirty Attendance Calendar navigation attempt. The dirty navigation prompt is
dismissed; the test asserts that the edited value remains and that no business
write occurred.

`apps/web/vite.config.js` sets Vite preview responses to
`Cache-Control: no-store`.
Repeated SPA navigation reuses route code in the active page runtime; it is not
a warm HTTP-cache measurement. The run uses unthrottled local loopback traffic,
so it has no field network profile or field percentile cohort.

The harness records navigation timings, same-origin JavaScript resource paths
and byte sizes, API request and failure counts, DOM node counts, Chromium heap
when available, LCP and CLS lab observations, and raw Event Timing entries at a
16 ms duration threshold. The Event Timing values are not INP. CLS is sampled
from the authenticated dashboard document through 50 ms after its heading is
visible; layout shifts with recent input are excluded. Event Timing records
cover the later measured interactions in that document.

The local p75 values below use the nearest-rank method over five runs. Each row
includes its run count and observed range. Byte counts sum same-origin script
resource `encodedBodySize` and `transferSize`; browser timing and heap values
are local lab readings.

## Results

The baseline run completed on 2026-10-28. The repository runner reported 8 of
8 backend smoke tests and 3 of 3 Playwright tests passing. The three browser
tests were the opt-in baseline and the two tagged reset checks required by the
runner's disposable database verification.

| Metric | Local p75 | Range, n = 5 |
| --- | ---: | ---: |
| Login form visible | 608 ms | 582–620 ms |
| Authenticated dashboard heading visible after document navigation | 824 ms | 703–973 ms |
| Authenticated document `responseStart` | 4.9 ms | 2.3–6.5 ms |
| Authenticated document DOMContentLoaded | 77 ms | 73.1–122.5 ms |
| Authenticated document `loadEventEnd` | 77 ms | 73.1–122.8 ms |
| First Academic Analytics SPA visit | 695 ms | 645–713 ms |
| Repeat Academic Analytics SPA visit | 308 ms | 302–317 ms |
| Additional JavaScript resources on repeat SPA visit | 0 | 0–0 |
| Academic table filtering | 143 ms | 134–143 ms |
| Academic table sorting | 83 ms | 58–162 ms |
| Score chart hover | 54 ms | 48–65 ms |
| Dirty navigation prompt interaction | 133 ms | 114–158 ms |
| Initial JavaScript encoded bytes | 249,048 bytes | 249,048–249,048 bytes |
| Initial JavaScript transfer bytes | 258,948 bytes | 258,948–258,948 bytes |
| First Academic Analytics route encoded bytes | 71,529 bytes | 71,529–71,529 bytes |
| First Academic Analytics route transfer bytes | 72,429 bytes | 72,429–72,429 bytes |
| API requests in the measured workflow | 48 | 48–48 |
| HTTP responses with status 400 or higher | 1 | 1–1 |
| Browser transport cancellations | 7 | 7–7 |
| Dashboard DOM nodes | 855 | 855–855 |
| Academic Analytics DOM nodes | 683 | 683–683 |
| Attendance Calendar DOM nodes | 548 | 548–548 |
| Chromium `performance.memory` heap used | 15,200,000 bytes | 10,600,000–15,200,000 bytes |
| Dashboard LCP lab sample | 856 ms | 744–892 ms |
| Dashboard CLS lab sample | 0.1367 | 0.0180–0.2052 |
| Maximum observed Event Timing duration | 200 ms | 200–200 ms |

Each sample also recorded one expected `401` from `/api/auth/me` before login.
The seven transport cancellations per sample were `net::ERR_ABORTED` requests
during document navigation: three `/api/readiness`, two
`/api/operator/dashboard-overview`, and two `/api/operator/bosp-reminder`.
They are retained as cancellations, not counted as HTTP response failures.
The dirty navigation produced the confirmation prompt and zero business
writes. The login request was the only observed non-GET request.

All five runs supported Chromium heap, layout-shift, and Event Timing
observation. The raw samples include the individual resource paths, timings,
failures, and Event Timing records:
[frontend-performance-baseline-samples.json](frontend-performance-baseline-samples.json).

## Environment

- Linux `7.0.0-38-generic`, x64; four processors visible to the runner.
- Host uptime was 6 days, 10 hours, 1 minute; load averages were 1.56, 1.78,
  and 1.89 before the run.
- The production build used Bun 1.4.4. Playwright used Node v24.19.0 and
  Chromium 149.0.7827.55.
- Playwright used one worker and a 1365 × 900 viewport.
- The run used the local Vite preview and local Elysia API without network
  throttling.

## Coverage and limits

Measured journeys cover the cold login form, the authenticated dashboard
document, first and repeat Academic Analytics navigation, one table filter and
sort, one chart hover, and the unsaved calendar navigation guard. They do not
cover long attendance list scrolling, attendance submission, student directory
filtering, exports or imports, another user role, logout or cross-tab auth,
recovery from a disconnected API, or small-screen and device-specific behavior.

These five local runs describe one machine, one browser build, one viewport, one
synthetic fixture, and one unthrottled loopback setup. They are not a field p75,
a network profile, an accessibility result, or evidence of a performance
improvement. Heap values use Chromium's implementation-specific
`performance.memory` API. Event Timing records include the measured workflow's
browser events and are not a substitute for INP.

## Privacy, security, and rollback

The E2E runner created and removed its disposable synthetic runtime root. Its
successful logs and database snapshots remain only in the ignored local
`e2e-results/` directory as requested for artifact preservation. The committed
sample file contains performance metadata, resource paths, synthetic API paths,
and browser timing entries; it contains no application records or credentials.

Rollback consists of reverting the PR-01 source, test, documentation, sample,
and changelog files. The change adds no schema, API, persistent application
data, or runtime setting.
