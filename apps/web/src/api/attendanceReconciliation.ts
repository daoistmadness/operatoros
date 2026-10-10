import type {
  AttendanceReconciliationQuery, AttendanceReconciliationResponse,
  AttendanceReviewMutation, AttendanceReviewReopen,
} from "@operatoros/contracts/analytics";
import { apiRequest } from "../lib/api/client";

export async function getAttendanceReconciliation(query: AttendanceReconciliationQuery) {
  return (await apiRequest<AttendanceReconciliationResponse>({
    path: "/api/attendance/reconciliation",
    params: query,
  })).data;
}

export async function submitAttendanceReview(payload: AttendanceReviewMutation) {
  return (await apiRequest<AttendanceReconciliationResponse>({
    path: "/api/attendance/reconciliation/review", method: "POST", body: payload,
  })).data;
}

export async function reopenAttendanceReview(payload: AttendanceReviewReopen) {
  return (await apiRequest<AttendanceReconciliationResponse>({
    path: "/api/attendance/reconciliation/reopen", method: "POST", body: payload,
  })).data;
}
