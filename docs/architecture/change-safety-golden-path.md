# OperatorOS Change Safety & Feature Golden Path

Status: mandatory engineering guidance for new and substantially changed work

Audit base: `origin/main` at `7480b7f1e4c48676315f07cfaf07f0905e8de4c4`

This document defines ownership and validation conventions. It does not
require a repository-wide refactor. Stable untouched features remain in place.

## 1. Purpose

OperatorOS has one rule for reducing cross-layer drift:

```text
one canonical authority
    -> one canonical interpretation
    -> one shared contract
    -> many consumers
```

Important boundaries must also have executable invariants. This directly
addresses demonstrated failures:

- duplicated schema-head authority produced stale schema reporting;
- `student_name` versus `full_name` produced blank names in the browser;
- duplicated readiness guards produced inconsistent setup decisions;
- scattered invalidation left related views stale.

The golden path uses existing Bun, TypeScript, Elysia, Drizzle, SQLite,
TypeBox, React, TanStack Query, Playwright, and repository checks. It is not an
internal framework.

## 2. Current source audit

The current source at the audit base is authoritative. The approved Setup &
Readiness specification and this audit use the same base. `SPEC_DRIFT` is
`NONE MATERIAL`.

Current ownership:

| Area | Authority | Boundary |
| --- | --- | --- |
| Browser bootstrap | `apps/web/src/index.tsx` | Creates React root and the single in-memory `QueryClientProvider`. |
| Application shell | `apps/web/src/App.tsx` | Router, `SetupBoundary`, auth, protected shell, lazy loading, and route error/loading handling. |
| Route inventory | `apps/web/src/routes/routeDefinitions.tsx` | Reachable route modules and route authorization. |
| API composition | `apps/api/src/app.ts` | Elysia application, security, database, and domain route composition. |
| Persistence | `packages/db` | SQLite lifecycle, Drizzle schema, migrations, data paths, and schema manifest. |
| Public contracts | `packages/contracts` | Cross-boundary TypeBox schemas and types. |
| Generic UI | `packages/ui` | Domain-neutral presentation primitives. |
| Domain UI | `apps/web` | OperatorOS pages, feature adapters, forms, queries, and navigation. |
| Excel | `packages/excel` | ExcelJS `.xlsx` and the existing legacy `.xls` adapter. |
| Retained tooling | `backend/` | Historical migration, fixture, operational, and selected validation tooling; not production runtime. |
| Validation/runtime scripts | `scripts/` | Startup, sessions, database helpers, architecture, OpenAPI, and test tiers. |
| Browser regression | `e2e/` | Synthetic data, invocation-owned runtime roots, dynamic ports, and Playwright. |

The current route authority includes dashboard, students, classes, enrollment,
daily/class attendance, calendar, machine import, review/correction queues,
academic management and grades, analytics, reports, uploads, data portability,
and settings. Read `routeDefinitions.tsx` before claiming a new route.

Representative routes are `/`, `/students`, `/students/:id`, `/classes/:id`,
`/enrollment`, `/attendance/daily`, `/attendance/class-entry`,
`/attendance/calendar`, `/attendance/machine-import`, `/attendance-review`,
`/attendance-corrections`, `/attendance/override-review`, `/grades`,
`/grades/operations`, `/analytics/attendance`, `/analytics/academic`,
`/analytics/data-quality`, `/analytics/trends`, `/analytics/indicators`,
`/upload`, `/data-portability`, `/settings`, and `/settings/backups`.

## 3. Goals and non-goals

Goals:

- establish one obvious owner for domain facts;
- keep public response shapes in `packages/contracts`;
- require explicit internal-row to public-DTO mapping;
- make Web feature ownership and query ownership discoverable;
- make mutation side effects explicit;
- preserve meaningful loading, empty, error, conflict, and authorization states;
- protect critical cross-feature stories with deterministic E2E;
- use BrowserUse where operator acceptance can find defects automated tests miss;
- keep future work safe for one maintainer.

Non-goals:

- repository-wide feature-folder moves;
- a new framework, event bus, repository layer, rule engine, or state-machine framework;
- authentication, router, form, sync, infrastructure, Excel, or analytics redesign;
- persisted readiness or analytics rollups;
- risk classification, alerts, predictions, or interventions;
- Python tooling or port infrastructure repair in this conventions slice.

## 4. Four safety layers

### Layer 1 — Data integrity

- Use one canonical DB/domain authority.
- Apply authorization and scope in canonical server queries.
- Define transaction and rollback semantics for mutations.
- Keep domain states explicit.
- Never use a derived status to authorize or mutate data.

### Layer 2 — Contract safety

- Define public request/response DTOs in `packages/contracts`.
- Map internal rows explicitly.
- Enforce response schemas at important Elysia routes.
- Consume the contract through a Web API adapter.
- Add targeted runtime conformance tests where browser drift is costly.

### Layer 3 — Feature integration safety

- Colocate new domain-aware feature code in `apps/web`.
- Give each domain one query-key owner.
- Make mutation invalidation explicit.
- Declare feature prerequisites in a small typed registry when needed.
- Use canonical synthetic fixture builders only when repetition proves useful.
- Protect Fresh School, Attendance, and Academics journeys with small E2E tests.

### Layer 4 — Developer reliability

- Use `mise`, `doctor`, `check:affected`, and `check:full` as the command surface.
- Keep test data, runtime roots, sessions, and ports invocation-owned.
- Keep retained Python tooling separate from the active runtime.
- Treat layout-sensitive inspection tools as tooling, not source authority.
- Run BrowserUse at milestones and defect boundaries.

## 5. Server golden path

For a new cross-layer feature, follow this ownership path:

```text
packages/db
  persistence authority
        |
apps/api domain/service
  business interpretation
  authorization and scope
  transaction semantics
        |
explicit mapper
  internal/DB shape -> public DTO
        |
packages/contracts
  TypeBox request/response shape
        |
apps/api Elysia route
  HTTP orchestration and response enforcement
```

Database rows are not automatically public DTOs. An internal SQL alias such as
`student_name` may intentionally map to a public `fullName` or `studentName`.
The mapper must make that translation explicit. Web components must not guess
between field names or consume DB-shaped objects.

Domain services own business interpretation. Routes authenticate, authorize,
call the service, and return the contract. `packages/db` owns persistence and
schema authority; it does not own HTTP behavior. `packages/contracts` must not
import Elysia, Drizzle, React, `@operatoros/db`, or application code.

## 6. Public contract rule

`packages/contracts` owns request and response shapes that cross an application
or package boundary. Use `@sinclair/typebox` directly through the repository
catalog.

Do not create:

- a Web-local public interface for an already contracted response;
- an API-local public DTO that duplicates the shared contract;
- a Zod schema;
- an Elysia `t` schema re-exported from shared contracts;
- a Drizzle type used as a public API contract.

Internal DB and service types are allowed when they remain behind the API
boundary. A feature API adapter may refine transport errors and expose the
shared contract to queries, but it must not redefine the payload shape.

### Response conformance

Use the existing TypeBox/Elysia test infrastructure. For high-value endpoints:

1. exercise the real route with a disposable SQLite database and test actor;
2. validate JSON with TypeBox `Value.Check` or the repository equivalent;
3. assert important semantic IDs, names, statuses, and nullability;
4. run the Web adapter against a representative payload where field drift is likely.

Start with Class Attendance, Machine Import, Student 360, Class 360, assessment
operations, and Data Quality. Do not add Pact or another contract framework.
Pure internal functions and file downloads need their existing focused tests,
not a duplicate response-conformance layer.

## 7. Web feature golden path

Domain-aware UI belongs in `apps/web`. For a new or substantially new feature,
prefer a feature-owned module with this shape:

```text
apps/web/src/features/<feature>/
  api/                 transport adapter and boundary tests when justified
  queries.ts           or queries/
  mutations.ts         or mutations/
  query-keys.ts        only when ownership is not already centralised
  components/          domain-aware UI
  pages/               route-level modules when useful
  index.ts
```

The names are guidance, not a required template. A small feature may keep one
module. A stable page may remain under `apps/web/src/pages`.

Migration policy:

| Work | Rule |
| --- | --- |
| New feature | Follow the golden path. |
| Substantially modified feature | Converge opportunistically when it reduces risk. |
| Stable untouched feature | Leave it alone. |

Do not perform a move-only mass reorganization. Move code only when the move
also establishes ownership, fixes a boundary, or protects behavior.

## 8. `packages/ui` boundary

`packages/ui` contains reusable, domain-neutral visual primitives. It does not
own routes, data fetching, business forms, or OperatorOS domain rules.

Generic examples that belong there include buttons, dialogs, table primitives,
inputs, and status presentation primitives. Concepts that remain in
`apps/web` include academic-year readiness, jenjang setup, student enrollment,
machine-import state, and attendance correction workflows.

`packages/ui` must remain independent of application packages and persistence.
Existing UI patterns may coexist during incremental work; do not widen this
slice into a UI rewrite.

## 9. Query-key ownership

TanStack Query is the Web server-state authority. The current first key
authority is `apps/web/src/lib/query/queryKeys.ts`. New work must reuse an
existing domain key or add one named owner when the domain is genuinely new.

Rules:

1. The domain that owns the request owns its key.
2. Every server input that changes a result appears in the key.
3. Keys use stable serializable segments and canonicalized filters.
4. Components do not invent a second key for the same endpoint.
5. Query keys contain no secrets or unnecessary PII.
6. Feature-local keys are acceptable only when shared domain ownership is not needed.

Current source already centralizes many keys, but literal keys remain in parts
of Class Attendance, Calendar, Teacher Assignments, Machine Import, and older
pages. Converge those paths when they are changed. Do not rewrite all keys at
once. Candidate domain helpers include students, enrollment, attendance,
academic, machine import, readiness, and analytics; use the existing object
first and split only when repeated ownership ambiguity justifies it.

## 10. Mutation invalidation

The mutation module or hook owns the affected-query list:

```text
canonical mutation
    -> explicit affected domain keys
    -> targeted invalidation/refetch
    -> UI recomputes canonical state
```

After success, invalidate the smallest complete set. Include readiness when a
mutation changes a readiness prerequisite or operational count. Include
analytics, dashboard, Student 360, Class 360, attendance, or machine-import
queries only when their canonical source changed.

Do not use:

- a global event bus or mutation bus;
- invalidate-everything as the default;
- an invisible dependency graph;
- local state that pretends a server record changed.

The mutation code must make cross-feature effects discoverable. The current
`attendanceInvalidation.ts` is a useful shared starting point but is broad and
includes legacy prefixes. Current student invalidation covers student and
analytics consumers but does not yet cover future readiness. Improve these
paths only when a touched mutation or browser journey proves the need.

Minimum impact review:

| Mutation | Review affected consumers |
| --- | --- |
| Student create/edit | Student list/profile, enrollment, classes, Data Quality, analytics, readiness if applicable. |
| Enrollment change | Student/Class 360, attendance, grades, analytics, readiness. |
| Academic year or hierarchy change | Options, classes, terms, calendar, feature readiness. |
| Calendar change | Calendar, daily/class attendance, machine preview, reports, readiness. |
| Device identity link | Machine preview, student profile, operational health, Data Quality. |
| Attendance correction/override | Attendance, review, queues, analytics, reports, Student/Class 360. |
| Assessment/result save | Grades, timeline, academic analytics, exports. |

## 11. Declarative prerequisites

Feature prerequisites belong to an API readiness/domain service. Represent them
with a small typed constant registry, not a generic rules engine:

```text
feature -> canonical prerequisite keys
```

Conceptual entries must be verified against current services before coding:

```text
MACHINE_IMPORT  -> academicYear, jenjang, calendar
DAILY_ATTENDANCE -> academicYear, jenjang, class, calendar
CLASS_ATTENDANCE -> academicYear, class, calendar
ACADEMIC_ASSESSMENTS -> academicYear, terms, subject/session context as required
```

Each entry identifies the canonical check, public label, state, reason, and
canonical action route. The registry contains metadata only. Queries remain in
the API service. React components and `packages/ui` do not own prerequisite
business rules. Existing guards migrate one feature at a time.

## 12. State semantics

Do not create one universal application-state enum. Domain state models must
preserve material differences:

```text
loading       != missing
unauthorized  != missing
network error != empty
conflict      != validation error
NO_SCAN       != Alfa
DB ahead      != needs migration
absent        != false
```

Important screens should represent loading, successful records, valid empty
results, authorization denial, request/server failure, validation failure,
domain conflict, and mutation pending/success/failure as applicable.

For derived readiness, use `READY`, `ACTION_REQUIRED`, `BLOCKED`, `ERROR`, and
`NOT_APPLICABLE` as specified by the approved Setup & Readiness document. Do
not convert `undefined`, `isPending`, `401`, `403`, `500`, or a parse failure
into “setup missing.”

## 13. Authorization and scope

Authorization and scope are server responsibilities. Apply the actor's
capabilities and canonical scope filters before returning rows, counts,
search results, readiness, or aggregates.

Frontend hiding improves UX. It does not authorize a mutation. Inaccessible
data is not missing data. A scoped operator must not receive global counts or
an `ACTION_REQUIRED` claim based on records outside their scope.

The prior readiness audit found `READINESS_SCOPE_LEAK`: global presence/count
queries were used while role checks were applied only to management behavior.
The Setup & Readiness implementation must use the source feature's scope
helpers and distinguish `BLOCKED` or `ERROR` from genuinely absent data.

## 14. Synthetic fixtures

Tests and E2E use disposable SQLite data roots. They never use
`backend/attendance.db`, protected XLSX files, or real PII.

When repeated valid setup causes drift, add a small test-only builder set for
canonical academic years, jenjang, classes, students, enrollments, calendars,
device identities, attendance, or assessments. Builders must be deterministic,
composable, and aligned with current domain authorities. Do not create a
general fixture framework. Add a builder only when at least two critical
journeys need the same setup or manual duplication has caused a real defect.

## 15. Deterministic E2E

Use focused tests for local logic, deterministic Playwright for critical
cross-layer regression, and BrowserUse for exploratory operator acceptance.

The current E2E infrastructure already provides synthetic data, invocation-
owned runtime roots, dynamic ports, and Playwright. Keep these three small
journeys durable:

### Fresh School

```text
login -> academic year -> jenjang -> class -> student -> enrollment -> usable feature
```

### Attendance

```text
student/enrollment -> calendar -> attendance -> device identity
  -> machine preview -> controlled import -> review -> correction -> effective attendance
```

### Academics

```text
class/student -> assessment -> result -> academic timeline -> analytics/export
```

Each journey owns its database and consumes runtime-provided URLs. It must not
assume ports `8000` or `5173`. Do not combine all routes into one fragile test.

## 16. BrowserUse policy

BrowserUse is the acceptance authority for operator usability when it runs. Use
it for:

- major feature completion;
- broad product UAT milestones;
- release candidates;
- real operator-reported defects;
- important cross-feature workflow changes;
- contract changes with browser field, empty-state, or error-state risk.

Do not run a full route sweep on every commit. Use a focused journey for a
small change and the three critical journeys for major cross-feature work.

Record route, operator action, visible/accessibility state, route transitions,
relevant Fetch/XHR method/path/status, sanitized response shape, console
exceptions, loading/empty/error/conflict/success feedback, and refetch behavior.
Never record cookies, Authorization headers, session IDs, secrets, or real PII.

## 17. Architecture-test strategy

Architecture checks protect expensive correctness and security invariants. They
must not become style checks.

Retain the current checks for:

- workspace imports and package exports;
- `packages/contracts` independence from Elysia, Drizzle, React, and apps;
- `packages/ui` and Web persistence boundaries;
- OpenAPI/TypeBox resolution;
- protected operational database paths in tests;
- Turbo invalidation behavior.

Evaluate narrowly in later slices:

1. active schema-head literals outside `packages/db`;
2. explicit shared response schemas for selected high-value endpoints;
3. runtime TypeBox conformance for the Class Attendance regression path;
4. test configuration that selects `backend/attendance.db`;
5. current-layout recognition in layout-sensitive inspection tooling.

Do not attempt unreliable whole-repository detection of every duplicate
interface. Use a boundary test when static detection cannot be trusted.

## 18. Developer reliability findings

These are separate maintenance slices, not Slice A product work.

### Python environment

`mise.toml`, `Makefile`, `scripts/test-tier.sh`, fresh-DB parity, and E2E
helpers resolve `backend/.venv/bin/python`. A clean worktree can therefore be
source-clean but validation-incomplete. Classify this as
`SHARED_PYTHON_TOOLING_ENVIRONMENT_DEFECT`.

The later preferred model is an external canonical tooling environment such as
`${XDG_CACHE_HOME:-$HOME/.cache}/operatoros/python/venv`, with an explicit
bootstrap mutation command, dependency fingerprint, read/execute-only doctor
and test consumers, and no worktree-to-primary symlink.

### Ports and runtime roots

`e2e/start-elysia-test-stack.sh` selects backend ports in `8090–8199` and
frontend ports in `5180–5299`, writes `ports.json`, and Playwright consumes the
selected URLs. Dynamic E2E isolation is therefore already present.

The normal development stack and standalone browser helper retain fixed
defaults of `8000` and `5173`. The current `mise run check:full` release chain
uses `make test-release`, `scripts/test-tier.sh release`, `e2e/run-smoke.sh`,
and the dynamic test stack. A prior collision with `8000`/`5173` is therefore
classified `DEV_SERVER_PRECONDITION_ONLY` unless an incident reproduces a
different fixed-port child in the release chain.

Before changing port infrastructure, capture the exact colliding command. The
smallest later repair is to make fixed-port preconditions explicit, keep test
ports dynamic, and preserve invocation-owned data roots, sessions, and ports.
Never kill an unknown listener.

### Inspection-tool layout drift

The generic inspector at
`/home/mikhailryu/.codex/skills/operatoros-engineering/scripts/inspect_operatoros_stack.py`
still searches for historical `frontend/` layout. Current source uses
`apps/api` and `apps/web`; the inspector is not a repository-local runtime or
validation authority, and no repository caller was found in the audit.
Classify this as `DEVELOPER_TOOLING_REPOSITORY_LAYOUT_DRIFT`. A later repair
should recognize root workspaces and `apps/*` while keeping historical backend
facts clearly labelled. Do not build a generic repository detector.

## 19. Feature Definition of Done

Use this short checklist in every significant feature PR. “Not applicable” is
valid only with a reason.

```text
[ ] Canonical authority and domain/service owner are named.
[ ] Shared TypeBox DTO and explicit internal -> DTO mapper are identified.
[ ] Authorization scope and transaction/data-integrity semantics are defined.
[ ] Query-key owner and successful-mutation invalidation effects are named.
[ ] Loading, valid empty, error, and conflict states are covered.
[ ] Synthetic disposable fixture path is defined; protected data is excluded.
[ ] Focused tests and relevant response-conformance coverage exist.
[ ] A deterministic E2E scenario exists when the workflow crosses layers.
[ ] BrowserUse requirement is decided from operator and cross-feature risk.
[ ] Cross-feature consumers and architecture invariants are reviewed.
[ ] Protected-data boundary and rollback behavior are preserved.
```

## 20. Setup & Readiness reference implementation

The approved Setup & Readiness specification remains a separate product
authority. It is the first reference implementation of this golden path:

```text
canonical setup authorities
  -> scoped apps/api readiness service
  -> packages/contracts TypeBox DTO
  -> explicit mapper
  -> GET /api/readiness
  -> one TanStack Query owner
  -> apps/web readiness feature
  -> canonical action links
  -> focused tests and Fresh School E2E
  -> BrowserUse acceptance
```

It must derive readiness. It must not add a readiness table or `setup_complete`
flag. It must keep `READY`, `ACTION_REQUIRED`, `BLOCKED`, `ERROR`, and
`NOT_APPLICABLE` distinct, apply server scope before claims, and exclude
`jenjang_config` from canonical jenjang readiness. Feature guards migrate later
one domain at a time.

## 21. Incremental implementation slices

Do not create an infrastructure phase that blocks product delivery.

| Slice | Responsibility | Scope and acceptance |
| --- | --- | --- |
| A. Conventions | Publish this guidance, the concise DoD, and links. | Markdown/link checks; no runtime impact. |
| B. Setup Readiness | Implement the approved derived readiness reference. | API service, TypeBox contract, Web feature, scoped queries, focused tests, Fresh School E2E, BrowserUse. |
| C. Contract hardening | Repair only proven weak response boundaries. | Explicit mapper, shared DTO, Elysia response contract, conformance test, browser regression. |
| D. Critical E2E | Make Fresh School, Attendance, and Academics journeys durable. | Existing Playwright and synthetic runtime only. |
| E. Invalidation | Repair measured stale-query paths. | Named domain keys, mutation-owned targeted invalidation, browser refetch proof. |
| F. Developer reliability | Address Python environment, proven fixed-port callers, and inspector layout drift. | Separate tooling PRs; no product schema or authority changes. |

Each slice is independently reviewable and reversible. New features follow the
golden path immediately. Stable features migrate only when touched or when a
real correctness defect justifies the cost.

## 22. Maintenance and risk decisions

| Convention | Concrete problem | Why current pattern is insufficient | New burden | Risk | Decision |
| --- | --- | --- | --- | --- | --- |
| Shared DTO plus mapper | Browser field drift. | Local types and casts can disagree. | Keep mapper and schema aligned. | Low; check compatibility. | Implement for new/changed high-value endpoints. |
| Targeted conformance | API tests missed browser payload failure. | Older routes do not always enforce public shape. | One focused assertion per critical boundary. | Low; disposable DB. | Use selectively. |
| Domain query keys | Literal keys and stale consumers. | Central key coverage is incomplete. | Maintain one key owner per domain. | Low; verify refetch behavior. | Converge incrementally. |
| Mutation invalidation list | Cross-feature stale views. | Screens currently scatter or broaden invalidation. | Maintain affected-consumer list. | Low; avoid excess refetch. | Use in touched mutations. |
| Typed prerequisites | Duplicated feature guards. | React pages independently infer setup. | Maintain a small registry. | None persisted; wrong rules can block. | Build with Setup Readiness. |
| Synthetic builders | Repeated invalid setup. | Seed scripts repeat lifecycle details. | Keep builders aligned with schema. | Low; test-only. | Add after repetition proves it. |
| Critical E2E | Cross-layer defects escaped unit/API tests. | Local tests do not prove operator journeys. | Maintain three small stories. | Low; isolated roots. | Implement incrementally. |
| BrowserUse milestones | Usability defects escape deterministic tests. | Fixed cases cannot cover every operator path. | Run and preserve sanitized evidence. | None with synthetic data. | Use at milestones, not every commit. |
| External Python venv | Clean worktree depends on ignored state. | Scripts hardcode checkout-local path. | Bootstrap/fingerprint upkeep. | Developer-only. | Separate Slice F. |
| New framework | No demonstrated need. | Current stack supports the required boundaries. | Large learning and migration cost. | Broad. | Reject. |

No convention adds application persistence, schema migrations, or dependencies.
The main migration risk is public semantic change. Mitigate it with explicit
adapters, focused conformance, browser regression, and one slice at a time.

## 23. Explicitly rejected abstractions

Do not introduce `OperatorOSFramework`, `GenericRuleEngine`, `MutationBus`,
`EventBus`, `ReadinessPluginSystem`, a repository layer everywhere, a generic
state-machine framework, or a plugin architecture. Existing services, typed
registries, TypeBox, TanStack Query, and current tests are enough.

Also do not introduce tRPC, Zod, Better Auth, TanStack Router, TanStack Start,
TanStack Form, Dagger, a frontend rewrite, persisted analytics rollups, cloud
sync, Hucre migration, command palette, or `nuqs` as part of this program.

## 24. Documentation and implementation workflow

Keep concise mandatory invariants in `AGENTS.md`. Keep detailed guidance here,
linked from `docs/README.md`. Do not duplicate this document in `AGENTS.md` or
the approved Setup & Readiness specification.

For future autonomous implementation prompts:

```text
inspect/audit
  -> establish canonical authority
  -> implement the smallest slice
  -> focused validation
  -> browser/E2E validation when applicable
  -> check:affected
  -> broader gate
  -> explicit staging and SSH-signed commit
  -> PR and CI loop
  -> normal merge
  -> merged-main verification
  -> safe worktree cleanup
```

Existing `AGENTS.md` owns protected data, worktree, signing, and command
safeguards. Do not duplicate those procedures here.

## 25. Open questions for implementation slices

Resolve these from current source before the relevant slice. Do not invent a
new authority to avoid answering them.

1. Which remaining Class Attendance and grade endpoints need shared response schemas?
2. Which public naming convention fits each stable endpoint without breaking compatibility?
3. Which staff scope helper applies to each readiness feature?
4. Which calendar resolver result proves each feature has usable context?
5. Which canonical student predicate defines a usable student when legacy rows remain?
6. Which assessment subject/component/session prerequisites are real for current operations?
7. Which exact child caused the historical fixed-port collision?
8. Which approved bootstrap command owns the external Python tooling environment?
9. Which callers, if any, depend on the generic inspector's historical output?

## 26. Final recommendation

**IMPLEMENT INCREMENTALLY.**

Publish this convention slice. Use the approved Setup & Readiness work as the
first reference implementation. Then harden only proven contract and
invalidation boundaries, add the three durable journeys, and handle developer
reliability separately.

Expected impact:

- product code changes in this slice: `0`;
- application schema migrations: `0`;
- new dependencies: `0`;
- readiness persistence: `0`;
- mass feature reorganization: `NO`.

## 27. Slice A acceptance criteria

- current `origin/main` was audited and its SHA is recorded above;
- the approved Setup & Readiness specification remains separate and compatible;
- the canonical-authority and executable-invariant rule is published;
- API/domain ownership, TypeBox DTO ownership, and explicit mapping are published;
- Web feature ownership and `packages/ui` neutrality are published;
- mass reorganization is rejected;
- query-key and mutation invalidation ownership are published;
- global event/mutation buses are rejected;
- state, authorization, and inaccessible-versus-missing semantics are published;
- synthetic fixture, deterministic E2E, and BrowserUse policies are published;
- architecture-test candidates are tied to demonstrated failures;
- Python, port, and inspector defects are documented as later work only;
- the Feature Definition of Done is concise and reusable;
- Setup & Readiness is named as the first reference implementation;
- no product code, schema, dependency, or test infrastructure was implemented;
- protected operational data, protected XLSX files, and real PII were not used.
