import { useQuery } from "@tanstack/react-query";
import { getAnnualReport, getMonthlyReport, getReportFilters, type ReportQuery, type ReportScope } from "../api/reports";
import { queryKeys } from "../lib/query/queryKeys";

export const useReportFilters = (academicYearId: number | null, scope: ReportScope) => useQuery({
  queryKey: queryKeys.reports.filters(academicYearId, scope),
  queryFn: () => getReportFilters({ academic_year_id: academicYearId, scope }),
});

export const useMonthlyReport = (query: ReportQuery | null) => useQuery({
  queryKey: query ? queryKeys.reports.detail("monthly", query) : [...queryKeys.reports.all, "monthly", "idle"],
  queryFn: () => getMonthlyReport(query as ReportQuery),
  enabled: query !== null,
});

export const useAnnualReport = (query: ReportQuery | null) => useQuery({
  queryKey: query ? queryKeys.reports.detail("annual", query) : [...queryKeys.reports.all, "annual", "idle"],
  queryFn: () => getAnnualReport(query as ReportQuery),
  enabled: query !== null,
});
