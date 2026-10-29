import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createBackup, deleteBackup, getBackupScheduler, listBackupHistory, listRecoveryHistory, getBackupStatus, listBackups, preflightRestore, restoreBackup, updateBackupScheduler, type BackupSchedulerConfig, type BackupSchedulerUpdate, type RestoreSubmission } from "../api/backups";
import { queryKeys } from "../lib/query/queryKeys";
import { invalidateBackupSchedulerQueries, invalidateCreatedBackupQueries, invalidateDeletedBackupQueries } from "../lib/query/backupInvalidation";

export const useBackupStatus = () => useQuery({ queryKey: queryKeys.backups.status, queryFn: getBackupStatus });
export const useBackupList = () => useQuery({ queryKey: queryKeys.backups.list, queryFn: listBackups });
export const useBackupScheduler = () => useQuery({ queryKey: queryKeys.backups.scheduler, queryFn: getBackupScheduler });
export const useBackupHistory = () => useQuery({ queryKey: queryKeys.backups.history, queryFn: listBackupHistory });
export const useRecoveryHistory = () => useInfiniteQuery({ queryKey: queryKeys.backups.recoveryHistory, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => listRecoveryHistory(pageParam), getNextPageParam: (page) => page.next_cursor ?? undefined });

export function useUpdateBackupSchedulerMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: BackupSchedulerUpdate) => updateBackupScheduler(body),
    onSuccess: () => invalidateBackupSchedulerQueries(client),
  });
}

export function useCreateBackupMutation() {
  const client = useQueryClient();
  return useMutation({ mutationFn: createBackup, onSuccess: () => invalidateCreatedBackupQueries(client) });
}

export function useRestoreBackupMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ filename, body }: { filename: string; body: RestoreSubmission }) => restoreBackup(filename, body),
    onSuccess: () => client.clear(),
  });
}

export const useRestorePreflightMutation = () => useMutation({
  mutationFn: (filename: string) => preflightRestore(filename),
});

export function useDeleteBackupMutation() {
  const client = useQueryClient();
  return useMutation({ mutationFn: deleteBackup, onSuccess: () => invalidateDeletedBackupQueries(client) });
}
