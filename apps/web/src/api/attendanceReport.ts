import type {
  AttendanceReportQuery,
  AttendanceReportResponse,
} from "@operatoros/contracts/reports";
import { apiRequest } from "../lib/api/client";

export async function fetchAttendanceReport(query: AttendanceReportQuery): Promise<AttendanceReportResponse> {
  return (await apiRequest<AttendanceReportResponse>({
    path: "/api/analytics/attendance-report",
    params: query,
  })).data;
}
