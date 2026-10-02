import type { StaffAnalyticsSummaryDto } from "@operatoros/contracts/staff";
import { apiRequest } from "../lib/api/client";

export type JenjangOption = { id: number; name: string; code: string | null; level: string | null; active: boolean };
export type EducationRecord = { id: number; education_level: string; institution_name: string; major: string | null; graduation_year: number | null; notes: string | null; created_at?: string; updated_at?: string };
export type EducationSummary = { items: EducationRecord[]; highest_education_level: string | null; highest_education_institution: string | null; highest_education_graduation_year: number | null };
export type StaffSummary = {
  id: string; source_staff_id: string | null; full_name: string; employment_status: string; job_title: string | null;
  employment_start_date: string | null; employment_end_date: string | null; dapodik_status: string; nip: string | null;
  has_nuptk: boolean; jenjangs: JenjangOption[]; service_years: number | null; service_months: number | null;
  highest_education_level: string | null; highest_education_institution: string | null;
};
export type StaffDetail = StaffSummary & {
  job_title_raw: string | null; dapodik_status_raw: string | null;
  updated_at: string; identifiers: Array<{ identifier_type: string; normalized_value: string; verification_status: string }>;
  education_history: EducationRecord[]; highest_education_level?: string | null; highest_education_institution?: string | null;
};
export type StaffSensitive = {
  birth_place: string | null; birth_date: string | null;
  identifiers: Array<{ type: string; normalized_value: string | null; verification_status: string }>;
  contact: { email: string | null; phone: string | null; address: string | null } | null;
};
export type StaffListResponse = { items: StaffSummary[]; total: number; page: number; page_size: number; total_pages: number; counts: { ACTIVE: number; FORMER: number; ALL: number } };
export type StaffListParams = {
  search?: string; status?: string; job_title?: string; dapodik_status?: string; jenjang_id?: number;
  position_id?: number; joined_from?: string; joined_to?: string;
  has_nuptk?: boolean; page?: number; page_size?: number; sort_by?: string; sort_direction?: "asc" | "desc";
};
export type StaffPayload = {
  full_name: string; source_staff_id?: string | null; employment_status?: "ACTIVE" | "FORMER";
  birth_place?: string | null; birth_date?: string | null; job_title_raw?: string | null;
  employment_start_date?: string | null; employment_end_date?: string | null; dapodik_status_raw?: string | null;
  nip?: string | null; nuptk?: string | null; nik?: string | null; email?: string | null; phone?: string | null; address?: string | null;
};
export type ImportIssue = { field: string; code: string; severity: "INFO" | "WARNING" | "ERROR"; message: string };
export type StaffImportPreview = {
  batch_id: string; file_sha256: string; source_filename: string; source_sheet: string; column_mapping: Record<string, string>;
  summary: { total: number; valid: number; new: number; matched: number; updates: number; unchanged: number; warnings: number; invalid: number; conflicts: number; duplicates: number };
  rows: Array<{ row_number: number; state: string; full_name: string; employee_code_masked: string | null; issues: ImportIssue[] }>;
};
export type StaffPosition = { id: number; raw_title: string; normalized_title: string; position_category: string | null; is_teaching_role: boolean | null; status: "PENDING" | "APPROVED"; employee_count: number };
export type StaffHistory = Array<{ id: string; action: string; effective_date: string | null; changed_fields: string[]; metadata: Record<string, unknown>; actor: string; created_at: string }>;
export type StaffImportBatch = { id: string; source_filename: string; source_sheet: string; file_sha256: string; imported_at: string; actor: string; total_rows: number; active_count: number; former_count: number; review_count: number; issue_count: number; status: string };

export async function fetchStaff(params: StaffListParams = {}): Promise<StaffListResponse> {
  return (await apiRequest<StaffListResponse>({ path: "/api/staff", params: { ...params, has_nuptk: params.has_nuptk === undefined ? undefined : String(params.has_nuptk) } })).data;
}
export async function fetchStaffDetail(id: string): Promise<StaffDetail> { return (await apiRequest<StaffDetail>({ path: `/api/staff/${id}` })).data; }
export async function fetchSensitiveStaff(id: string): Promise<StaffSensitive> { return (await apiRequest<StaffSensitive>({ path: `/api/staff/${id}/sensitive` })).data; }
export async function fetchStaffHistory(id: string): Promise<StaffHistory> { return (await apiRequest<StaffHistory>({ path: `/api/staff/${id}/history` })).data; }
export async function fetchStaffAnalytics(as_of_date?: string): Promise<StaffAnalyticsSummaryDto> { return (await apiRequest<StaffAnalyticsSummaryDto>({ path: "/api/staff/analytics/summary", params: { as_of_date } })).data; }
export async function fetchStaffPositions(status?: "PENDING" | "APPROVED" | "ALL"): Promise<StaffPosition[]> { return (await apiRequest<StaffPosition[]>({ path: "/api/staff/positions", params: { status } })).data; }
export async function updateStaffPosition(id: number, body: { normalized_title: string; position_category: string | null; is_teaching_role: boolean | null; status: "PENDING" | "APPROVED" }): Promise<StaffPosition> { return (await apiRequest<StaffPosition>({ path: `/api/staff/positions/${id}`, method: "PATCH", body })).data; }
export async function createStaff(body: StaffPayload): Promise<StaffDetail> { return (await apiRequest<StaffDetail>({ path: "/api/staff", method: "POST", body })).data; }
export async function updateStaff(id: string, body: Partial<StaffPayload> & { expected_updated_at: string }): Promise<StaffDetail> { return (await apiRequest<StaffDetail>({ path: `/api/staff/${id}`, method: "PATCH", body })).data; }
export async function changeStaffStatus(id: string, employment_status: "ACTIVE" | "FORMER", effective_date: string): Promise<void> { await apiRequest({ path: `/api/staff/${id}/employment-status`, method: "POST", body: { employment_status, effective_date } }); }
export async function fetchJenjangOptions(): Promise<JenjangOption[]> { return (await apiRequest<JenjangOption[]>({ path: "/api/academic-masters/jenjangs" })).data; }
export async function replaceStaffJenjangs(id: string, jenjang_ids: number[]): Promise<StaffDetail> { return (await apiRequest<StaffDetail>({ path: `/api/staff/${id}/jenjangs`, method: "PUT", body: { jenjang_ids } })).data; }
export async function updateStaffEmployment(id: string, employment_status: "ACTIVE" | "FORMER", effective_date: string): Promise<void> { return changeStaffStatus(id, employment_status, effective_date); }
export async function fetchStaffEducation(id: string): Promise<EducationSummary> { return (await apiRequest<EducationSummary>({ path: `/api/staff/${id}/education` })).data; }
export async function createStaffEducation(id: string, payload: Omit<EducationRecord, "id" | "created_at" | "updated_at">): Promise<EducationRecord> { return (await apiRequest<EducationRecord>({ path: `/api/staff/${id}/education`, method: "POST", body: payload })).data; }
export async function updateStaffEducation(id: string, educationId: number, payload: Omit<EducationRecord, "id" | "created_at" | "updated_at">): Promise<EducationRecord> { return (await apiRequest<EducationRecord>({ path: `/api/staff/${id}/education/${educationId}`, method: "PATCH", body: payload })).data; }
export async function deleteStaffEducation(id: string, educationId: number): Promise<void> { await apiRequest({ path: `/api/staff/${id}/education/${educationId}`, method: "DELETE" }); }

export async function previewStaffImport(file: File): Promise<StaffImportPreview> {
  const form = new FormData(); form.set("file", file);
  return (await apiRequest<StaffImportPreview>({ path: "/api/staff/import/preview", method: "POST", body: form, timeout: 60000 })).data;
}
export async function fetchStaffImportHistory(): Promise<StaffImportBatch[]> { return (await apiRequest<{ items: StaffImportBatch[] }>({ path: "/api/staff/imports/history" })).data.items; }
export async function commitStaffImport(batch_id: string, row_numbers: number[]): Promise<{ batch_id: string; status: string; summary: { inserted: number; updated: number; unchanged: number; rejected: number; failed: number }; failed_rows: Array<{ row_number: number; code: string }> }> {
  return (await apiRequest({ path: "/api/staff/import/commit", method: "POST", body: { batch_id, row_numbers } })).data as { batch_id: string; status: string; summary: { inserted: number; updated: number; unchanged: number; rejected: number; failed: number }; failed_rows: Array<{ row_number: number; code: string }> };
}
export async function downloadStaffExcel(params: StaffListParams & { include_sensitive?: boolean }): Promise<Blob> {
  return (await apiRequest({ path: "/api/staff/export-excel", params: { ...params, has_nuptk: params.has_nuptk === undefined ? undefined : String(params.has_nuptk) }, responseType: "blob", timeout: 60000, expectedBlobTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] })).data;
}
