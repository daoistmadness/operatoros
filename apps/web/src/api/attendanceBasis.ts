import type { AttendanceBasisResponse } from "@operatoros/contracts/analytics";
import { apiRequest } from "../lib/api/client";

export async function getAttendanceBasis(academicYearId: number, month: string) {
  return (await apiRequest<AttendanceBasisResponse>({
    path: "/api/analytics/attendance/basis",
    params: { academic_year_id: academicYearId, month },
  })).data;
}
