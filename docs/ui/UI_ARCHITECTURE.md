# OperatorOS dashboard UI architecture

Status: Phase 18 implementation.

## Dashboard hierarchy

The primary dashboard follows this order:

1. Page context and title.
2. Reporting-period filters.
3. Readiness and mapping warnings.
4. Executive summary.
5. KPI cards.
6. Attendance review summary.
7. Trend and class comparison charts.
8. Operational drilldowns.

Each section answers an operator question. The page keeps the existing
OperatorOS visual identity and layout conventions.

## Ownership

- `@operatoros/ui` owns reusable presentation primitives.
- `apps/web` owns dashboard composition and domain components.
- `apps/web` owns Chart.js adapters.
- `apps/api` and Phase 16 analytics queries own business metric computation.

The dashboard uses one TanStack Query client. Dashboard keys include the
selected month and year. Logout removes protected query data. Query data is
not persisted to `localStorage`.

The dashboard reads the server snapshot through
`useDashboardSnapshotQuery`. Browser code formats values, selects visible
rows, and adapts data for Chart.js. It does not calculate important metrics.

## Shared primitives

The UI package provides `Button`, `Card`, `Dialog`, and `Input` with Base UI
components where applicable. Dashboard-specific layout and data components
remain in `apps/web`.

`@tanstack/react-table` `8.21.3` remains available for the existing bounded
student management table. Phase 18 does not add a dashboard grid. The
dashboard uses the existing accessible table primitives because its lists are
small and bounded.

## States and access

Dashboard sections distinguish loading, empty, stale-refresh error, and
successful data. A refresh error keeps the last successful result visible and
offers a retry. Missing percentages display `Not available`.

The page uses semantic headings, labelled controls, keyboard-accessible
buttons and links, visible focus styles, table headers, status announcements,
and non-color text labels. Existing responsive coverage checks desktop,
tablet, and narrow mobile layouts.

## Performance boundary

The dashboard makes one snapshot query for its dashboard data. Period changes
change the query key. Class mapping invalidates only the active dashboard
snapshot. Chart adapters do not own query state or business formulas.
