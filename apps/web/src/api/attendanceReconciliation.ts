import type { AttendanceReconciliationQuery, AttendanceReconciliationResponse } from "@operatoros/contracts/analytics";
import { apiRequest } from "../lib/api/client";

export async function getAttendanceReconciliation(query: AttendanceReconciliationQuery) {
  return (await apiRequest<AttendanceReconciliationResponse>({
    path: "/api/attendance/reconciliation",
    params: query,
  })).data;
}
