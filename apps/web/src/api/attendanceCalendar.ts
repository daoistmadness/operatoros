import type { AttendanceCalendarExceptionRequest, AttendanceCalendarOverview, AttendanceCalendarPeriodApplyRequest, AttendanceCalendarPeriodApplyResponse, AttendanceCalendarPeriodPreviewResponse, AttendanceCalendarPeriodRequest, AttendanceCalendarWeekdayRequest, AttendanceSubmissionDeadlineRequest } from "@operatoros/contracts/attendance";
import { apiRequest } from "../lib/api/client";

export type AttendanceCalendarRuleValue = "EXPECTED" | "NOT_EXPECTED";

export async function fetchAttendanceCalendar(academicYearId: number): Promise<AttendanceCalendarOverview> {
  const response = await apiRequest<AttendanceCalendarOverview>({ path: "/api/attendance/calendar", params: { academic_year_id: academicYearId } });
  return response.data;
}

export async function saveAttendanceCalendarWeekday(payload: AttendanceCalendarWeekdayRequest): Promise<void> {
  await apiRequest({ path: "/api/attendance/calendar/weekday", method: "PUT", body: payload });
}

export async function saveAttendanceCalendarException(payload: AttendanceCalendarExceptionRequest): Promise<void> {
  await apiRequest({ path: "/api/attendance/calendar/exception", method: "PUT", body: payload });
}

export async function deleteAttendanceCalendarException(id: number): Promise<void> {
  await apiRequest({ path: `/api/attendance/calendar/exception/${id}`, method: "DELETE" });
}

export async function saveAttendanceSubmissionDeadline(payload: AttendanceSubmissionDeadlineRequest): Promise<void> {
  await apiRequest({ path: "/api/attendance/calendar/deadline", method: "PUT", body: payload });
}

export async function previewAttendanceCalendarPeriod(payload: AttendanceCalendarPeriodRequest): Promise<AttendanceCalendarPeriodPreviewResponse> {
  const response = await apiRequest<AttendanceCalendarPeriodPreviewResponse>({ path: "/api/attendance/calendar/period/preview", method: "POST", body: payload });
  return response.data;
}

export async function applyAttendanceCalendarPeriod(payload: AttendanceCalendarPeriodApplyRequest): Promise<AttendanceCalendarPeriodApplyResponse> {
  const response = await apiRequest<AttendanceCalendarPeriodApplyResponse>({ path: "/api/attendance/calendar/period/apply", method: "POST", body: payload });
  return response.data;
}
