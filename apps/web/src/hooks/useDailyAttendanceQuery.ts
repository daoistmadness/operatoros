import { useQuery } from "@tanstack/react-query";
import { fetchDailyAttendance, type DailyAttendanceFilters } from "../api/dailyAttendance";
import { queryKeys } from "../lib/query/queryKeys";

export function useDailyAttendanceQuery(filters: DailyAttendanceFilters | null, enabled = true) {
  return useQuery({ queryKey: filters ? queryKeys.analytics.dailyAttendance(filters) : ["attendance", "daily-status", "idle"], queryFn: () => fetchDailyAttendance(filters as DailyAttendanceFilters), enabled: enabled && filters !== null });
}
