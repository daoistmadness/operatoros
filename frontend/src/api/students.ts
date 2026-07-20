import { apiRequest } from "../lib/api/client";

export type StudentFilters = {
  search?: string;
  academic_year_id?: number;
  jenjang_id?: number;
  class_id?: number;
  status?: string;
  device_linked?: boolean;
  enrollment_status?: string;
  page?: number;
  page_size?: number;
};

export type ManagedStudent = {
  id: string;
  full_name: string;
  preferred_name?: string | null;
  nipd_masked?: string | null;
  nisn_masked?: string | null;
  current_jenjang?: string | null;
  current_class?: string | null;
  academic_year?: string | null;
  device_identifier_masked?: string | null;
  profile_completeness: number;
  student_status: string;
  quality_flags: string[];
};

export type StudentListResponse = {
  items: ManagedStudent[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

export type StudentProfile = {
  id: string;
  record_version: string;
  identity: Record<string, string | null>;
  contact: Record<string, string | null>;
  guardians: Array<Record<string, string | null>>;
  device_identities: Array<{ id: number; device_identifier: string; device_source: string; effective_from: string; effective_to?: string | null; is_active: boolean }>;
  enrollments: Array<{ id: number; academic_year_id: number; academic_year: string; jenjang: string; program?: string | null; grade?: string | null; academic_class_id?: number | null; class_name?: string | null; effective_from?: string | null; effective_to?: string | null; active: boolean }>;
  updated_at: string;
};

export async function fetchStudents(filters: StudentFilters): Promise<StudentListResponse> {
  return (await apiRequest<StudentListResponse>({ path: "/api/student-masters/management/list", params: filters })).data;
}

export async function fetchStudent(id: string): Promise<StudentProfile> {
  return (await apiRequest<StudentProfile>({ path: `/api/student-masters/${id}/profile` })).data;
}

export async function createStudent(payload: unknown): Promise<StudentProfile> {
  return (await apiRequest<StudentProfile>({ path: "/api/student-masters", method: "POST", body: payload })).data;
}

export async function updateStudent(id: string, payload: unknown): Promise<StudentProfile> {
  return (await apiRequest<StudentProfile>({ path: `/api/student-masters/${id}/profile`, method: "PATCH", body: payload })).data;
}

export async function fetchStudentQuality(): Promise<Record<string, number>> {
  return (await apiRequest<Record<string, number>>({ path: "/api/student-masters/management/quality" })).data;
}

export async function fetchStudentHistory(id: string): Promise<Array<Record<string, unknown>>> {
  return (await apiRequest<Array<Record<string, unknown>>>({ path: `/api/student-masters/${id}/history` })).data;
}

export async function fetchStudentEnrollments(id: string): Promise<Array<Record<string, unknown>>> {
  return (await apiRequest<Array<Record<string, unknown>>>({ path: `/api/student-enrollments/student/${id}` })).data;
}

export async function replaceDeviceIdentity(id: string, payload: unknown) {
  return (await apiRequest({ path: `/api/student-masters/${id}/device-identities`, method: "POST", body: payload })).data;
}

export async function reassignDeviceIdentity(id: string, payload: unknown) {
  return (await apiRequest({ path: `/api/student-masters/${id}/device-identities/reassign`, method: "POST", body: payload })).data;
}

export async function retireDeviceIdentity(id: string, identityId: number, payload: unknown) {
  return (await apiRequest({ path: `/api/student-masters/${id}/device-identities/${identityId}/retire`, method: "POST", body: payload })).data;
}

export async function transferEnrollment(id: number, payload: unknown) {
  return (await apiRequest({ path: `/api/student-enrollments/${id}/transfer`, method: "POST", body: payload })).data;
}

export async function createEnrollment(studentId: string, payload: unknown) {
  return (await apiRequest({ path: `/api/student-enrollments/student/${studentId}`, method: "POST", body: payload })).data;
}

export async function endEnrollment(id: number, payload: unknown) {
  return (await apiRequest({ path: `/api/student-enrollments/${id}/end`, method: "POST", body: payload })).data;
}

export async function previewRoster(file: File, owner: string, received: string) {
  const form = new FormData(); form.append("file", file); form.append("source_owner", owner); form.append("date_received", received);
  return (await apiRequest({ path: "/api/student-enrollments/roster-preview", method: "POST", body: form })).data as any;
}

export async function commitRoster(payload: unknown) {
  return (await apiRequest({ path: "/api/student-enrollments/roster-commit", method: "POST", body: payload })).data;
}

export async function previewStudentUpdate(file: File) {
  const form = new FormData(); form.append("file", file);
  return (await apiRequest({ path: "/api/student-masters/management/update-preview", method: "POST", body: form })).data as any;
}

export async function commitStudentUpdate(batchId: string, payload: unknown) {
  return (await apiRequest({ path: `/api/student-masters/management/update-commit/${batchId}`, method: "POST", body: payload })).data;
}

export async function exportStudentTemplate(): Promise<Blob> {
  return (await apiRequest<Blob>({
    path: "/api/student-masters/management/export-template", responseType: "blob",
    expectedBlobTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  })).data;
}
