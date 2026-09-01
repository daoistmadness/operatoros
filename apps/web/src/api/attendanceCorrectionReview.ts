import type { AttendanceCorrectionReviewResponse } from "@operatoros/contracts/attendance";
import { apiRequest } from "../lib/api/client";

export type AttendanceCorrectionReviewFilters = {
  academic_year_id: number;
  jenjang_id?: number | null;
  class_id?: number | null;
  date_from?: string | null;
  date_to?: string | null;
  base_status?: string | null;
  effective_status?: string | null;
  student_search?: string | null;
  page?: number;
  page_size?: number;
};

export async function fetchAttendanceCorrectionReview(filters: AttendanceCorrectionReviewFilters): Promise<AttendanceCorrectionReviewResponse> {
  return (await apiRequest<AttendanceCorrectionReviewResponse>({
    path: "/api/attendance/override-review",
    params: {
      academic_year_id: filters.academic_year_id,
      jenjang_id: filters.jenjang_id ?? undefined,
      class_id: filters.class_id ?? undefined,
      date_from: filters.date_from ?? undefined,
      date_to: filters.date_to ?? undefined,
      base_status: filters.base_status ?? undefined,
      effective_status: filters.effective_status ?? undefined,
      student_search: filters.student_search ?? undefined,
      page: filters.page ?? 1,
      page_size: filters.page_size ?? 25,
    },
  })).data;
}
