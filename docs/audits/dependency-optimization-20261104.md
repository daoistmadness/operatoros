---
status: current
last_reviewed: 2026-11-04
---

# Dependency optimization audit — 2026-11-04

## Scope and method

The baseline is clean `origin/main` at `18a3696c90ffe059cab24987ce7dda9a02e5fbf0`.
The audit reviewed all ten workspace manifests, `bun.lock`, `mise.toml` and
`mise.lock`, workspace scripts, root dependency overrides and patches, Vite and
Tailwind configuration, source and dynamic imports, generated route inputs,
tests, and the production client manifest. `bun outdated --recursive` and
`bun dedupe --check` were read-only. Package removals were checked against
actual imports, package exports, scripts, and runtime owners rather than a
static import scan alone.

The earlier [dependency optimization audit](dependency-optimization.md) is
deprecated because its route and bundle baseline predates the merged TanStack
Start migration. PR #337's dependency cleanup is already merged. At audit
start, no other dependency migration PR was open; PR #356 is unrelated and was
left untouched. This audit's changes are tracked in PR #357.

## Workspace inventory

Counts include direct `dependencies`, `devDependencies`, and `peerDependencies`.
The manifests remain the authoritative list of package names and versions.

| Workspace | Runtime before → after | Development before → after | Peer before → after |
| --- | ---: | ---: | ---: |
| Root | 0 → 0 | 9 → 9 | 0 → 0 |
| `apps/api` | 8 → 8 | 2 → 2 | 0 → 0 |
| `apps/web` | 26 → 24 | 14 → 14 | 0 → 0 |
| `packages/agent-skills` | 0 → 0 | 0 → 0 | 0 → 0 |
| `packages/contracts` | 1 → 1 | 1 → 1 | 0 → 0 |
| `packages/db` | 1 → 1 | 1 → 1 | 0 → 0 |
| `packages/excel` | 3 → 3 | 1 → 1 | 0 → 0 |
| `packages/sheetjs-fork` | 0 → 0 | 0 → 0 | 0 → 0 |
| `packages/ui` | 5 → 5 | 6 → 6 | 2 → 2 |
| `e2e/readiness` | 0 → 0 | 0 → 0 | 0 → 0 |
| **Total** | **44 → 42** | **34 → 34** | **2 → 2** |

Required runtime packages remain with their owners: Elysia and its OpenAPI
adapter in API; Drizzle in DB; ExcelJS for `.xlsx` and the local SheetJS fork
for legacy `.xls`; React, TanStack Start/Router/Query, Radix wrappers, and the
required Chart.js and Unovis surfaces in web; and Base UI, `clsx`, icons, CVA,
and class merging in shared UI. TypeBox remains on the root catalog and is a
runtime dependency wherever schemas are evaluated. Workspace packages remain
declared at the consuming boundary.

Build and test packages remain development dependencies. Dynamic route imports
keep page code split, Router Devtools are dynamically loaded only in
development, and chart modules are lazy-loaded. The web app uses TanStack
Start SPA with TanStack Router; it has no `react-router` or Framer Motion
dependency or import. Existing reduced-motion CSS remains in place.

## Findings and changes

`tailwindcss` and `@tailwindcss/vite` are both 4.2.2, while web and UI each
declared `tailwind-merge` 2.6.1. Upstream documents v3 as the Tailwind 4 line;
[v3.5.0 adds Tailwind 4.2 support](https://github.com/dcastil/tailwind-merge/releases/tag/v3.5.0).
The shared UI package now owns
`tailwind-merge` 3.5.0. Four focused tests cover conflicting base classes,
responsive and state variants, arbitrary values and Tailwind 4 variable
syntax, and project theme colors in light and dark variants.

The web app had three identical `cn()` implementations across
`apps/web/src/lib/cn.ts`, `apps/web/src/lib/utils.ts`, and
`packages/ui/src/lib/utils.ts`. Both web entry points now re-export the
existing public UI utility, preserving their import paths. The two web-only
`clsx` and `tailwind-merge` declarations were then removed: source/config/test
search found no other web consumer. The packages remain in the lockfile
because shared UI still uses them.

No other direct dependency was proven unused. Radix and Base UI serve different
component surfaces; Chart.js and Unovis serve different chart features. No
library replacement or route/animation migration was justified.

## Dependency and security status

- `bun audit`: 0 findings across 635 packages.
- `bun audit --production`: 0 findings across 430 packages.
- Severity counts for JavaScript dependencies: critical 0, high 0, moderate 0,
  low 0.
- `bun dedupe --check`: no dedupeable duplicates among 676 packages.
- `bun.lock`: 690 resolution records, 643 package names, and 32 names with
  multiple resolved versions. Those 32 splits remain required by incompatible
  package ranges or platform/peer contexts; Bun found no safe dedupe operation.

The requested [minimatch advisory GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
(`CVE-2026-118764`, moderate) affects versions below 11.0.1. All installed
paths resolve to patched 11.0.1. `bun pm why minimatch` shows the ExcelJS /
Archiver production path plus development paths through Redocly, ESLint, and
TypeScript ESLint. Existing scoped overrides and Bun/Node compatibility tests
cover those consumers.

The separate [CVE-2026-119373](https://osv.dev/vulnerability/CVE-2026-119373)
finding is not in the JavaScript package graph. The pinned Bun 1.4.4 runtime
reports SQLite 3.53.4 with FTS5 enabled; OSV marks SQLite before 3.54.0
affected by a high-severity FTS5 heap buffer overflow. The API/DB source scan
found no FTS5 table creation or `MATCH` query, but that does not patch the
embedded runtime. The finding remains unresolved and is separately tracked in
the [deployment readiness audit](podman-deployment-readiness.md). This change
does not change Bun or production deployment.

`bun outdated --recursive` also found maintenance updates, including Elysia
1.4.30, JSZip 3.10.2, Drizzle 0.45.4, React Query 5.105.3, Vite 8.3.5, and
current Bun type packages. They were left for focused maintenance work because
they do not address a security finding or the Tailwind compatibility issue.
Breaking upgrades such as Saxes 6, Lucide React 1.x, Vitest 5, and the TypeScript
5.9 to 7 package transition were postponed. The separate `@typescript/native`
TypeScript 7 CLI checker remains unchanged.

## Before and after measurements

Production bundle figures come from the Vite client manifest. Gzip is a
reproducible level-9 estimate, not measured browser transfer. Build durations
are warm repeated builds on the same host and toolchain; run ranges overlap, so
the timing difference is not considered meaningful.

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Direct dependencies, all workspaces | 80 | 78 | -2 |
| Runtime / development / peer declarations | 44 / 34 / 2 | 42 / 34 / 2 | -2 runtime |
| JavaScript audit findings, all / production | 0 / 0 | 0 / 0 | 0 |
| Names with multiple lockfile versions | 32 | 32 | 0; none dedupeable |
| Lockfile resolution records | 690 | 690 | 0 |
| `bun.lock` size | 174,600 bytes | 174,540 bytes | -60 bytes |
| Client JavaScript, raw | 2,228,843 bytes | 2,232,878 bytes | +4,035 (+0.18%) |
| Client JavaScript, gzip-9 estimate | 675,719 bytes | 676,040 bytes | +321 (+0.05%) |
| Emitted client JavaScript chunks | 209 | 207 | -2 |
| Warm web build duration | 4.882–4.934 s (2 runs) | 4.933–5.060 s (3 runs) | No measurable change |
| Web test command duration | 37.518 s | 37.403 s | -0.3%; within noise |
| UI test command duration | 0.497 s | 0.518 s | +0.021 s; within noise |
| Full release gate duration | Not measured | 997 s | No comparable baseline |
| API image size | Not measured | Not measured | API dependencies unchanged |
| Test result | UI 4/4; web 595/595 | UI 8/8; web 595/595 | 4 new UI regression tests; all pass |

Largest emitted client chunks stayed effectively level:

| Chunk | Before raw / gzip | After raw / gzip |
| --- | ---: | ---: |
| Start client entry | 354,817 / 106,623 bytes | 354,717 / 106,591 bytes |
| Shared `dist` chunk | 191,323 / 65,792 bytes | 191,323 / 65,792 bytes |
| `AttendanceStatusChart` | 166,658 / 55,186 bytes | 166,658 / 55,186 bytes |
| `UploadCenter` | 142,308 / 32,462 bytes | 142,308 / 32,459 bytes |

All 54 route entries remain within the 160,000 raw / 40,000 gzip-9 route
budget. The production client output contains no Bun SQLite, Elysia, or Drizzle
markers. The server-side API image was not built because this web/UI change
does not affect it.

## Validation and rollback

- `mise install` and `bun install --frozen-lockfile` passed; the frozen install
  made no changes. `mise.lock` is unchanged.
- The focused UI class-merging suite passed 8 tests; the web suite passed 593
  Vitest tests and 2 bundle-report tests.
- `./scripts/doctor` passed against an S5.4 database bootstrapped in a disposable
  `/tmp` data root. Existing listeners on ports 5173 and 8000 were reported and
  left untouched.
- `./scripts/check` passed, including lint, architecture/type checks, API 437
  tests, web/UI tests, 151 repository script tests, and 9 Python release-bundle
  tests.
- `make e2e-validate` passed. `timeout 300 make e2e-smoke` passed: API 8/8 and
  web 67/67.
- `mise run check:full` passed in 997 seconds. It completed both backend passes,
  frontend checks and build, E2E smoke (API 8/8; web 67/67), all 3 readiness
  browser tests, and cleanup.
- Both JavaScript audit commands and `bun dedupe --check` passed after the
  lockfile change.

Rollback is a regular revert of the dependency PR. It restores the two web
dependency declarations and the prior utility implementations; it changes no
API contract, database schema, runtime, or deployment configuration.

## Remaining recommendations

1. Revisit the embedded SQLite finding when a supported Bun release includes
   SQLite 3.54.0 or later; validate Bun/SQLite behavior in a separate runtime
   change.
2. Profile the 355 kB raw Start client entry before attempting more route
   splitting. Current route budgets pass and most large feature chunks are
   already lazy.
3. Evaluate compatible maintenance updates individually when they address a
   demonstrated issue. Avoid batching the postponed major upgrades with this
   compatibility fix.
