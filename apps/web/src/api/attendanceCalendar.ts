import type { AttendanceCalendarExceptionRequest, AttendanceCalendarOverview, AttendanceCalendarWeekdayRequest, AttendanceSubmissionDeadlineRequest } from "@operatoros/contracts/attendance";
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
