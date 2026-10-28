import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchOperatorWorkQueue,
  fetchDashboardOverview,
  fetchBospReminderStatus,
  acknowledgeBospReminder,
} from "../api/operator";
import { queryKeys } from "../../../lib/query/queryKeys";

export const operatorWorkQueueOptions = () => queryOptions({
  queryKey: queryKeys.operator.workQueue,
  queryFn: ({ signal }) => fetchOperatorWorkQueue(signal),
});

export const useOperatorWorkQueueQuery = () => useQuery(operatorWorkQueueOptions());

export const dashboardOverviewOptions = () => queryOptions({
  queryKey: queryKeys.operator.dashboardOverview,
  queryFn: ({ signal }) => fetchDashboardOverview(signal),
});

export const useDashboardOverviewQuery = () => useQuery(dashboardOverviewOptions());

export const bospReminderOptions = () => queryOptions({
  queryKey: queryKeys.operator.bospReminder,
  queryFn: ({ signal }) => fetchBospReminderStatus(signal),
});

export const useBospReminderQuery = () => useQuery(bospReminderOptions());

export const useAcknowledgeBospReminderMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { calendar_year: number; notes?: string | null }) =>
      acknowledgeBospReminder(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.operator.bospReminder });
    },
  });
};
