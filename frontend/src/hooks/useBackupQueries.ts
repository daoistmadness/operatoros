import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createBackup, deleteBackup, getBackupScheduler, listBackupHistory, listRecoveryHistory, getBackupStatus, listBackups, preflightRestore, restoreBackup, updateBackupScheduler, type BackupSchedulerConfig, type RestoreRequest } from "../api/backups";
import { queryKeys } from "../lib/query/queryKeys";

export const useBackupStatus = () => useQuery({ queryKey: queryKeys.backups.status, queryFn: getBackupStatus });
export const useBackupList = () => useQuery({ queryKey: queryKeys.backups.list, queryFn: listBackups });
export const useBackupScheduler = () => useQuery({ queryKey: queryKeys.backups.scheduler, queryFn: getBackupScheduler });
export const useBackupHistory = () => useQuery({ queryKey: queryKeys.backups.history, queryFn: listBackupHistory });
export const useRecoveryHistory = () => useQuery({ queryKey: queryKeys.backups.recoveryHistory, queryFn: listRecoveryHistory });

export function useUpdateBackupSchedulerMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<BackupSchedulerConfig, "next_run_at" | "updated_at">) => updateBackupScheduler(body),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.backups.all }),
  });
}

export function useCreateBackupMutation() {
  const client = useQueryClient();
  return useMutation({ mutationFn: createBackup, onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.backups.all }) });
}

export function useRestoreBackupMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ filename, body }: { filename: string; body: RestoreRequest }) => restoreBackup(filename, body),
    onSuccess: () => client.clear(),
  });
}

export const useRestorePreflightMutation = () => useMutation({
  mutationFn: (filename: string) => preflightRestore(filename),
});

export function useDeleteBackupMutation() {
  const client = useQueryClient();
  return useMutation({ mutationFn: deleteBackup, onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.backups.all }) });
}
