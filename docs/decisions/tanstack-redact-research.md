---
status: current
last_reviewed: 2026-10-29
---

# TanStack Redact research

## Decision

Keep React 19 as OperatorOS's production renderer. Do not adopt TanStack Redact
based on this evaluation. The isolated Redact build is opt-in research tooling
and is not part of the production Vite configuration.

The Redact build reduced emitted JavaScript and initial browser transfer, and
the first Academic Analytics SPA visit was faster in the two local Redact
samples. Other navigation and responsiveness readings were mixed or slower.
More importantly, Redact repeatedly failed the employee-import workflow in
Chromium and Firefox and failed the virtual table's final-row assertion in
Chromium. Those parity failures rule out production adoption regardless of
bundle savings.

Reconsidering the production renderer needs a separate architecture decision
after the compatibility failures are understood and fixed. PR-10 release
validation does not depend on Redact.

## Scope and implementation

This study compared the existing optimized React app with `@tanstack/redact`
0.2.3 on an isolated Vite config and separate `build-redact` output. The normal
`vite.config.js` and production build keep React. The E2E runner selects Redact
only when `OPERATOROS_E2E_REDACT=true`; its default remains React. No application
API, schema, authorization policy, database, or production runtime setting
changed.

The app uses React 19.2.7, Vite 8.3.4, TanStack Router, Query, Form, Table,
Virtual, Radix primitives, Suspense, lazy route chunks, and `useLayoutEffect`.
The source has no `useTransition`, `useDeferredValue`, `useActionState`, or
`useOptimistic` usage. The app does not depend on Framer Motion. TanStack's
[compatibility notes](https://tanstack.com/redact/latest/docs/compatibility)
describe Redact's synchronous renderer and document React API behavior;
its [overview](https://tanstack.com/redact/latest/docs/overview) explains the
trade-off against React's concurrent scheduler. These docs informed the test
matrix but do not replace testing the actual application.

## Production build comparison

Both builds used Bun 1.4.4, Vite 8.3.4, production mode, the same route source,
and the repository's 48 lazy route entries. The gzip sum compresses each
emitted JavaScript file independently at level 9; it estimates bundle size and
is not a browser transfer measurement.

| Measure | React 19.2.7 | Redact 0.2.3 | Change |
| --- | ---: | ---: | ---: |
| Emitted JavaScript files | 126 | 140 | +14 |
| Total emitted JavaScript, raw | 2,118,427 bytes | 1,904,979 bytes | −213,448 (−10.1%) |
| Total emitted JavaScript, gzip sum | 622,575 bytes | 586,927 bytes | −35,648 (−5.7%) |
| Largest route entry, raw | 142,131 bytes | 130,662 bytes | −11,469 bytes |
| Largest route entry, gzip | 32,615 bytes | 32,234 bytes | −381 bytes |

All React route entries passed the existing 160,000 raw / 40,000 gzip byte
budget. The Redact manifest also had 48 route entries; its largest raw and gzip
entries were below those limits. The complete manifest-derived measurements
are in [the sample artifact](../reference/tanstack-redact-comparison-samples.json).

## Browser measurements

Two five-context batches per runtime ran on Chromium 149.0.7827.55, Linux x64,
Node 24.19.0, one Playwright worker, a 1365 × 900 viewport, and unthrottled
local loopback. Each browser context was new and preview responses used
`Cache-Control: no-store`. The batches ran in alternating runtime order while
host load increased. Values below are each batch's nearest-rank p75 and range;
the batches remain separate instead of being pooled. This is local lab data,
not a field percentile.

| Measure | React A1 | Redact R1 | React A2 | Redact R2 |
| --- | ---: | ---: | ---: | ---: |
| Dashboard document ready | 407 ms (366–416) | 452 ms (430–506) | 389 ms (360–616) | 470 ms (425–493) |
| First Academic Analytics SPA visit | 539 ms (529–587) | 382 ms (322–393) | 551 ms (504–1,029) | 347 ms (325–363) |
| Repeat Academic Analytics SPA visit | 191 ms (162–196) | 231 ms (200–235) | 203 ms (168–203) | 227 ms (173–236) |
| Initial JavaScript transfer | 193,799 bytes | 164,138 bytes | 193,799 bytes | 164,138 bytes |
| First Academic route transfer | 71,513 bytes | 71,463 bytes | 71,513 bytes | 71,463 bytes |
| Dashboard LCP lab sample | 392 ms (376–404) | 452 ms (428–492) | 404 ms (356–588) | 468 ms (432–476) |
| Chromium heap used | 13.4 MB (12.7–14.3) | 11.2 MB (10.0–16.1) | 14.3 MB (10.0–14.3) | 10.0 MB (10.0–16.1) |
| Maximum raw Event Timing duration | 80 ms (80–88) | 120 ms (112–136) | 80 ms (72–88) | 120 ms (104–120) |
| Long-task count, p75 | 2 | 8 | 2 | 8 |
| Total long-task duration, p75 | 126 ms (116–133) | 591 ms (532–652) | 131 ms (120–139) | 569 ms (525–574) |

The 29,661-byte (15.3%) lower initial transfer is a concrete local payload
difference. The first lazy route transfer was effectively unchanged. The first
route visit was faster in both Redact batches, while dashboard readiness, the
repeat route visit, LCP, maximum Event Timing, and observed long-task duration
were worse in both Redact batches. The host load differed between batches, so
these readings do not establish that Redact caused each timing difference.
They do not support an overall speedup claim. Event Timing maxima are not INP;
the long-task observer is a lab proxy, not a direct interaction metric. Heap
readings are noisy and are not a memory-retention or leak test. The
official [performance notes](https://tanstack.com/redact/latest/docs/performance)
also caution that microbenchmarks do not establish whole-application results.

## Compatibility results

Tests used the E2E runner's synthetic SQLite fixture. No student, staff, or
school records were used.

| Browser and runtime | Result |
| --- | --- |
| Chromium, Redact | 16 pass, 3 fail in the 19-test matrix. Employee import reached the root route-error screen; the virtual table lost the final row; the mobile navigation focus test failed. |
| Chromium, React control | 4 pass, 1 fail in the targeted control. The same mobile navigation focus test failed under React. Employee import and the virtual table passed. |
| Firefox, Redact | 11 pass, 1 fail. Employee import reached the root route-error screen. The table passed on a repeat run after one earlier query-filter URL assertion failure. |
| Firefox, React control | 12 pass, 0 fail. |
| Chromium and Firefox, both renderers | The root route error boundary, retry control, and safe dashboard link test passed. |
| WebKit | Not run: the host lacks GTK 4, Graphene, and GStreamer libraries required to launch Playwright WebKit. |

The Chromium virtual-table timings were similar for scrolling but do not show
functional parity: React passed final-row visibility and `aria-rowindex` at a
69.8 ms p75 scroll time; Redact recorded 67.6 ms but failed the final-row
assertion. Firefox table p75 scroll times were 93 ms for React and 88 ms for
Redact, with both passing on the final recorded run. Samples and run details
are in the [comparison artifact](../reference/tanstack-redact-comparison-samples.json).

Authentication and navigation cases in the exercised matrix passed except for
the shared mobile focus failure. E2E continues to use the backend as the
authorization authority. This research did not change auth storage, Query
cache behavior, or persistent browser state. It found no cross-identity data
exposure, but the limited synthetic matrix is not a comprehensive security
review.

## Runner correction

The E2E stack previously inherited the backend's `NODE_ENV=test` into frontend
Vite builds. PR-09 changes the frontend build and preview subshell to
`NODE_ENV=production`; the API remains in test mode. React E2E now invokes the
regular build command and therefore applies the route-chunk budget. This makes
PR-09's builds representative of production mode. The earlier PR-01 through
PR-08 browser measurements remain in the baseline page as historical values
and are not directly comparable to these corrected builds.

## Validation, limitations, and rollback

| Command or scenario | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed; no lockfile changes. |
| `bun run test:web` | Passed: 121 web test files, 577 tests; bundle-report tests also passed (2 tests). |
| `bun run typecheck` | Passed for workspace packages and launcher. |
| `bun run check:architecture` and `hk check --all` | Passed; 4,690 source edges, 71 manifest dependencies, zero architecture exceptions; lint passed. |
| `bun run build` | Passed; 126 JavaScript files, 48 route entries, zero route budget violations. |
| `cd apps/web && bun run build:redact` | Passed; 140 JavaScript files. Manifest analysis found 48 route entries and zero route budget violations. |
| `make e2e-validate` | Passed: 16 workspace tests, 8 readiness-seeder tests, and 8 result-summary tests. |
| Chromium compatibility matrix and React control | Redact: 16 passed, 3 failed in 19 tests. React control: 4 passed, 1 failed. Runner selected the Redact compatibility, table benchmark, employee, error recovery, auth, command search, and data reset tags; Redact used `OPERATOROS_E2E_REDACT=true`. |
| Firefox compatibility matrix | Redact: 11 passed, 1 failed. React: 12 passed, 0 failed. The same tags were selected; Redact used `OPERATOROS_E2E_REDACT=true`. |
| Markdown links, organization, current developer docs, and `git diff --check` | Passed. |
| Invalid `OPERATOROS_E2E_REDACT=maybe` | Rejected with exit status 2 and a clear diagnostic. |

The Redact Chromium matrix command was:

```sh
OPERATOROS_E2E_REDACT=true OPERATOROS_E2E_BROWSER=chromium OPERATOROS_E2E_GREP='@redact-compat|@table-benchmark|@employees|@error-recovery|@auth|@navigation-command-search|@data-reset' OPERATOROS_E2E_PRESERVE_SUCCESS_ARTIFACTS=true timeout 300 make e2e-smoke
```

The Firefox matrix used the same command with
`OPERATOROS_E2E_BROWSER=firefox`. React controls left
`OPERATOROS_E2E_REDACT` unset, which selects the default React build.

Chromium and Firefox E2E were exercised; the failures above remain
documented. WebKit could not launch in this host. `mise run test:fast` was not
run because its classifier would invoke database and fresh-parity checks
outside the permitted E2E database root; CI-only full E2E was not run.
Performance samples are unthrottled local measurements and do not provide
field p75, true INP, mobile performance, memory retention/GC behavior, or a CPU
profile.

The rollback is a focused revert of the research Vite config, dev dependency,
E2E runtime selection, compatibility/measurement instrumentation, and this
decision record. No API, schema, migration, or persistent user data changed.

TanStack Redact 0.2.3 was current at the time of the study; see the
[official release history](https://github.com/TanStack/redact/releases).
