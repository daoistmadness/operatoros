import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createBackup, getBackupScheduler, listBackupHistory, getBackupStatus, listBackups, restoreBackup, updateBackupScheduler, type BackupSchedulerConfig } from "../api/backups";
import { queryKeys } from "../lib/query/queryKeys";

export const useBackupStatus = () => useQuery({ queryKey: queryKeys.backups.status, queryFn: getBackupStatus });
export const useBackupList = () => useQuery({ queryKey: queryKeys.backups.list, queryFn: listBackups });
export const useBackupScheduler = () => useQuery({ queryKey: queryKeys.backups.scheduler, queryFn: getBackupScheduler });
export const useBackupHistory = () => useQuery({ queryKey: queryKeys.backups.history, queryFn: listBackupHistory });

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
    mutationFn: ({ filename, confirmation }: { filename: string; confirmation: string }) => restoreBackup(filename, confirmation),
    onSuccess: (result) => {
      if (!result.reauthentication_required) return client.invalidateQueries({ queryKey: queryKeys.backups.all });
      client.clear();
    },
  });
}
