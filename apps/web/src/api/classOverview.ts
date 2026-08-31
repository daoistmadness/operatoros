import type { ClassOverviewResponse } from "@operatoros/contracts/classes";
import { apiRequest } from "../lib/api/client";

export type ClassOverviewFilters = {
  term?: "term_1" | "term_2" | "term_3" | "term_4" | null;
  attendance_date_from?: string | null;
  attendance_date_to?: string | null;
  search?: string | null;
};

export async function fetchClassOverview(classId: string, filters: ClassOverviewFilters = {}): Promise<ClassOverviewResponse> {
  const response = await apiRequest<ClassOverviewResponse>({
    path: `/api/classes/${encodeURIComponent(classId)}/overview`,
    params: {
      term: filters.term ?? undefined,
      attendance_date_from: filters.attendance_date_from ?? undefined,
      attendance_date_to: filters.attendance_date_to ?? undefined,
      search: filters.search ?? undefined,
    },
  });
  return response.data;
}
