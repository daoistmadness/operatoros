---
status: current
last_reviewed: 2026-10-29
---

# Frontend release validation

## Release status

The consolidated validation ran against the cumulative frontend work through
PR-10. Production still uses React. `mise run check:full` passed, and the full
Chromium and Firefox smoke suites completed without failures. WebKit was not
run because its required host libraries are unavailable; this remains the only
browser-validation gap.

## Production-mode baseline comparison

The old PR-01 through PR-08 browser readings were made with `NODE_ENV=test`
inherited by the Vite frontend build. They are retained in the
[frontend baseline](frontend-performance-baseline.md) as historical context,
but are not used for this comparison. Instead, the baseline was regenerated
from commit `cc536b80c6f919dbf23ce5decb7f8be0c90224e3` in an isolated source
tree. Only that tree's E2E frontend build subshell was changed to set
`NODE_ENV=production`; the API remained in test mode. The final sample used the
current production React build and normal route-budget check.

Both five-context runs used Chromium 149.0.7827.55, Node 24.19.0, Linux x64,
1365 × 900, one Playwright worker, unthrottled loopback, and the same
`seed-test-database` helper. The helper is unchanged between the baseline and
current revision. React 19.2.7, React DOM 19.2.7, TanStack Query 5.104.2,
TanStack Router range `^1.170.46`, and Vite 8.3.4 also match. The baseline and
current samples were captured 82 seconds apart. Host load was not recorded in
either JSON report, so timing deltas remain local observations rather than
controlled speedup claims. Raw per-run values and environment metadata are in
the [comparison artifact](frontend-release-validation-samples.json).

These five-run timings were captured before the final mobile-drawer focus fix.
The fix addresses keyboard focus and modal boundaries; no performance claim is
attributed to it. The final bundle size below was measured after the fix.

| Measure | PR-01 production baseline | Current React | Difference |
| --- | ---: | ---: | ---: |
| Login form ready, p75 | 548 ms (506–557) | 536 ms (509–559) | −12 ms |
| Dashboard document ready, p75 | 619 ms (574–633) | 422 ms (370–448) | −197 ms |
| First Academic Analytics SPA visit, p75 | 531 ms (516–999) | 548 ms (516–589) | +17 ms |
| Repeat Academic Analytics SPA visit, p75 | 195 ms (181–210) | 178 ms (155–201) | −17 ms |
| Table filter / sort, p75 | 117 / 84 ms | 112 / 81 ms | −5 / −3 ms |
| Initial JavaScript transfer | 187,666 bytes | 193,786 bytes | +6,120 bytes (+3.3%) |
| First Academic route transfer | 71,511 bytes | 71,511 bytes | No change |
| Dashboard LCP lab sample, p75 | 604 ms (584–620) | 416 ms (372–452) | −188 ms |
| CLS lab sample, p75 | 0.01796 | 0.0000083 | Lower in the current sample |
| Maximum raw Event Timing duration, p75 | 80 ms (72–80) | 80 ms (80–80) | No change |

The final React build emitted 126 JavaScript files totaling 2,118,840 raw bytes
and 622,692 bytes in the independent gzip sum; all 48 route entries passed the
existing budget. The lower dashboard-ready and LCP readings coexist with a
slightly slower first route visit and higher initial transfer. Event Timing is
not INP. Current heap readings were 13.4 MB p75 (10.0–15.2 MB) versus the
baseline's 10.0 MB; heap sampling is GC-sensitive and does not establish a
memory leak or retention regression. No overall performance gain is claimed.

## Release regression matrix

| Check | Result |
| --- | --- |
| `mise run check:full` | Passed; release runner completed in 16m36s with `tier_result=passed`. |
| Fresh SQLite parity and protected-database safety | Passed. The release runner isolated its data under a disposable temporary root. |
| Backend release tests | 420 passed, 0 failed across 71 files, twice. Two passes were required because the working tree had no committed comparison range. |
| TypeBox/contracts, API and web typechecks, dependency and Node checks, frontend boundaries, OpenAPI drift, UI boundaries | Passed. |
| Web tests and production build | 121 web test files / 578 tests passed; 2 bundle-report tests passed. Build emitted 126 JS files and passed all 48 route-entry budgets. |
| `make e2e-validate` | Passed: 16 workspace, 8 readiness-seeder, and 8 summary tests. |
| Chromium full smoke | Backend 8/8; browser 63 passed, 0 failed, in 4m28s. The two opt-in measurement tests were skipped. |
| Firefox full smoke | Backend 8/8; browser 61 passed, 0 failed, 4 skipped, in 5m57s. Two skips are Chromium-only PDF checks; two are opt-in measurements. |
| `make e2e-readiness` | Passed: 3/3 readiness browser tests. |
| WebKit | Not run; host libraries required by Playwright WebKit (GTK 4, Graphene, and GStreamer) are unavailable. |

The first release attempt exposed three test or interaction problems, all
covered by passing final browser runs. The mobile drawer now owns its close
control and focus trap; the trigger and skip link are inert while the modal is
open, and Escape or close returns focus to the trigger. The attendance identity
test requires horizontal overflow at 1024px, where the table must scroll, while
allowing wider layouts to fit; sticky identity and column alignment remain
checked at each viewport. Firefox no longer receives Playwright's unsupported
`clipboard-read` permission; it verifies successful copy feedback, while
Chromium also checks the copied text. The full Firefox run preserved its
successful synthetic-data artifacts in ignored `e2e-results/`.

The [PR-09 Redact study](../decisions/tanstack-redact-research.md) remains a
research-only result: Redact fails employee import in Chromium and Firefox and
loses a virtual table row in Chromium. It is not the production runtime.

## Security, limitations, and rollback

The release and browser tests used only disposable synthetic SQLite data. No
operational database, student, staff, or school record was accessed. The
release backend suite covered authentication/session handling, role and
capability enforcement, protected database paths, backup/restore integrity,
and data-reset protections. No production API, database schema, migration, or
authorization behavior changed in this validation phase.

WebKit remains untested because the host lacks GTK 4, Graphene, and GStreamer.
The local measurements do not represent field percentiles and do not provide
true INP, throttled network, mobile-device performance, a CPU profile, or
memory-retention evidence. The old PR-01 through PR-08 browser values remain
non-comparable because they were collected with a test-mode frontend build.

PR-10 adds release validation documentation and the mobile navigation focus
correction. Rollback is a focused revert of the AppShell/SidebarNav change,
its unit and E2E coverage, the attendance and clipboard E2E adjustments, and
this report, sample artifact, index link, and changelog entry. No database
rollback is applicable. No backend authorization, API contract, or production
renderer behavior changed.
