import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

function isProtectedQuery(query: { queryKey: readonly unknown[] }) {
  return query.queryKey[0] !== queryKeys.auth.all[0]
    && query.queryKey[0] !== queryKeys.setup.all[0];
}

export async function clearProtectedQueries(client: QueryClient): Promise<void> {
  try {
    await cancelProtectedQueries(client);
  } finally {
    client.removeQueries({ predicate: isProtectedQuery });
  }
}

export function cancelProtectedQueries(client: QueryClient): Promise<void> {
  return client.cancelQueries({ predicate: isProtectedQuery });
}

export function cancelCurrentUserQuery(client: QueryClient): Promise<void> {
  return client.cancelQueries({ queryKey: queryKeys.auth.me, exact: true });
}

export function refetchStaleProtectedQueries(client: QueryClient): Promise<void> {
  return client.refetchQueries({ predicate: isProtectedQuery, type: "active", stale: true });
}

export async function clearSessionQueries(client: QueryClient): Promise<void> {
  await cancelCurrentUserQuery(client);
  client.setQueryData(queryKeys.auth.me, null);
  await clearProtectedQueries(client);
}
