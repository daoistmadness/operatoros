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
import { getDashboardSnapshot } from "../lib/api/endpoints";
import { queryKeys } from "../lib/query/queryKeys";

const filtersKey = (filters: { academic_year_id?: number | null; jenjang_id?: number | null }) => ({
  academic_year_id: filters.academic_year_id ?? null,
  jenjang_id: filters.jenjang_id ?? null,
});

export function useDashboardSnapshotQuery(month: number, year: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.dashboard.snapshot(month, year),
    queryFn: () => getDashboardSnapshot(new Date(year, month - 1, 1)),
    enabled,
  });
}

export function useAnalyticsFiltersQuery(filters: { academic_year_id?: number | null; jenjang_id?: number | null }, enabled = true) {
  return useQuery({
    queryKey: queryKeys.analytics.filters(filtersKey(filters)),
    queryFn: () => fetchAnalyticsFilters({ academic_year_id: filters.academic_year_id, jenjang_id: filters.jenjang_id }),
    enabled,
  });
}

export function useManagementSummaryQuery(params: FetchSummaryParams | null, enabled = true) {
  return useQuery({
    queryKey: params ? queryKeys.analytics.managementSummary({ ...params }) : [...queryKeys.analytics.all, "management-summary", "idle"],
    queryFn: () => fetchManagementSummary(params as FetchSummaryParams),
    enabled: enabled && params !== null,
  });
}

export function useHistoricalTrendsQuery(params: FetchHistoricalTrendsParams | null, enabled = true) {
  return useQuery({
    queryKey: params ? queryKeys.analytics.historicalTrends({ ...params }) : [...queryKeys.analytics.all, "historical-trends", "idle"],
    queryFn: () => fetchHistoricalTrends(params as FetchHistoricalTrendsParams),
    enabled: enabled && params !== null,
  });
}

export function useInterventionImpactQuery(params: FetchInterventionImpactParams | null, enabled = true) {
  return useQuery({
    queryKey: params ? queryKeys.analytics.interventionImpact({ ...params }) : [...queryKeys.analytics.all, "intervention-impact", "idle"],
    queryFn: () => fetchInterventionImpact(params as FetchInterventionImpactParams),
    enabled: enabled && params !== null,
  });
}

export function useAnalyticsOverviewQuery(params: CanonicalAnalyticsParams | null, enabled = true) {
  return useQuery({
    queryKey: params ? queryKeys.analytics.overview({ ...params }) : [...queryKeys.analytics.all, "overview", "idle"],
    queryFn: () => fetchAnalyticsOverview(params as CanonicalAnalyticsParams),
    enabled: enabled && params !== null,
  });
}

export function useAnalyticsTrendsQuery(params: CanonicalAnalyticsParams | null, enabled = true) {
  return useQuery({
    queryKey: params ? queryKeys.analytics.trends({ ...params }) : [...queryKeys.analytics.all, "trends", "idle"],
    queryFn: () => fetchAnalyticsTrends(params as CanonicalAnalyticsParams),
    enabled: enabled && params !== null,
  });
}

export function useAnalyticsCohortsQuery(dimension: "class" | "jenjang", params: CanonicalAnalyticsParams | null, enabled = true) {
  return useQuery({
    queryKey: params ? queryKeys.analytics.cohorts(dimension, { ...params }) : [...queryKeys.analytics.all, "cohorts", dimension, "idle"],
    queryFn: () => fetchAnalyticsCohorts(params as CanonicalAnalyticsParams, dimension),
    enabled: enabled && params !== null,
  });
}
