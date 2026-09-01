import { apiRequest } from "../lib/api/client";
import type { DataQualityIssuesResponse, DataQualityResolutionResponse, StaffDataQualityResponse, StudentDataQualityResponse } from "@operatoros/contracts/analytics";
import type { QueryParams } from "../lib/api/client";

export type StudentQualityFilters = QueryParams & { status?: string };

export type StaffQualityFilters = QueryParams & { employment_status?: string };

export type DataQualityResolutionFilters = QueryParams & {
  entity_type?: string;
  quality_state?: string;
  resolution_class?: string;
  field?: string;
  search?: string;
  page?: number;
  page_size?: number;
};

export async function fetchDataQualityResolution(filters: DataQualityResolutionFilters = {}): Promise<DataQualityResolutionResponse> {
  const response = await apiRequest<DataQualityResolutionResponse>({ path: "/api/analytics/data-quality/resolution", params: filters });
  return response.data;
}

export async function fetchStudentQuality(filters: StudentQualityFilters): Promise<StudentDataQualityResponse> {
  const response = await apiRequest<StudentDataQualityResponse>({ path: "/api/analytics/data-quality/students", params: filters });
  return response.data;
}

export async function fetchStudentQualityIssues(filters: StudentQualityFilters & { field?: string; type?: string; page?: number; page_size?: number }): Promise<DataQualityIssuesResponse> {
  const response = await apiRequest<DataQualityIssuesResponse>({ path: "/api/analytics/data-quality/students/issues", params: filters });
  return response.data;
}

export async function fetchStaffQuality(filters: StaffQualityFilters): Promise<StaffDataQualityResponse> {
  const response = await apiRequest<StaffDataQualityResponse>({ path: "/api/analytics/data-quality/staff", params: filters });
  return response.data;
}

export async function fetchStaffQualityIssues(filters: StaffQualityFilters & { field?: string; type?: string; page?: number; page_size?: number }): Promise<DataQualityIssuesResponse> {
  const response = await apiRequest<DataQualityIssuesResponse>({ path: "/api/analytics/data-quality/staff/issues", params: filters });
  return response.data;
}

export async function downloadStudentQualityExcel(filters: StudentQualityFilters): Promise<Blob> {
  const response = await apiRequest<Blob>({
    path: "/api/analytics/data-quality/students/export-excel",
    params: filters,
    responseType: "blob",
    timeout: 60000,
    expectedBlobTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  });
  return response.data;
}

export async function downloadStaffQualityExcel(filters: StaffQualityFilters): Promise<Blob> {
  const response = await apiRequest<Blob>({
    path: "/api/analytics/data-quality/staff/export-excel",
    params: filters,
    responseType: "blob",
    timeout: 60000,
    expectedBlobTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  });
  return response.data;
}
