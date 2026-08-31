import type { DailyAttendanceOperationsResponse } from "@operatoros/contracts/attendance";
import { apiRequest } from "../lib/api/client";

export type DailyAttendanceFilters = { date: string; academic_year_id?: number | null; jenjang_id?: number | null; class_id?: number | null };

export async function fetchDailyAttendance(filters: DailyAttendanceFilters): Promise<DailyAttendanceOperationsResponse> {
  const response = await apiRequest<DailyAttendanceOperationsResponse>({ path: "/api/attendance/daily-status", params: { date: filters.date, academic_year_id: filters.academic_year_id ?? undefined, jenjang_id: filters.jenjang_id ?? undefined, class_id: filters.class_id ?? undefined } });
  return response.data;
}
