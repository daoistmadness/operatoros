import { API_BASE_URL, API_BLOB_TYPES, apiRequest } from "../lib/api/client";
import type {
  AnalyticsFiltersResponse,
  HistoricalTrendsResponse,
  InterventionImpactResponse,
  ManagementSummaryResponse,
} from "../types/analytics";

export function analyticsApiPath(path: string): string {
  const apiBaseOwnsPrefix = /(?:^|\/)api\/?$/.test(API_BASE_URL);
  return apiBaseOwnsPrefix ? `/api/api/analytics${path}` : `/api/analytics${path}`;
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
}): Promise<AnalyticsFiltersResponse> {
  const response = await apiRequest<AnalyticsFiltersResponse>({
    path: analyticsApiPath("/filters"),
    method: "GET",
    params,
  });

  return response.data;
}

export async function fetchManagementSummary(
  params: FetchSummaryParams
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
  });

  return response.data;
}

export async function fetchHistoricalTrends(
  params: FetchHistoricalTrendsParams
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
  });

  return response.data;
}

export async function fetchInterventionImpact(
  params: FetchInterventionImpactParams
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
