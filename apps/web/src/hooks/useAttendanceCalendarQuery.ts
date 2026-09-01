import { useQuery } from "@tanstack/react-query";
import { fetchAttendanceCalendar } from "../api/attendanceCalendar";
import { queryKeys } from "../lib/query/queryKeys";

export function useAttendanceCalendarQuery(academicYearId: number | null, enabled = true) {
  return useQuery({
    queryKey: academicYearId === null ? ["attendance", "calendar", "idle"] : queryKeys.attendance.calendar(academicYearId),
    queryFn: () => fetchAttendanceCalendar(academicYearId as number),
    enabled: enabled && academicYearId !== null,
  });
}
