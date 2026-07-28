# Frontend Feature Boundaries

## Decision and implementation scope

Architecture decision:
`ORGANIZE_FRONTEND_BY_FEATURE_WITH_STABLE_PUBLIC_BOUNDARIES_AND_NO_PRODUCT_BEHAVIOR_REWRITE`.

Selected scope: `REPRESENTATIVE_FEATURE_BOUNDARY_FOUNDATION`.

The starting ownership audit inventoried 189 source modules and classified
application shell, routes, route boundaries, feature domains, shared
presentation/infrastructure/utilities, compatibility adapters, generated code,
and tests. Thirty route-associated feature candidates were identified from the
preserved lazy-module inventory. The frontend contains several large pages that
combine feature-specific API, draft, mutation, and presentation behavior, so a
complete reorganization would create an unnecessarily broad behavioral risk.

## Target ownership model

- Application shell and providers orchestrate routes, features, and shared
  infrastructure; they do not own domain behavior.
- Routes may lazy-import only a feature's public `index.ts`, never a feature
  page or other internal directory.
- A feature owns its adapters, queries, components, pages, types, utilities,
  and focused tests. Relative imports within one feature are private.
- Cross-feature imports may use only the target feature's public entry point.
- Shared code is domain-neutral and may import only shared or external code.
- Generated code imports no handwritten code and is never manually edited.
- Only approved feature API adapters may import generated OpenAPI contracts.
- Tests follow the same boundary rules; type-only feature relationships do not
  create runtime graph edges.

There is no root feature barrel. Public feature entry points export only the
route component and narrowly approved functions, hooks, and types. Type
contracts use type-only exports.

## Enforcement

Run from `frontend/`:

- `npm run boundaries:check`
- `npm run boundaries:test`

The deterministic repository script reports both importer and target and
enforces:

- `NO_CROSS_FEATURE_DEEP_IMPORTS`
- `NO_SHARED_TO_FEATURE_IMPORTS`
- `NO_DIRECT_GENERATED_IMPORTS`
- `NO_ROUTE_DEEP_IMPORTS`
- `NO_GENERATED_TO_HANDWRITTEN_IMPORTS`
- `NO_NEW_CIRCULAR_FEATURE_DEPENDENCIES`

Fifteen fixture tests cover allowed public/relative/external/type-only imports,
every prohibited direction, runtime feature cycles, test policy, and diagnostic
paths. Final production results contain zero violations and zero runtime
feature cycles.

## Migrated representative features

### Readiness

Classification: `MIGRATED_FEATURE_READINESS`.

The generated-contract adapter, query, setup overview component, and 15 focused
tests now live under `src/features/readiness/`. Dashboard consumes its public
entry point. The adapter remains the only handwritten owner allowed to import
the generated readiness contract. Runtime validation, `ApiError`, query key,
retry, cancellation, and response behavior are unchanged.

### Jenjang configuration

Classification: `MIGRATED_FEATURE_JENJANG_CONFIG`.

The page and its 14 focused tests live under
`src/features/jenjang-config/`. The route lazy-imports only the public entry
point. Existing API paths, authorization, error copy, normalization, and
presentation remain unchanged. Two source-inspection integration tests were
updated to follow the authoritative path.

### Operator work queue

Classification: `MIGRATED_FEATURE_OPERATOR_WORK_QUEUE`.

The API adapter, query, page, and four focused API/query tests live under
`src/features/operator-work-queue/`. The route and external deployment/correction
consumers use its public entry point. Query keys, signal forwarding,
authorization wrappers, mutation payloads, and workflow behavior are unchanged.

There are three public feature entry points and no transitional compatibility
exports.

## Deferred ownership

Twenty-seven route-associated candidates remain in their current coherent
locations. Upload/reconciliation, corrections, follow-ups, enrollment,
progression, student management, academic management, reports/analytics,
backup/restore, and other configuration domains combine broader API,
presentation, or mutation dependencies. They should move one feature per
validated wave; this milestone does not claim them as reorganized.

Existing `components/`, `context/`, `api/`, `hooks/`, `lib/`, and remaining
`pages/` are retained until their ownership is proven. Code is not renamed or
moved into shared merely to satisfy a visual directory shape.

## Validation evidence

- Boundary rule fixtures: 15 passed.
- Production boundary check: passed with zero violations.
- API generation drift: none.
- TypeScript diagnostics: 0.
- Handwritten suppressions, new broad `any`, and unsafe double casts: none.
- Focused migrated-feature tests: 38 passed
  (readiness 15, Jenjang/route 19, operator/route 9; route tests overlap).
- Bun: 55 files and 292 tests passed; build passed.
- Node: 55 files and 292 tests passed; build passed.
- Routes: 34; routes removed or changed: 0.
- Lazy page modules: 30; lazy boundaries removed: 0.
- Initial entry: 114.85 kB gzip, unchanged and below 120.59 kB.
- Raw OpenAPI and generator code are absent from browser runtime chunks.
- Canonical E2E: backend 7 passed; web 14 passed; desktop skipped by the
  existing infrastructure boundary.
- Product failures: 0.

The protected database checksum and stat remained unchanged. Immutable
query-only inspection reported 117 students, 3,651 attendance rows, zero
enrollments, schema `20260724_s42`, successful integrity and quick checks, zero
foreign-key violations, and no sidecars. There are no backend, API, schema,
route, authorization, or product behavior changes.
