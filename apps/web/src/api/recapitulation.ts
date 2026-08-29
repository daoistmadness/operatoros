import { apiRequest } from "../lib/api/client";
import type { StudentRecapResponse, StaffRecapResponse } from "@operatoros/contracts/analytics";
import type { QueryParams } from "../lib/api/client";

export type StudentRecapFilters = QueryParams & { dimension: string };

export type StaffRecapFilters = QueryParams & { dimension: string };

export async function fetchStudentRecap(filters: StudentRecapFilters): Promise<StudentRecapResponse> {
  const response = await apiRequest<StudentRecapResponse>({ path: "/api/analytics/recapitulation/students", params: filters });
  return response.data;
}

export async function fetchStaffRecap(filters: StaffRecapFilters): Promise<StaffRecapResponse> {
  const response = await apiRequest<StaffRecapResponse>({ path: "/api/analytics/recapitulation/staff", params: filters });
  return response.data;
}

export async function downloadStudentRecapExcel(filters: Omit<StudentRecapFilters, "dimension">): Promise<Blob> {
  const response = await apiRequest({
    path: "/api/analytics/recapitulation/students/export-excel",
    params: filters,
    responseType: "blob",
    timeout: 60000,
    expectedBlobTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  });
  return response.data;
}

export async function downloadStaffRecapExcel(filters: Omit<StaffRecapFilters, "dimension">): Promise<Blob> {
  const response = await apiRequest({
    path: "/api/analytics/recapitulation/staff/export-excel",
    params: filters,
    responseType: "blob",
    timeout: 60000,
    expectedBlobTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  });
  return response.data;
}
