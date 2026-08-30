import type { ManagementOverviewResponse } from "@operatoros/contracts/analytics";
import { apiRequest } from "../lib/api/client";

export type ManagementOverviewFilters = {
  academic_year_id: number;
  jenjang_id?: number | null;
  class_id?: number | null;
  attendance_date_from?: string | null;
  attendance_date_to?: string | null;
};

export async function fetchManagementOverview(filters: ManagementOverviewFilters): Promise<ManagementOverviewResponse> {
  const response = await apiRequest<ManagementOverviewResponse>({
    path: "/api/analytics/management-overview",
    params: {
      academic_year_id: String(filters.academic_year_id),
      jenjang_id: filters.jenjang_id === null || filters.jenjang_id === undefined ? undefined : String(filters.jenjang_id),
      class_id: filters.class_id === null || filters.class_id === undefined ? undefined : String(filters.class_id),
      attendance_date_from: filters.attendance_date_from ?? undefined,
      attendance_date_to: filters.attendance_date_to ?? undefined,
    },
  });
  return response.data;
}
