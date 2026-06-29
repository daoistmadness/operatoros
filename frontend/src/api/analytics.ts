import { API_BASE_URL, apiRequest } from "../lib/api/client";
import type {
  AnalyticsFiltersResponse,
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
