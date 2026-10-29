import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

async function invalidateBackupKeys(client: QueryClient, keys: readonly QueryKey[]): Promise<void> {
  await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey, exact: true })));
}

export function invalidateBackupSchedulerQueries(client: QueryClient): Promise<void> {
  return invalidateBackupKeys(client, [queryKeys.backups.scheduler, queryKeys.backups.status]);
}

export function invalidateCreatedBackupQueries(client: QueryClient): Promise<void> {
  return invalidateBackupKeys(client, [queryKeys.backups.status, queryKeys.backups.list, queryKeys.backups.history]);
}

export function invalidateDeletedBackupQueries(client: QueryClient): Promise<void> {
  return invalidateBackupKeys(client, [queryKeys.backups.status, queryKeys.backups.list]);
}
