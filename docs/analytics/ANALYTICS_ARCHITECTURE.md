# OperatorOS analytics architecture

Status: Phase 16 implementation.

## Ownership

- `@operatoros/contracts` owns framework-neutral TypeBox analytics DTOs.
- `@operatoros/db` owns SQLite access and local data paths.
- `apps/api/src/analytics/queries.ts` owns canonical SQL aggregate queries.
- `apps/api/src/domains/analytics.ts` owns HTTP validation, authorization, and
  response transport.
- `apps/web` owns TanStack Query hooks and Chart.js adapters.

The browser does not own important metric calculations. It formats server
values and maps chart-ready values to Chart.js datasets.

## Canonical API

Phase 16 adds these capability-protected routes:

- `GET /api/analytics/overview`
- `GET /api/analytics/trends`
- `GET /api/analytics/cohorts`

Each route accepts an academic year and optional exact filters. Date ranges
are inclusive ISO dates and must remain inside the academic year. Monthly
absence reasons use their stored month bucket. The API preserves missing
months as `unavailable`, not zero.

Existing report routes remain available for compatibility. Their response
shapes and report-specific metrics do not change. The canonical routes provide
the shared aggregate contract for future reports and Excel work.

## Metric semantics

The metric registry is in [METRICS.md](./METRICS.md). Every metric response
includes its numerator, denominator, unit, and missing-data status.

The API uses SQL `COUNT`, `SUM`, `GROUP BY`, and monthly grouping. It does not
load full source tables into the browser for aggregation. It uses the existing
SQLite schema and adds no rollup table or migration.

`ROUND_HALF_EVEN` to one decimal place matches the accepted report behavior
for these canonical values. Null grade cells are excluded.

## Query and cache policy

The web application has one TanStack Query client. Analytics keys include all
filter values. Successful attendance, grade, and enrollment mutations
invalidate the analytics query family. Logout removes protected query data.
The query cache is memory-only. It is not persisted to `localStorage`.

Deterministic contract, query, and response tests may run through Turbo. Tests
that mutate databases or run runtime workflows remain uncached. Operator data
never enters a task cache.

## Performance decision

`ANALYTICS_ROLLUP_PERSISTENCE=NOT_REQUIRED`.

The initial disposable benchmark uses direct aggregates. For 10, 100, and 500
synthetic students, overview median/p95 times were 0.46/3.85 ms, 1.44/2.52
ms, and 6.21/7.45 ms. The response returned three cohorts at each size.
The SQLite plan review found no need for a new index or persistent rollup.
Future rollups require a new benchmark and explicit review.

## Future consumers

Phase 17 can consume the DTOs without importing SQL. Phase 18 can change
presentation without changing metric definitions. Chart.js remains a web
presentation dependency and does not enter shared contracts.
