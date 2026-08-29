import { useQuery } from "@tanstack/react-query";
import {
  fetchAttendanceAnalyticsOptions,
  fetchAttendanceClasses,
  fetchAttendanceDaily,
  fetchAttendanceJenjang,
  fetchAttendanceOverview,
  fetchAttendanceStudents,
  type AttendanceAnalyticsFilters,
  type AttendanceStudentFilters,
} from "../api/attendanceAnalytics";
import { queryKeys } from "../lib/query/queryKeys";

export function useAttendanceAnalyticsOptionsQuery(academicYearId: number | null, jenjangId: number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.analytics.attendanceOptions(academicYearId, jenjangId),
    queryFn: () => fetchAttendanceAnalyticsOptions(academicYearId as number, jenjangId),
    enabled: enabled && academicYearId !== null,
  });
}

export function useAttendanceOverviewQuery(filters: AttendanceAnalyticsFilters | null, enabled = true) {
  return useQuery({ queryKey: filters ? queryKeys.analytics.attendance("overview", filters) : ["analytics", "attendance", "overview", "idle"], queryFn: () => fetchAttendanceOverview(filters as AttendanceAnalyticsFilters), enabled: enabled && filters !== null });
}

export function useAttendanceClassesQuery(filters: AttendanceAnalyticsFilters | null, enabled = true) {
  return useQuery({ queryKey: filters ? queryKeys.analytics.attendance("classes", filters) : ["analytics", "attendance", "classes", "idle"], queryFn: () => fetchAttendanceClasses(filters as AttendanceAnalyticsFilters), enabled: enabled && filters !== null });
}

export function useAttendanceJenjangQuery(filters: AttendanceAnalyticsFilters | null, enabled = true) {
  return useQuery({ queryKey: filters ? queryKeys.analytics.attendance("jenjang", filters) : ["analytics", "attendance", "jenjang", "idle"], queryFn: () => fetchAttendanceJenjang(filters as AttendanceAnalyticsFilters), enabled: enabled && filters !== null });
}

export function useAttendanceDailyQuery(filters: AttendanceAnalyticsFilters | null, enabled = true) {
  return useQuery({ queryKey: filters ? queryKeys.analytics.attendance("daily", filters) : ["analytics", "attendance", "daily", "idle"], queryFn: () => fetchAttendanceDaily(filters as AttendanceAnalyticsFilters), enabled: enabled && filters !== null });
}

export function useAttendanceStudentsQuery(filters: AttendanceStudentFilters | null, enabled = true) {
  return useQuery({ queryKey: filters ? queryKeys.analytics.attendance("students", filters) : ["analytics", "attendance", "students", "idle"], queryFn: () => fetchAttendanceStudents(filters as AttendanceStudentFilters), enabled: enabled && filters !== null });
}
