# Frontend Query Architecture

Phase 8 status: **COMPLETE FOR THE APPROVED MIGRATION SCOPE**. This remains the governing contract for new server-state work; Grade Matrix and other high-risk editable surfaces remain deliberate exclusions rather than incomplete pilot work.

TanStack Query is the frontend server-state foundation. `index.js` owns the single application provider and `lib/query/queryClient.ts` owns both application and isolated test-client factories. Components should keep only UI drafts and selections in local state; API results, request status, and server errors belong in queries.

## Query keys

All keys are created by `lib/query/queryKeys.ts`. Keys progress from a stable domain prefix to a resource and then a serializable parameter object:

```ts
["backups", "list"]
["reports", "filters", { academicYearId: 4, scope: "combined" }]
```

Every server-side request input must be represented in its key. Invalidation may target an exact key or a domain prefix such as `queryKeys.backups.all`.

## Cache and retry policy

Application queries are fresh for five minutes and retained for thirty minutes. Window-focus refetch is disabled for operational data to prevent unexpected changes in data-dense screens. Authentication is revalidated on focus and visibility changes as described under cross-tab session isolation. A failed network request or 5xx response receives one retry. Authentication, permission, and other 4xx responses are never retried. Tests use a new client with retries disabled and no retained cache.

The existing API client remains responsible for credentials, typed `ApiError` values, and the global unauthorized event. A 401 clears the current-user cache and protected query caches so existing route guards return to login. A 403 remains a query error and is rendered by the screen as permission denied/request failure state.

## Cross-tab session isolation

Each browser tab owns a separate in-memory `QueryClient`. Successful login and confirmed logout broadcast a fixed session-change signal over a same-origin `BroadcastChannel`. The payload contains only the event type and a random per-tab sender id; it never contains credentials, cookies, tokens, usernames, roles, or student data. A failed or unconfirmed logout does not itself broadcast or clear protected caches, because the server session may still be active; the initiating tab shows a retryable failure. An authoritative `401` still clears local state and caches immediately.

A receiving tab clears the current-user cache, cancels outstanding queries, removes every non-auth query, and revalidates `/api/auth/me` before applying another session. The logging-in tab also clears protected queries before applying its new user. The server session and its database role remain authoritative.

Tabs additionally revalidate `/api/auth/me` on window focus and visibility changes. This covers browsers without `BroadcastChannel` and suspended tabs that resume after a missed signal. When the revalidated user differs, protected caches are cleared before the new user is applied; same-user revalidation keeps the cached data.

## Mutations and invalidation

Mutation hooks use `useCreateXMutation`, `useUpdateXMutation`, and `useDeleteXMutation` names. Domain-specific verbs are permitted where the operation is not CRUD, such as `useRestoreBackupMutation` and `useLogoutMutation`.

Successful mutations invalidate the smallest complete stale set. Backup creation invalidates both backup status and list through the backup prefix. Confirmed logout cancels and removes protected query caches, clears the current-user cache, and notifies other tabs without an immediate refetch. Restore clears all cache when reauthentication is required; otherwise it invalidates backup state. Screens do not call manual `load()` functions after mutations.

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
