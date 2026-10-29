---
status: current
last_reviewed: 2026-10-29
---

# Frontend performance baseline

This page records the PR-01 local performance baseline for the React 19, Vite,
and TanStack Router application, plus PR-02 and PR-08 follow-up comparisons.
Each result identifies its measured scope; the local samples are not field
percentiles.

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

The fixture is seeded by `e2e/helpers/seed-test-database.ts`: it includes three
named E2E students, one link target, and 72 synthetic report learners. The table
journey filters for `E2E`; it does not measure a large unfiltered table.

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

### PR-06 chart bundle comparison

The PR-05 base (`af1405e`) and PR-06 production builds used Bun 1.4.4, Vite
8.3.4, and `bun --filter @operatoros/web build`. The report sums emitted `*.js`
files and independently gzip-compresses each file at level 9. The route import
closure follows static relative JavaScript imports from the
`ManagementAnalytics` entry. These are build-size estimates, not browser
transfer measurements; the gzip sum does not model Brotli or response headers.

| Measure | PR-05 base | PR-06 | Change |
| --- | ---: | ---: | ---: |
| All emitted JavaScript, raw | 1,946,939 bytes | 2,113,750 bytes | +166,811 bytes (+8.6%) |
| All emitted JavaScript, gzip sum | 562,699 bytes | 617,365 bytes | +54,666 bytes (+9.7%) |
| Management Analytics entry, raw | 13,540 bytes | 180,351 bytes | +166,811 bytes |
| Management Analytics entry, gzip | 3,492 bytes | 58,113 bytes | +54,621 bytes |
| Management Analytics static import closure, raw | 734,174 bytes | 900,985 bytes | +166,811 bytes |
| Management Analytics static import closure, gzip sum | 234,471 bytes | 289,084 bytes | +54,613 bytes |

The added Unovis code is confined to the already lazy-loaded Management
Analytics route. It increases that route's compressed JavaScript payload; this
phase makes no runtime speedup claim. Chart.js remains in the build for the
other charts that still need it.

### PR-08 deferred chart and route chunk comparison

The before build is PR-08's base commit (`bd906b8`) and the after build is this
phase, both on the same four-processor Linux host with Bun 1.4.4 and Vite 8.3.4.
Both used `bun --filter @operatoros/web build`. The before sizes were measured
from emitted `*.js` files before enabling Vite's build manifest; the after
report uses the manifest's `src/pages/ManagementAnalytics.tsx` entry. Raw
counts are file byte lengths. Gzip values independently compress each file at
level 9. The static closure includes transitive static imports and excludes
dynamic imports. These are build-size estimates, not browser transfer sizes.

| Measure | PR-08 base | PR-08 | Change |
| --- | ---: | ---: | ---: |
| Management Analytics entry, raw | 180,351 bytes | 14,289 bytes | −166,062 bytes (−92.1%) |
| Management Analytics entry, gzip | 58,441 bytes | 3,883 bytes | −54,558 bytes (−93.4%) |
| Management Analytics static closure, raw | 902,695 bytes | 737,366 bytes | −165,329 bytes (−18.3%) |
| Management Analytics static closure, gzip sum | 291,707 bytes | 237,602 bytes | −54,105 bytes (−18.5%) |
| All emitted JavaScript, raw | 2,117,646 bytes | 2,118,427 bytes | +781 bytes (+0.04%) |
| All emitted JavaScript, gzip sum | 621,740 bytes | 622,575 bytes | +835 bytes (+0.13%) |

The 166,620-byte raw (55,167-byte gzip) attendance chart module remains in the
production build as a dynamic chunk. It is requested only when its container
approaches the viewport; the attendance table and exact server values remain
available independently. The existing Management Analytics E2E journey checks
that the chart chunk has not loaded before scrolling to the table/chart area,
then verifies the chart, legend, tooltip, and responsive layout.

The production analyzer enforces a direct-entry budget of 160,000 raw bytes and
40,000 gzip bytes for each of 48 `src/pages/*.tsx` route entries. The largest
current page entry is Upload Center at 142,131 raw and 32,615 gzip bytes. These
budgets apply to page entry chunks, not their shared static closures or lazy
feature chunks. `bun --filter @operatoros/web build` runs the budget check;
`bun --filter @operatoros/web analyze:bundle` prints the full manifest report.

This change splits code rather than deleting it: total emitted JavaScript grew
by 781 raw bytes and 835 bytes in the independent gzip sum. The result is a
smaller initial Management Analytics entry, not a smaller total application
bundle or a measured route-latency improvement. No Framer Motion usage or
dependency was found. Reduced motion is already enforced globally in the web
stylesheet; an E2E assertion now checks the computed animation and transition
durations while the Management Overview test runs with reduced motion enabled.

The five-run browser baseline was also repeated with the existing opt-in
Playwright journey, Chromium 149.0.7827.55, one worker, and a 1365 × 900
viewport. The host had four processors and load averages of 2.35, 2.79, and
2.17 before the run. This journey covers login, the dashboard, Academic
Analytics, filtering/sorting, and the dirty-navigation guard; it does not visit
Management Analytics, so these readings are regression context rather than a
before/after measure of the deferred chart.

| Metric | Current local p75 | Range, n = 5 |
| --- | ---: | ---: |
| Login form ready | 611 ms | 580–624 ms |
| Dashboard document ready | 813 ms | 682–826 ms |
| First / repeat Academic Analytics SPA visit | 689 / 329 ms | 661–731 / 313–333 ms |
| Initial JavaScript transfer | 265,617 bytes | 265,617–265,617 bytes |
| First Academic Analytics route transfer | 72,428 bytes | 72,428–72,428 bytes |
| Dashboard LCP lab sample | 820 ms | 692–852 ms |

Each sample recorded one expected pre-login `401` and 28 browser transport
cancellations (`net::ERR_ABORTED`) during document navigation. Those counts
are retained as failures/cancellations, not interpreted as speedups. The E2E
runner reported 8/8 backend tests and 4/4 browser tests passing, including the
baseline journey, management chart behavior, reduced-motion assertion, and
synthetic reset checks. It used local unthrottled traffic and does not represent
a field percentile or INP measurement.

### PR-02 query focus request comparison

The opt-in `@query-focus` E2E case was run five times on the PR-01 base and
five times with PR-02. Both runs used the same E2E runner, synthetic SQLite
fixture, Chromium 149, 1365 × 900 viewport, one worker, and unthrottled local
loopback traffic. Each sample logged in, waited for the dashboard to settle,
then dispatched paired window-focus and visibility-change events. It held the
`/api/auth/me` response for 250 ms and counted API requests through network
idle after releasing it. The baseline samples came from `cc536b80`; the
optimized samples were collected from the PR-02 working tree on 2026-10-29.

| Metric | PR-01 base p75 | PR-02 p75 | Samples, n = 5 |
| --- | ---: | ---: | --- |
| Total API requests during focus revalidation | 24 | 1 | 24, 24, 24, 24, 24 → 1, 1, 1, 1, 1 |
| `/api/auth/me` requests | 2 | 1 | 2, 2, 2, 2, 2 → 1, 1, 1, 1, 1 |
| Protected requests before session check succeeds | 22 | 0 | 22, 22, 22, 22, 22 → 0, 0, 0, 0, 0 |

The measured focus window issued 23 fewer requests per sample, a 95.8% request
count reduction for this journey. PR-02's regression gate also asserts exactly
one session check for paired events and zero protected requests before it
succeeds. This is a request-count result from a deterministic local journey;
the 250 ms hold is a test synchronization window, not a latency measurement.
Raw samples and environment details are in
[frontend-query-focus-comparison.json](frontend-query-focus-comparison.json).

### PR-05 large attendance table comparison

The PR-05 E2E fixture returns 2,000 synthetic candidate rows through a
Playwright API route. It measures navigation to the first visible table row,
then records how many data rows are mounted. The comparison used the PR-04
base (`ac40e22`) and the PR-05 implementation in the same local E2E runner,
Chromium setup, 1280 × 720 viewport, and five-run nearest-rank p75 method. This isolates
browser rendering with the synthetic payload; it does not measure production
API latency or backend query time.

| Metric | PR-04 base | PR-05 | Change |
| --- | ---: | ---: | ---: |
| Navigation to first visible table row, p75 | 3,829 ms | 907.4 ms | 76.3% lower |
| Mounted data rows at initial render | 2,000 | 19 | 99.1% fewer |

Navigation-to-visible p75 ranges and raw samples in milliseconds (n = 5):

- PR-04 base range: 3,094.2–3,980; samples: 3,980; 3,829; 3,788.4; 3,559.7; 3,094.2.
- PR-05 range: 846.4–909.3; samples: 898.4; 846.4; 909.3; 907.4; 846.7.

Both runs used the same 2,000-row fixture. The queue still receives the
complete API array; virtualization bounds the mounted DOM and does not reduce
response size, backend work, or JavaScript data memory. The PR-05 E2E check
also verifies the full row count, scrolling to the final row, keyboard focus
across virtual windows, tab history, in-memory free-text search, and column
visibility. The command was
`OPERATOROS_E2E_GREP='@table-benchmark|@data-reset' OPERATOROS_E2E_PRESERVE_SUCCESS_ARTIFACTS=true timeout 300 make e2e-smoke`.

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

The PR-01 baseline artifacts remain historical reference. PR-02 rollback is
reverting its query policies, session lifecycle, cache headers, focused tests,
and changelog entry together. PR-02 adds no database schema, persisted
application data, or runtime setting. PR-08 rollback reverts the chart's
deferred import and the bundle report/build-budget files together; it changes
no API contract, browser-persisted data, or server authorization.
