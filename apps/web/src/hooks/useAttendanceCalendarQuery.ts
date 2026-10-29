import { useQuery } from "@tanstack/react-query";
import { fetchAttendanceCalendar } from "../api/attendanceCalendar";
import { queryKeys } from "../lib/query/queryKeys";
import { queryFreshness } from "../lib/query/queryConfig";

export function useAttendanceCalendarQuery(academicYearId: number | null, enabled = true) {
  return useQuery({
    queryKey: academicYearId === null ? ["attendance", "calendar", "idle"] : queryKeys.attendance.calendar(academicYearId),
    queryFn: ({ signal }) => fetchAttendanceCalendar(academicYearId as number, signal),
    staleTime: queryFreshness.operational,
    enabled: enabled && academicYearId !== null,
  });
}
