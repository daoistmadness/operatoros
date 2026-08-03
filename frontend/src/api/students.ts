import { apiRequest } from "../lib/api/client";

export type StudentFilters = {
  search?: string;
  academic_year_id?: number;
  jenjang_id?: number;
  program_id?: number;
  grade_id?: number;
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
  age_years?: number | null;
  current_programme?: string | null;
  current_grade?: string | null;
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
  age_years?: number | null;
  health?: Record<string, string | null> | null;
  document_status?: Record<string, boolean> | null;
  attendance_identity?: LegacyLinkStatus;
};

export type LegacyLinkCandidate = {
  legacy_student_id: number;
  name: string;
  jenjang?: string | null;
  class_name?: string | null;
  attendance_count: number;
};

export type LegacyLinkStatus = {
  status: "LINKED" | "NOT_LINKED" | "REVIEW_REQUIRED";
  legacy_student_id?: number | null;
  candidates: LegacyLinkCandidate[];
};

export async function fetchStudents(filters: StudentFilters): Promise<StudentListResponse> {
  return (await apiRequest<StudentListResponse>({ path: "/api/student-masters/management/list", params: filters })).data;
}

export async function fetchStudent(id: string): Promise<StudentProfile> {
  return (await apiRequest<StudentProfile>({ path: `/api/student-masters/${id}/profile` })).data;
}

export async function fetchLegacyLinkStatus(id: string): Promise<LegacyLinkStatus> {
  return (await apiRequest<LegacyLinkStatus>({ path: `/api/student-masters/${id}/legacy-link` })).data;
}

export async function linkLegacyStudent(id: string, payload: { legacy_student_id: number; reason: string; confirmation: "LINK_LEGACY_STUDENT" }) {
  return (await apiRequest<LegacyLinkStatus>({ path: `/api/student-masters/${id}/legacy-link`, method: "POST", body: payload })).data;
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

export async function exportStudentsCsv(filters: StudentFilters): Promise<Blob> {
  return (await apiRequest<Blob>({ path: "/api/student-masters/management/export.csv", responseType: "blob", params: filters, expectedBlobTypes: ["text/csv"] })).data;
}

export async function updateStudentHealth(id: string, body: unknown) { return (await apiRequest({ path: `/api/student-masters/${id}/health`, method: "PATCH", body })).data; }
export async function updateStudentDocuments(id: string, body: unknown) { return (await apiRequest({ path: `/api/student-masters/${id}/documents`, method: "PATCH", body })).data; }
export async function addStudentGuardian(id: string, body: unknown) { return (await apiRequest({ path: `/api/student-masters/${id}/guardians`, method: "POST", body })).data; }
export async function updateStudentGuardian(id: string, guardianId: number, body: unknown) { return (await apiRequest({ path: `/api/student-masters/${id}/guardians/${guardianId}`, method: "PATCH", body })).data; }
export async function deleteStudentGuardian(id: string, guardianId: number) { return (await apiRequest({ path: `/api/student-masters/${id}/guardians/${guardianId}`, method: "DELETE" })).data; }
