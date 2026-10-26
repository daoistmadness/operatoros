---
status: current
last_reviewed: 2026-10-26
---

# Analytics architecture

Analytics calculations are owned by the API. The database package provides
SQLite access; the API builds canonical SQL aggregates and returns TypeBox DTOs;
the web application formats the response and adapts chart data for display.

## Ownership

- packages/contracts owns framework-neutral analytics DTOs.
- packages/db owns SQLite access and schema.
- apps/api/src/analytics owns canonical aggregate queries.
- apps/api/src/domains owns HTTP validation, authorization, and response
  transport.
- apps/web owns TanStack Query hooks and Chart.js presentation adapters.

The browser does not load source tables to calculate canonical metrics. Missing
data remains unavailable rather than being shown as zero.

## Canonical analytics API

The shared aggregate endpoints are:

- GET /api/analytics/overview
- GET /api/analytics/trends
- GET /api/analytics/cohorts

They accept an academic year and supported filters, enforce server-side access,
and return metric definitions with their results. Date ranges use inclusive ISO
dates and must stay inside the selected academic year. The browser route table
and compatibility redirects are maintained separately from these API paths.

Metric definitions live in [the metric reference](../reference/metrics.md).
Report-specific metrics remain owned by their API report services.

## Query and calculation policy

One in-memory TanStack Query client owns analytics state. Keys include every
filter that changes the response; successful data mutations invalidate the
affected analytics queries. Logout clears protected query data. Queries are
not persisted to localStorage.

Aggregates use the current SQLite schema and deterministic server-side SQL.
There is no analytics rollup table. Adding persisted rollups requires a new
benchmark and explicit review.
