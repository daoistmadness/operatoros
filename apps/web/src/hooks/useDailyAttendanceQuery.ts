import { useQuery } from "@tanstack/react-query";
import { fetchDailyAttendance, type DailyAttendanceFilters } from "../api/dailyAttendance";
import { queryKeys } from "../lib/query/queryKeys";
import { queryFreshness } from "../lib/query/queryConfig";

export function useDailyAttendanceQuery(filters: DailyAttendanceFilters | null, enabled = true) {
  return useQuery({ queryKey: filters ? queryKeys.analytics.dailyAttendance(filters) : ["attendance", "daily-status", "idle"], queryFn: ({ signal }) => fetchDailyAttendance(filters as DailyAttendanceFilters, signal), staleTime: queryFreshness.operational, enabled: enabled && filters !== null });
}
