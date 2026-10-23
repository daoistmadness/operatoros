import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

function isProtectedQuery(query: { queryKey: readonly unknown[] }) {
  return query.queryKey[0] !== queryKeys.auth.all[0];
}

export async function clearProtectedQueries(client: QueryClient): Promise<void> {
  try {
    await client.cancelQueries();
  } finally {
    client.removeQueries({ predicate: isProtectedQuery });
  }
}

export async function clearSessionQueries(client: QueryClient): Promise<void> {
  client.setQueryData(queryKeys.auth.me, null);
  await clearProtectedQueries(client);
}
