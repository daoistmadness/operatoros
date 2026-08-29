import type {
  AttendanceAnalyticsOptionsResponse,
  AttendanceClassesResponse,
  AttendanceDailyResponse,
  AttendanceJenjangResponse,
  AttendanceOverviewResponse,
  AttendanceStudentsResponse,
} from "@operatoros/contracts/analytics";
import { API_BLOB_TYPES, apiRequest } from "../lib/api/client";

export type AttendanceAnalyticsFilters = {
  academic_year_id: number;
  date_from: string;
  date_to: string;
  jenjang_id?: number | null;
  class_id?: number | null;
};

export type AttendanceStudentFilters = AttendanceAnalyticsFilters & {
  search?: string;
  sort?: "name" | "attendance_rate" | "late" | "alfa";
  order?: "asc" | "desc";
  page?: number;
  page_size?: number;
};

function params(filters: AttendanceAnalyticsFilters) {
  return {
    academic_year_id: filters.academic_year_id,
    date_from: filters.date_from,
    date_to: filters.date_to,
    jenjang_id: filters.jenjang_id ?? undefined,
    class_id: filters.class_id ?? undefined,
  };
}

export async function fetchAttendanceAnalyticsOptions(academicYearId: number, jenjangId?: number | null): Promise<AttendanceAnalyticsOptionsResponse> {
  const response = await apiRequest<AttendanceAnalyticsOptionsResponse>({ path: "/api/analytics/attendance/options", params: { academic_year_id: academicYearId, jenjang_id: jenjangId ?? undefined } });
  return response.data;
}

export async function fetchAttendanceOverview(filters: AttendanceAnalyticsFilters): Promise<AttendanceOverviewResponse> {
  const response = await apiRequest<AttendanceOverviewResponse>({ path: "/api/analytics/attendance/overview", params: params(filters) });
  return response.data;
}

export async function fetchAttendanceClasses(filters: AttendanceAnalyticsFilters): Promise<AttendanceClassesResponse> {
  const response = await apiRequest<AttendanceClassesResponse>({ path: "/api/analytics/attendance/classes", params: params(filters) });
  return response.data;
}

export async function fetchAttendanceJenjang(filters: AttendanceAnalyticsFilters): Promise<AttendanceJenjangResponse> {
  const response = await apiRequest<AttendanceJenjangResponse>({ path: "/api/analytics/attendance/jenjang", params: params(filters) });
  return response.data;
}

export async function fetchAttendanceDaily(filters: AttendanceAnalyticsFilters): Promise<AttendanceDailyResponse> {
  const response = await apiRequest<AttendanceDailyResponse>({ path: "/api/analytics/attendance/daily", params: params(filters) });
  return response.data;
}

export async function fetchAttendanceStudents(filters: AttendanceStudentFilters): Promise<AttendanceStudentsResponse> {
  const response = await apiRequest<AttendanceStudentsResponse>({ path: "/api/analytics/attendance/students", params: { ...params(filters), search: filters.search || undefined, sort: filters.sort ?? "name", order: filters.order ?? "asc", page: filters.page ?? 1, page_size: filters.page_size ?? 25 } });
  return response.data;
}

export async function downloadAttendanceAnalytics(filters: AttendanceAnalyticsFilters): Promise<Blob> {
  const response = await apiRequest({ path: "/api/analytics/attendance/export-excel", params: params(filters), responseType: "blob", expectedBlobTypes: API_BLOB_TYPES.excel });
  return response.data;
}
