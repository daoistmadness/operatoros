import { useQuery } from "@tanstack/react-query";
import { fetchAcademicAnalyticsOptions, fetchAcademicAnalyticsOverview, fetchAcademicAnalyticsStudents, type AcademicAnalyticsFilters, type AcademicStudentFilters } from "../api/academicAnalytics";
import { queryKeys } from "../lib/query/queryKeys";

export function useAcademicAnalyticsOptionsQuery(academicYearId: number | null, jenjangId: number | null, enabled = true) {
  return useQuery({ queryKey: queryKeys.analytics.academicOptions(academicYearId, jenjangId), queryFn: () => fetchAcademicAnalyticsOptions(academicYearId as number, jenjangId), enabled: enabled && academicYearId !== null });
}

export function useAcademicAnalyticsOverviewQuery(filters: AcademicAnalyticsFilters | null, enabled = true) {
  return useQuery({ queryKey: filters ? queryKeys.analytics.academicOverview(filters) : ["analytics", "academic", "overview", "idle"], queryFn: () => fetchAcademicAnalyticsOverview(filters as AcademicAnalyticsFilters), enabled: enabled && filters !== null });
}

export function useAcademicAnalyticsStudentsQuery(filters: AcademicStudentFilters | null, enabled = true) {
  return useQuery({ queryKey: filters ? queryKeys.analytics.academicStudents(filters) : ["analytics", "academic", "students", "idle"], queryFn: () => fetchAcademicAnalyticsStudents(filters as AcademicStudentFilters), enabled: enabled && filters !== null });
}
