import { QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { queryKeys } from "./queryKeys";
import { invalidateBackupSchedulerQueries, invalidateCreatedBackupQueries, invalidateDeletedBackupQueries } from "./backupInvalidation";

const backupQueries = [
  queryKeys.backups.status,
  queryKeys.backups.list,
  queryKeys.backups.scheduler,
  queryKeys.backups.history,
  queryKeys.backups.recoveryHistory,
] as const;

describe("backup query invalidation", () => {
  let client: QueryClient | undefined;
  let unsubscribe: Array<() => void> = [];

  afterEach(() => {
    unsubscribe.forEach((stop) => stop());
    unsubscribe = [];
    client?.clear();
    client = undefined;
  });

  function observeBackupQueries() {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const calls = new Map<QueryKey, number>();
    for (const queryKey of backupQueries) {
      calls.set(queryKey, 0);
      client.setQueryData(queryKey, "cached");
      const observer = new QueryObserver(client, {
        queryKey,
        queryFn: async () => {
          calls.set(queryKey, (calls.get(queryKey) ?? 0) + 1);
          return "refreshed";
        },
        staleTime: Infinity,
      });
      unsubscribe.push(observer.subscribe(() => undefined));
    }
    return calls;
  }

  it("refreshes scheduler and status after a schedule change", async () => {
    const calls = observeBackupQueries();
    await invalidateBackupSchedulerQueries(client!);

    expect(Array.from(calls.values())).toEqual([1, 0, 1, 0, 0]);
  });

  it("refreshes status, the backup list, and execution history after creation", async () => {
    const calls = observeBackupQueries();
    await invalidateCreatedBackupQueries(client!);

    expect(Array.from(calls.values())).toEqual([1, 1, 0, 1, 0]);
  });

  it("refreshes status and the backup list after deletion", async () => {
    const calls = observeBackupQueries();
    await invalidateDeletedBackupQueries(client!);

    expect(Array.from(calls.values())).toEqual([1, 1, 0, 0, 0]);
  });
});
