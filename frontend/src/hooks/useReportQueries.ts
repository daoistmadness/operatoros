import { useQuery } from "@tanstack/react-query";
import { getAnnualReport, getMonthlyReport, getReportFilters, type ReportQuery, type ReportScope, type ReportType } from "../api/reports";
import { queryKeys } from "../lib/query/queryKeys";

export const useReportFilters = (academicYearId: number | null, scope: ReportScope) => useQuery({
  queryKey: queryKeys.reports.filters(academicYearId, scope),
  queryFn: () => getReportFilters({ academic_year_id: academicYearId, scope }),
});

export const useExecutiveReport = (type: ReportType, query: ReportQuery | null) => useQuery({
  queryKey: query ? queryKeys.reports.detail(type, query) : [...queryKeys.reports.all, type, "idle"],
  queryFn: () => type === "monthly" ? getMonthlyReport(query as ReportQuery) : getAnnualReport(query as ReportQuery),
  enabled: query !== null,
});
