# Frontend Query and Error Foundation

## Outcome

Architecture decision:
`STANDARDIZE_SERVER_STATE_AND_RUNTIME_ERROR_BOUNDARIES_BEFORE_OPENAPI_CLIENT_GENERATION`.

Implementation scope:
`HIGH_RISK_AND_HIGH_FREQUENCY_SERVER_FETCH_MIGRATION`.

This milestone establishes a typed, sanitized API-error boundary and predictable
TanStack Query conventions without changing backend routes, payloads, response
shapes, database schema, authentication, authorization, or route splitting. It
does not introduce generated OpenAPI code.

## Server-state audit

The audit covered `useQuery`, `useMutation`, `invalidateQueries`,
component-level API calls, native fetch calls, and `useEffect` in frontend pages
and components. The starting tree contained 29 pure manual server-fetch effects.

One manual fetch was migrated:

- `OperatorWorkQueue` now uses a domain query with deterministic key,
  cancellation forwarding, cached data, normalized errors, and query-driven
  loading/refresh state.

The upload conflict and history workflows already used TanStack Query, but had
ad-hoc keys and query functions. They now use domain hooks, deterministic keys,
AbortSignal forwarding, and active-tab `enabled` conditions. Hidden Needs
Attention and Upload History tabs no longer request data.

Twenty-eight manual-fetch effects remain. They are distributed across academic
configuration, enrollment, progression, attendance review/reporting,
follow-ups, data portability, class mapping, grade ledger, management analytics,
and student profile workflows. They are deferred because each combines
feature-specific form drafts, multiple response contracts, guarded mutations,
or cross-query initialization. Converting them safely requires dedicated
feature hooks and focused workflow tests; a generic query wrapper would obscure
those contracts. Browser/DOM effects, local-storage synchronization, focus
management, route-state synchronization, downloads, and mutation actions remain
effects or explicit actions by design.

## Typed API errors

`ApiError` exposes:

- `kind`, `status`, `code`, and a bounded operator-safe `message`;
- `retryable`, `requestId`, and normalized `fieldErrors`;
- compatibility metadata for existing callers;
- an internal `cause` that is never rendered or exported to users.

Normalization covers HTTP failures, FastAPI validation arrays, authentication,
authorization, not-found and conflict responses, rate limiting, server errors,
network failures, timeouts, cancellation, contract failures, ordinary errors,
and unknown thrown values.

Sanitization removes bearer credentials, password/token/cookie values, local
paths, SQL-like content, HTML, stack-frame fragments, and oversized messages.
Unknown objects are never serialized into UI copy. Cancellation produces no
user-visible failure.

## Query conventions

- The global stale time remains five minutes.
- Focus refetch remains disabled.
- Queries retry transient server, network, timeout, and rate-limit failures once.
- Authentication, authorization, validation, conflict, not-found, contract, and
  cancelled failures are not retried.
- Mutation retry remains disabled.
- Query keys use domain factories and canonicalized filter objects.
- Undefined filter values are omitted, scalar arrays are stabilized, and string
  identifiers—including leading zeros—remain strings.
- Query functions receive and forward TanStack Query's `AbortSignal`.
- Missing identifiers and inactive tabs use `enabled`; hooks are never called
  conditionally.
- Upload mutations invalidate only the upload-conflict family. There is no
  unkeyed global cache invalidation.
- File downloads remain explicit actions rather than queries.

## Validation evidence

Focused error/query coverage verifies classification, validation fields,
sanitization, bounded messages, retry policy, deterministic keys, leading-zero
identifiers, enabled conditions, cache reuse, cancellation, and AbortSignal
forwarding. The focused suite passes 40 tests.

- Strict TypeScript passes with no suppressions or unsafe double casts.
- Bun and genuine Node.js runs each pass 54 files and 284 tests.
- Bun and Node production builds pass.
- The initial bundle is 114.85 kB gzip, 1.63% above the 113.01 kB baseline and
  below the 5% regression ceiling.
- Canonical route-definition tests pass.
- `make e2e-validate` passes.
- The guarded local E2E smoke gate passes 7 backend and 14 web tests; the
  desktop check remains explicitly skipped by the existing infrastructure
  boundary.
- The E2E web gate provides real Playwright browser coverage. A supplemental
  Agent Browser session could not reach the WSL-local Vite listener from its
  isolated network namespace, so no supplemental visual result is claimed.
- No unkeyed cache invalidation or generated OpenAPI artifacts were introduced.

The protected database is inspected only through immutable, query-only SQLite
and is never used by application validation. Its checksum, row counts, schema
version, integrity checks, foreign-key checks, and absence of sidecars are
verified before and after integration.
