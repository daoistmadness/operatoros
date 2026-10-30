import { useQuery } from "@tanstack/react-query";
import {
  fetchAnalyticsCohorts,
  fetchAnalyticsFilters,
  fetchAnalyticsOverview,
  fetchAnalyticsTrends,
  fetchHistoricalTrends,
  fetchInterventionImpact,
  fetchManagementSummary,
  type CanonicalAnalyticsParams,
  type FetchHistoricalTrendsParams,
  type FetchInterventionImpactParams,
  type FetchSummaryParams,
} from "../api/analytics";
import { getDashboardSnapshot, getJenjangs } from "../lib/api/endpoints";
import { queryKeys } from "../lib/query/queryKeys";
import { fetchManagementOverview, type ManagementOverviewFilters } from "../api/managementOverview";
import { fetchConfiguredTerms, fetchManagementReviewProfile, type ManagementReviewProfileFilters } from "../api/managementReviewProfile";
import { fetchEffectiveTerms } from "../api/academicConfig";
import { fetchStudentTrendInsights, type StudentTrendFilters } from "../api/studentTrends";
import { fetchStudentIndicatorInsights, type StudentIndicatorFilters } from "../api/studentIndicators";
import { fetchAcademicPrograms } from "../api/academicMasters";
import { queryFreshness } from "../lib/query/queryConfig";

const filtersKey = (filters: { academic_year_id?: number | null; jenjang_id?: number | null }) => ({
  academic_year_id: filters.academic_year_id ?? null,
  jenjang_id: filters.jenjang_id ?? null,
});

export function useDashboardSnapshotQuery(month: number, year: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.dashboard.snapshot(month, year),
    queryFn: ({ signal }) => getDashboardSnapshot(new Date(year, month - 1, 1), signal),
    staleTime: queryFreshness.analytics,
    enabled,
  });
}

export function useAnalyticsFiltersQuery(filters: { academic_year_id?: number | null; jenjang_id?: number | null }, enabled = true) {
  return useQuery({
    queryKey: queryKeys.analytics.filters(filtersKey(filters)),
    queryFn: ({ signal }) => fetchAnalyticsFilters({ academic_year_id: filters.academic_year_id, jenjang_id: filters.jenjang_id }, signal),
    enabled,
  });
}

export function useManagementSummaryQuery(params: FetchSummaryParams | null, enabled = true) {
  return useQuery({
    queryKey: params ? queryKeys.analytics.managementSummary({ ...params }) : [...queryKeys.analytics.all, "management-summary", "idle"],
    queryFn: ({ signal }) => fetchManagementSummary(params as FetchSummaryParams, signal),
    enabled: enabled && params !== null,
  });
}

export function useManagementOverviewQuery(params: ManagementOverviewFilters | null, enabled = true) {
  return useQuery({
    queryKey: params ? queryKeys.analytics.managementOverview({ ...params }) : [...queryKeys.analytics.all, "management-overview", "idle"],
    queryFn: ({ signal }) => fetchManagementOverview(params as ManagementOverviewFilters, signal),
    enabled: enabled && params !== null,
  });
}

export function useManagementReviewTermsQuery(academicYearId: number | null, enabled = true) {
  return useQuery({ queryKey: queryKeys.analytics.managementReviewTerms(academicYearId), queryFn: ({ signal }) => fetchConfiguredTerms(academicYearId as number, signal), enabled: enabled && academicYearId !== null });
}

export function useAttendanceEffectiveTermsQuery(academicYearId: number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.analytics.attendanceEffectiveTerms(academicYearId),
    queryFn: ({ signal }) => fetchEffectiveTerms(academicYearId as number, signal),
    enabled: enabled && academicYearId !== null,
  });
}

export function useTardinessJenjangsQuery(enabled = true) {
  return useQuery({ queryKey: queryKeys.analytics.tardinessJenjangs, queryFn: ({ signal }) => getJenjangs(signal), enabled });
}

export function useManagementReviewProgramsQuery(enabled = true) {
  return useQuery({ queryKey: queryKeys.analytics.managementReviewPrograms(), queryFn: ({ signal }) => fetchAcademicPrograms(signal), enabled });
}

export function useManagementReviewProfileQuery(params: ManagementReviewProfileFilters | null, enabled = true) {
  return useQuery({ queryKey: params ? queryKeys.analytics.managementReviewProfile(params) : [...queryKeys.analytics.all, "management-review-profile", "idle"], queryFn: ({ signal }) => fetchManagementReviewProfile(params as ManagementReviewProfileFilters, signal), enabled: enabled && params !== null });
}

export function useStudentTrendInsightsQuery(params: StudentTrendFilters | null, enabled = true) {
  return useQuery({
    queryKey: params ? queryKeys.analytics.studentTrends(params) : ["analytics", "student-trends", "idle"],
    queryFn: ({ signal }) => fetchStudentTrendInsights(params as StudentTrendFilters, signal),
    enabled: enabled && params !== null,
  });
}

export function useStudentIndicatorInsightsQuery(params: StudentIndicatorFilters | null, enabled = true) {
  return useQuery({
    queryKey: params ? queryKeys.analytics.studentIndicators(params) : ["analytics", "student-indicators", "idle"],
    queryFn: ({ signal }) => fetchStudentIndicatorInsights(params as StudentIndicatorFilters, signal),
    enabled: enabled && params !== null,
  });
}

export function useHistoricalTrendsQuery(params: FetchHistoricalTrendsParams | null, enabled = true) {
  return useQuery({
    queryKey: params ? queryKeys.analytics.historicalTrends({ ...params }) : [...queryKeys.analytics.all, "historical-trends", "idle"],
    queryFn: ({ signal }) => fetchHistoricalTrends(params as FetchHistoricalTrendsParams, signal),
    enabled: enabled && params !== null,
  });
}

export function useInterventionImpactQuery(params: FetchInterventionImpactParams | null, enabled = true) {
  return useQuery({
    queryKey: params ? queryKeys.analytics.interventionImpact({ ...params }) : [...queryKeys.analytics.all, "intervention-impact", "idle"],
    queryFn: ({ signal }) => fetchInterventionImpact(params as FetchInterventionImpactParams, signal),
    enabled: enabled && params !== null,
  });
}

export function useAnalyticsOverviewQuery(params: CanonicalAnalyticsParams | null, enabled = true) {
  return useQuery({
    queryKey: params ? queryKeys.analytics.overview({ ...params }) : [...queryKeys.analytics.all, "overview", "idle"],
    queryFn: ({ signal }) => fetchAnalyticsOverview(params as CanonicalAnalyticsParams, signal),
    enabled: enabled && params !== null,
  });
}

export function useAnalyticsTrendsQuery(params: CanonicalAnalyticsParams | null, enabled = true) {
  return useQuery({
    queryKey: params ? queryKeys.analytics.trends({ ...params }) : [...queryKeys.analytics.all, "trends", "idle"],
    queryFn: ({ signal }) => fetchAnalyticsTrends(params as CanonicalAnalyticsParams, signal),
    enabled: enabled && params !== null,
  });
}

export function useAnalyticsCohortsQuery(dimension: "class" | "jenjang", params: CanonicalAnalyticsParams | null, enabled = true) {
  return useQuery({
    queryKey: params ? queryKeys.analytics.cohorts(dimension, { ...params }) : [...queryKeys.analytics.all, "cohorts", dimension, "idle"],
    queryFn: ({ signal }) => fetchAnalyticsCohorts(params as CanonicalAnalyticsParams, dimension, signal),
    enabled: enabled && params !== null,
  });
}
