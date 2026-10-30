import { API_BLOB_TYPES, apiRequest } from "../lib/api/client";
import type {
  AnalyticsCohortsResponse,
  AnalyticsOverviewResponse,
  AnalyticsTrendsResponse,
} from "@operatoros/contracts/analytics";
import type {
  AnalyticsFiltersResponse,
  HistoricalTrendsResponse,
  InterventionImpactResponse,
  ManagementSummaryResponse,
} from "../types/analytics";

export interface CanonicalAnalyticsParams {
  academic_year_id: number;
  start_date?: string | null;
  end_date?: string | null;
  jenjang_id?: number | null;
  class_name?: string | null;
  subject_id?: number | null;
}

function canonicalParams(params: CanonicalAnalyticsParams) {
  return {
    academic_year_id: params.academic_year_id,
    start_date: params.start_date ?? undefined,
    end_date: params.end_date ?? undefined,
    jenjang_id: params.jenjang_id ?? undefined,
    class_name: params.class_name ?? undefined,
    subject_id: params.subject_id ?? undefined,
  };
}

export async function fetchAnalyticsOverview(params: CanonicalAnalyticsParams, signal?: AbortSignal): Promise<AnalyticsOverviewResponse> {
  const response = await apiRequest<AnalyticsOverviewResponse>({ path: analyticsApiPath("/overview"), method: "GET", params: canonicalParams(params), ...(signal ? { signal } : {}) });
  return response.data;
}

export async function fetchAnalyticsTrends(params: CanonicalAnalyticsParams, signal?: AbortSignal): Promise<AnalyticsTrendsResponse> {
  const response = await apiRequest<AnalyticsTrendsResponse>({ path: analyticsApiPath("/trends"), method: "GET", params: canonicalParams(params), ...(signal ? { signal } : {}) });
  return response.data;
}

export async function fetchAnalyticsCohorts(params: CanonicalAnalyticsParams, dimension: "class" | "jenjang", signal?: AbortSignal): Promise<AnalyticsCohortsResponse> {
  const response = await apiRequest<AnalyticsCohortsResponse>({ path: analyticsApiPath("/cohorts"), method: "GET", params: { ...canonicalParams(params), dimension }, ...(signal ? { signal } : {}) });
  return response.data;
}

export function analyticsApiPath(path: string): string {
  return `/api/analytics${path}`;
}

export interface FetchSummaryParams {
  academic_year_id: number;
  jenjang_id?: number | null;
  class_name?: string | null;
  term?: string | null;
  subject_id?: number | null;
}

export interface FetchHistoricalTrendsParams extends FetchSummaryParams {
  granularity?: "month" | "term" | "academic_year";
  include_forecast?: boolean;
  forecast_method?: "moving_average" | "weighted_moving_average" | "linear_trend";
}

export interface FetchInterventionImpactParams extends FetchSummaryParams {
  student_id?: number | null;
  status?: string | null;
  priority?: string | null;
  owner_name?: string | null;
  risk_level?: string | null;
}

export async function fetchAnalyticsFilters(params?: {
  academic_year_id?: number | null;
  jenjang_id?: number | null;
}, signal?: AbortSignal): Promise<AnalyticsFiltersResponse> {
  const response = await apiRequest<AnalyticsFiltersResponse>({
    path: analyticsApiPath("/filters"),
    method: "GET",
    params,
    ...(signal ? { signal } : {}),
  });

  return response.data;
}

export async function fetchManagementSummary(
  params: FetchSummaryParams,
  signal?: AbortSignal,
): Promise<ManagementSummaryResponse> {
  const response = await apiRequest<ManagementSummaryResponse>({
    path: analyticsApiPath("/management-summary"),
    method: "GET",
    params: {
      academic_year_id: params.academic_year_id,
      jenjang_id: params.jenjang_id ?? undefined,
      class_name: params.class_name ?? undefined,
      term: params.term ?? undefined,
      subject_id: params.subject_id ?? undefined,
    },
    ...(signal ? { signal } : {}),
  });

  return response.data;
}

export async function fetchHistoricalTrends(
  params: FetchHistoricalTrendsParams,
  signal?: AbortSignal,
): Promise<HistoricalTrendsResponse> {
  const response = await apiRequest<HistoricalTrendsResponse>({
    path: analyticsApiPath("/historical-trends"),
    method: "GET",
    params: {
      academic_year_id: params.academic_year_id,
      jenjang_id: params.jenjang_id ?? undefined,
      class_name: params.class_name ?? undefined,
      term: params.term ?? undefined,
      subject_id: params.subject_id ?? undefined,
      granularity: params.granularity ?? "term",
      include_forecast: params.include_forecast ?? true,
      forecast_method: params.forecast_method ?? "linear_trend",
    },
    ...(signal ? { signal } : {}),
  });

  return response.data;
}

export async function fetchInterventionImpact(
  params: FetchInterventionImpactParams,
  signal?: AbortSignal,
): Promise<InterventionImpactResponse> {
  const response = await apiRequest<InterventionImpactResponse>({
    path: analyticsApiPath("/intervention-impact"),
    method: "GET",
    params: {
      academic_year_id: params.academic_year_id,
      jenjang_id: params.jenjang_id ?? undefined,
      class_name: params.class_name ?? undefined,
      term: params.term ?? undefined,
      subject_id: params.subject_id ?? undefined,
      student_id: params.student_id ?? undefined,
      status: params.status ?? undefined,
      priority: params.priority ?? undefined,
      owner_name: params.owner_name ?? undefined,
      risk_level: params.risk_level ?? undefined,
    },
    ...(signal ? { signal } : {}),
  });

  return response.data;
}

function exportParams(params: FetchSummaryParams & { mode?: string }) {
  return {
    academic_year_id: params.academic_year_id,
    jenjang_id: params.jenjang_id ?? undefined,
    class_name: params.class_name ?? undefined,
    term: params.term ?? undefined,
    subject_id: params.subject_id ?? undefined,
    mode: params.mode ?? undefined,
  };
}

export async function downloadManagementSummaryPdf(params: FetchSummaryParams & { mode?: string }): Promise<Blob> {
  const response = await apiRequest<Blob>({
    path: analyticsApiPath("/management-summary/export/pdf"),
    method: "GET",
    params: exportParams(params),
    responseType: "blob",
    expectedBlobTypes: API_BLOB_TYPES.pdf,
  });

  return response.data;
}

export async function downloadManagementSummaryExcel(params: FetchSummaryParams & { mode?: string }): Promise<Blob> {
  const response = await apiRequest<Blob>({
    path: analyticsApiPath("/management-summary/export/excel"),
    method: "GET",
    params: exportParams(params),
    responseType: "blob",
    expectedBlobTypes: API_BLOB_TYPES.excel,
  });

  return response.data;
}
