---
status: current
last_reviewed: 2026-10-29
---

# Frontend data architecture

This page defines the current TanStack Query contract for server state. Complex
editable surfaces such as Grade Matrix keep their drafts local and are not
mechanically converted into server cache state.

TanStack Query is the frontend server-state foundation. `src/index.tsx` owns the single application provider and `src/lib/query/queryClient.ts` owns both application and isolated test-client factories. Components should keep only UI drafts and selections in local state; API results, request status, and server errors belong in queries.

## Query keys

All keys are created by `lib/query/queryKeys.ts`. Keys progress from a stable domain prefix to a resource and then a serializable parameter object:

```ts
["backups", "list"]
["reports", "filters", { academicYearId: 4, scope: "combined" }]
```

Every server-side request input must be represented in its key. Invalidation may target an exact key or a domain prefix such as `queryKeys.backups.all`.

## Cache and retry policy

The shared policy defines authentication as immediately stale, operational data as fresh for 30 seconds, records for two minutes, analytics for five minutes, and reference data for ten minutes. The application client applies domain defaults by query-key prefix; analytics is also the fallback for unclassified queries. Explicit query options can override these defaults. The client retains unused queries for thirty minutes. Window-focus refetch is disabled globally; the health query opts in to a Query-managed 10-second poll, backs off to 60 seconds after repeated failures, and pauses while the document is hidden. A failed network request or 5xx response receives one retry. Authentication, permission, and other 4xx responses are never retried. Tests use a new client with retries disabled and no retained cache.

Current-user, selected student, attendance, health, and dashboard query functions pass TanStack Query's `AbortSignal` to the shared API client. Cancellation is best-effort for query functions that still use legacy APIs. The shared browser request uses `cache: "no-store"`, and the API sets `Cache-Control: private, no-store` on `/api/` responses so authenticated data is not stored by the browser's HTTP cache.

The existing API client remains responsible for credentials, typed `ApiError` values, and the global unauthorized event. A 401 clears the current-user cache and protected query caches so existing route guards return to login. A 403 remains a query error and is rendered by the screen as permission denied/request failure state.

## Cross-tab session isolation

Each browser tab owns a separate in-memory `QueryClient`. Successful login and confirmed logout broadcast a fixed session-change signal over a same-origin `BroadcastChannel`. The payload contains only the event type and a random per-tab sender id; it never contains credentials, cookies, tokens, usernames, roles, or student data. A failed or unconfirmed logout does not itself broadcast or clear protected caches, because the server session may still be active; the initiating tab shows a retryable failure. An authoritative `401` still clears local state and caches immediately.

A receiving tab clears the current-user cache, cancels outstanding queries, removes every non-auth query, and revalidates `/api/auth/me` before applying another session. The logging-in tab also clears protected queries before applying its new user. The server session and its database role remain authoritative.

Tabs additionally revalidate `/api/auth/me` on window focus and visibility changes. Paired events share one request. Before verification, in-flight protected queries are cancelled and the app shell is covered, inert, and hidden from assistive technology while remaining mounted so unsaved drafts survive. On a confirmed same-user session, cached data remains and only stale active protected queries are refetched. A changed identity or authorization clears protected caches before the new user is applied. If verification fails for a network reason, the shell stays covered and offers a retry. An authoritative 401 clears the session and returns the route guards to login.

## Mutations and invalidation

Mutation hooks use `useCreateXMutation`, `useUpdateXMutation`, and `useDeleteXMutation` names. Domain-specific verbs are permitted where the operation is not CRUD, such as `useRestoreBackupMutation` and `useLogoutMutation`.

Successful mutations invalidate the smallest complete stale set. Backup scheduler changes invalidate scheduler and status; backup creation invalidates status, list, and history; deletion invalidates status and list. Confirmed logout cancels and removes protected query caches, clears the current-user cache, and notifies other tabs without an immediate refetch. Restore clears all cache when reauthentication is required; otherwise it invalidates backup state. Screens do not call manual `load()` functions after mutations.

Mutation errors remain `ApiError` instances and are displayed through the same accessible alert treatment already used by each screen. Mutations are not retried automatically, preventing duplicate writes.

## Migration guide

1. Keep the existing API function as the query function; do not bypass `apiRequest()` or hardcode a backend origin.
2. Add a key factory containing every filter that changes the response.
3. Add a domain hook under `src/hooks/` and give mutations explicit names.
4. Replace server `data/loading/error` state and request effects with query results. Keep form drafts, dialogs, and unsaved matrix edits local.
5. Invalidate related keys in the mutation hook, not in the screen.
6. Render the component in tests with `QueryClientProvider` and `createTestQueryClient()`.
7. Verify the full test suite, production build, and the affected authenticated browser flow.

Complex editable screens such as Grade Matrix require a separate design for draft isolation, virtualization, keyboard interaction, and batch-save consistency and must not be migrated mechanically.
