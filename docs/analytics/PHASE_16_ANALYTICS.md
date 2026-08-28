# Phase 16 analytics evidence

Status: local implementation evidence

Base: `5a85f717805c8d22a04006f5afe475d8eaaf3213`

## Implementation

- The canonical metric registry defines `attendance_rate` and
  `grade_average`.
- The API exposes `overview`, `trends`, and `cohorts` routes.
- SQLite computes important aggregates with SQL counts, sums, grouping, and
  monthly buckets.
- The API returns numerator, denominator, unit, and missing-data status.
- The web application uses one in-memory TanStack Query client.
- Query keys include all filters. Logout does not retain protected analytics
  data. Query data is not persisted to `localStorage`.
- Chart.js remains a presentation adapter.
- Attendance, grade, and enrollment mutations invalidate analytics queries.
- No persistent analytics rollup tables were added.

## Semantics and performance

- Date ranges are inclusive ISO dates inside the selected academic year.
- Attendance rates count on-time and late records as present.
- Stored absence month buckets supply sakit, izin, and alfa counts.
- Null grade scores are excluded.
- Canonical values use one-decimal `ROUND_HALF_EVEN` rounding.
- Zero and unavailable values use separate contract statuses.
- Existing report behavior remains compatible. New canonical routes use the
  documented metric definitions.
- A disposable benchmark used 10, 100, and 500 synthetic students.
  Overview median/p95 times were 0.46/3.85 ms, 1.44/2.52 ms, and 6.21/7.45
  ms. The query plan showed no required new index.
- `ANALYTICS_ROLLUP_PERSISTENCE=NOT_REQUIRED`.

## Validation

- Analytics tests: 6/6, 35 expectations.
- API tests: 79/79, 551 expectations.
- Web tests: 303/303.
- Contracts tests: 2/2, 19 expectations.
- DB tests: 11/11, 30 expectations.
- UI tests: 3/3, 9 expectations.
- Security tests: 17/17, 100 expectations.
- Retained Python tooling: 60 passed, 1 warning.
- Architecture fixtures: 27/27.
- Turbo invalidation proofs: passed.
- Isolated Turbo cold run: 11/11, 0 cached.
- Isolated Turbo warm run: 11/11, 11 cached.
- OpenAPI contract checks: passed.
- Frontend build: passed.
- E2E smoke: backend 7/7 and browser 19/19.
- Full E2E: passed with 79 API tests, 303 web tests, and a passing build.
- Protected operational database access: no.
- Operator-owned backup modification: no.

## Scope controls

- `@tanstack/react-query` is the only Phase 16 primary dependency addition.
- Chart.js was retained.
- TanStack Router and TanStack Form were not added.
- Zod was not added.
- Excel consolidation and broad UI redesign did not start.
- Phase 17 did not start.
- Phase 15 security controls remain unchanged.
- GitHub provider cleanup remains `PROVIDER_HISTORY_CLEANUP_PENDING` for 72
  managed pull refs. Provider garbage collection remains unverified.
