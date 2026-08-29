# Phase 19 Router and Form assessment

Base: `c6995d7b5c400b2a60c3eea3adcb56834c95526a`

Assessment date: 2026-08-29

This phase made no source or dependency changes. It records two independent
architecture decisions.

## Official documentation check

The assessment consulted the current official documentation before any
package installation:

- [TanStack Router overview](https://tanstack.com/router/latest/docs/overview)
- [TanStack Form overview](https://tanstack.com/form/latest/docs/overview)
- [React 19 release](https://react.dev/blog/2024/12/05/react-19)
- [TanStack Query React overview](https://tanstack.com/query/latest/docs/framework/react/overview)
- [TanStack Table overview](https://tanstack.com/table/latest/docs/overview)

Current npm registry metadata on the assessment date reports:

- `@tanstack/react-router`: `1.170.32`, React peer `>=18.0.0 || >=19.0.0`
- `@tanstack/react-form`: `1.33.5`, React peer `^17.0.0 || ^18.0.0 || ^19.0.0`

React `19.2.4` meets both peer ranges. The packages were not installed. No
runtime compatibility test was needed because the evidence did not justify
either dependency.

TanStack Table remains `8.21.3` in this repository. Current Table
documentation now presents a newer major version. Phase 19 does not upgrade
Table because no table limitation is in scope.

## Router assessment

### Current implementation

`apps/web` uses `react-router-dom` `7.18.2`.

- `BrowserRouter`, `Routes`, and `Route` are declared once in `App.tsx`.
- `routeDefinitions.tsx` is the single route metadata table.
- `RequireAuth` owns the protected layout boundary.
- `protectRoute` applies role and capability guards from route metadata.
- Lazy route imports provide route-level code splitting.
- Two legacy redirects remain explicit: `/mapping` to `/enrollment`, and
  `/reports` to `/reports/monthly`.
- The wildcard route renders the existing not-found state.

### Inventory

| Item | Count | Evidence |
| --- | ---: | --- |
| Application route paths | 37 | 1 public login path and 36 authenticated entries, including the wildcard |
| Protected route entries | 36 | All entries under the `RequireAuth` route |
| Role-sensitive entries | 10 | `adminOnly()` metadata |
| Capability-sensitive entries | 13 | `capability()` metadata |
| Authenticated-only entries | 13 | `authenticated()` metadata |
| Parameterized route entries | 3 | Staff and student detail paths |
| Routes with URL search state | 1 | `/staff` uses `useSearchParams` |
| Manual route/search parser | 1 | `StaffManagement.tsx` reads and writes the staff filters |
| Imperative route assignments | 3 | Existing `window.location` assignments in `StudentManagement.tsx` |
| Shared auth guard implementations | 3 | `RequireAuth`, `RequireRole`, and `RequireCapability` |
| Route-specific navigation helper | 0 | Pages use `Link`, `useNavigate`, or the central route table |
| Routing authorities | 1 | React Router |

The three `URLSearchParams` uses in API modules build request query strings.
They do not parse browser route state. Only `StaffManagement` uses browser
search state.

### Reproducible limitation review

The audit found two minor patterns:

1. One page manages staff filters with `useSearchParams` and a small local
   setter.
2. Student management has three imperative full-page assignments. They are
   simple same-origin destinations. They do not create a second router.

These patterns do not cause a reproduced defect. Current route tests cover the
route table, redirects, wildcard handling, guard behavior, navigation-group
matching, and error recovery. The focused baseline passed 34 tests.

The existing alternative is sufficient:

- Keep route paths in `routeDefinitions.tsx`.
- Use React Router links for navigation.
- Keep search state local unless refresh or sharing needs URL state.
- Add a small local search helper only if more pages need the same behavior.

The audit found zero `REAL_LIMITATION` items. It found no redirect loop,
navigation race, auth-wrapper defect, unsafe parameter cast, or deep-link
failure that a new router would fix.

### Decision

`ROUTER_NOT_REQUIRED`

TanStack Router remains absent. There is one routing authority. No migration
or dependency change is justified.

## Form assessment

### Current implementation

`apps/web` uses native controlled forms and shared `Form`, `FormField`,
`FieldLabel`, `FieldError`, `Input`, `Textarea`, and select primitives. Pages
use `useState` and TanStack Query mutations. No form library is installed.

The source inventory found 27 native `<form>` elements and two shared `Form`
uses. This gives 29 runtime form workflows across 17 source files.

### Inventory

| Item | Count | Evidence |
| --- | ---: | --- |
| Runtime form workflows | 29 | 27 native forms and 2 shared `Form` usages |
| Complex form workflows | 8 | Multi-field, cross-field, bulk-grid, repeated-list, or draft-state workflows |
| Dynamic field-array forms | 0 | No form library-style field-array abstraction exists |
| Dynamic form-like editors | 3 | Class attendance roster, grade matrix, and student profile repeated data |
| Confirmed cross-field validation forms | 1 | Setup password and password confirmation |
| Dedicated async field validation forms | 0 | Async work is submit-time server mutation |
| Unsaved-change tracking workflows | 3 | Class attendance, grade matrix, and jenjang cutoff |
| `useReducer` form implementations | 0 | Source search |
| Form libraries | 0 | No React Hook Form or TanStack Form reference |

The eight complex workflows are:

- setup administrator password confirmation;
- student creation and confirmation;
- class-mapping student creation;
- attendance correction request and review;
- class attendance roster editing;
- grade matrix editing;
- the composite student profile editor;
- management intervention editing.

The bulk editors use stable records, explicit dirty state, bounded inputs, and
one mutation path. They are not ordinary field-array forms.

### Reproducible limitation review

The audit found repeated local state patterns because the workflows have
different fields and different server operations. It found no repeated dirty
state defect, field-array defect, cross-field synchronization defect, async
validation defect, or server-error mapping defect.

The existing alternative is sufficient:

- Keep simple forms native.
- Keep shared field accessibility behavior in the existing primitives.
- Keep server validation and authorization in the API.
- Keep bulk editor state local to its domain component.
- Extend the existing error helper only when a real repeated mapping appears.

The audit found zero `REAL_LIMITATION` items. The current code does not need a
new form state authority.

### Decision

`FORM_NOT_REQUIRED`

TanStack Form remains absent. No migration or dependency change is justified.

## Decision matrix

| Feature | Current limitation | Evidence | Severity | Alternative without dependency | Migration cost | Benefit | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TanStack Router | None that affects correctness or maintenance | 37 route paths, one route authority, tested guards and redirects, one URL-state page | None | Keep React Router 7 and central route metadata | High, full route migration and E2E parity | No measured benefit | `ROUTER_NOT_REQUIRED` |
| TanStack Form | None that affects correctness or maintenance | 29 workflows, zero field-array abstractions, zero reproduced form-state defects | None | Keep native forms and shared field primitives | High, adapter and validation migration across eight complex workflows | No measured benefit | `FORM_NOT_REQUIRED` |

These decisions are independent. Neither package is installed.

## Preserved architecture

- TanStack Query remains the server-state authority at `5.101.2`.
- One `QueryClient` remains in use.
- Protected query data is cleared on logout or session loss.
- Query persistence to `localStorage` remains zero.
- TanStack Table remains `8.21.3`.
- Chart.js remains the chart library.
- Browser authoritative analytics calculations remain zero.
- TypeBox remains the API contract authority.
- Zod remains absent.
- Phase 15 security controls remain unchanged.
- Phase 17 Excel architecture remains unchanged.
- Phase 18 CI concurrency and cache strategy remain unchanged.
- No database migration occurred.

## CI impact

Phase 18 merged-main CI remains the accepted `2m00s` baseline. This phase
changed only assessment documentation. It added no package, test, workflow,
or build work. It reintroduced no duplicate expensive validation.

Measured Phase 19 PR CI run `33227235892` completed in about `1m45s`. Its
critical API job took `1m42s`; frontend took `17s`; docs took `10s`.

Measured merged-main CI run `33227420488` completed in about `1m56s`. Its
critical API job took `1m53s`; frontend took `17s`; docs took `11s`.

The Phase 18 concurrency `4` and cache configuration remained unchanged. No
duplicate expensive validation returned. The measured result shows no
material CI regression.

The documentation-only runs did not trigger the path-filtered E2E workflow.
Manual PR run `33227247699` passed in `3m25s`. Manual merged-main run
`33227435136` passed in `3m30s`.

## Validation record

The following checks are required for the final gate:

- focused route and form baseline: 34/34 tests passed;
- frozen workspace install: passed;
- full security, analytics, query-key, Excel, architecture, package, build,
  OpenAPI, database, and E2E checks: recorded after the documentation commit;
- new Router/Form dependency audit exceptions: 0;
- protected database access: no;
- operator-owned backup changes: no.

## Final decisions

```text
ROUTER_NOT_REQUIRED
FORM_NOT_REQUIRED
```

Next milestone: `OPERATOROS_POST_MIGRATION_MODERNIZATION_FINAL_AUDIT`
