import type { StudentTrendInsightsResponse } from "@operatoros/contracts/analytics";
import { apiRequest } from "../lib/api/client";

export type StudentTrendFilters = {
  window: "rolling_4w" | "term";
  academic_year_id: number;
  jenjang_id?: number | null;
  class_id?: number | null;
  search?: string;
  sort?: "name" | "attendance_delta" | "academic_delta" | "tardiness_delta" | "alfa_delta";
  order?: "asc" | "desc";
  page?: number;
  page_size?: number;
};

export async function fetchStudentTrendInsights(filters: StudentTrendFilters): Promise<StudentTrendInsightsResponse> {
  const response = await apiRequest<StudentTrendInsightsResponse>({
    path: "/api/analytics/student-trends",
    params: {
      window: filters.window,
      academic_year_id: filters.academic_year_id,
      jenjang_id: filters.jenjang_id ?? undefined,
      class_id: filters.class_id ?? undefined,
      search: filters.search || undefined,
      sort: filters.sort ?? "name",
      order: filters.order ?? "asc",
      page: filters.page ?? 1,
      page_size: filters.page_size ?? 25,
    },
  });
  return response.data;
}
