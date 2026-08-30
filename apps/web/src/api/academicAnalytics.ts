import type { AcademicAnalyticsOptionsResponse, AcademicAnalyticsOverviewResponse, AcademicAnalyticsStudentsResponse } from "@operatoros/contracts/analytics";
import { API_BLOB_TYPES, apiRequest } from "../lib/api/client";

export type AcademicAnalyticsFilters = {
  academic_year_id: number;
  jenjang_id?: number | null;
  class_id?: number | null;
  subject_id?: number | null;
  assessment_type?: "sumatif" | "formatif" | null;
};

export type AcademicStudentFilters = AcademicAnalyticsFilters & {
  search?: string;
  sort?: "name" | "average" | "formative" | "summative" | "missing";
  order?: "asc" | "desc";
  page?: number;
  page_size?: number;
};

function params(filters: AcademicAnalyticsFilters) {
  return { academic_year_id: filters.academic_year_id, jenjang_id: filters.jenjang_id ?? undefined, class_id: filters.class_id ?? undefined, subject_id: filters.subject_id ?? undefined, assessment_type: filters.assessment_type ?? undefined };
}

export async function fetchAcademicAnalyticsOptions(academicYearId: number, jenjangId?: number | null): Promise<AcademicAnalyticsOptionsResponse> {
  const response = await apiRequest<AcademicAnalyticsOptionsResponse>({ path: "/api/analytics/academic/options", params: { academic_year_id: academicYearId, jenjang_id: jenjangId ?? undefined } });
  return response.data;
}

export async function fetchAcademicAnalyticsOverview(filters: AcademicAnalyticsFilters): Promise<AcademicAnalyticsOverviewResponse> {
  const response = await apiRequest<AcademicAnalyticsOverviewResponse>({ path: "/api/analytics/academic/overview", params: params(filters) });
  return response.data;
}

export async function fetchAcademicAnalyticsStudents(filters: AcademicStudentFilters): Promise<AcademicAnalyticsStudentsResponse> {
  const response = await apiRequest<AcademicAnalyticsStudentsResponse>({ path: "/api/analytics/academic/students", params: { ...params(filters), search: filters.search || undefined, sort: filters.sort ?? "name", order: filters.order ?? "asc", page: filters.page ?? 1, page_size: filters.page_size ?? 25 } });
  return response.data;
}

export async function downloadAcademicAnalytics(filters: AcademicAnalyticsFilters): Promise<Blob> {
  const response = await apiRequest({ path: "/api/analytics/academic/export-excel", params: params(filters), responseType: "blob", expectedBlobTypes: API_BLOB_TYPES.excel });
  return response.data;
}
