import { apiRequest } from "../lib/api/client";

export type JenjangOption = {
  id: number;
  name: string;
  code: string | null;
  level: string | null;
  active: boolean;
};

export type EducationRecord = {
  id: number;
  education_level: string;
  institution_name: string;
  major: string | null;
  graduation_year: number | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

export type EducationSummary = {
  items: EducationRecord[];
  highest_education_level: string | null;
  highest_education_institution: string | null;
  highest_education_graduation_year: number | null;
};

export type StaffSummary = {
  id: string;
  source_staff_id: string | null;
  full_name: string;
  employment_status: string;
  job_title: string | null;
  employment_start_date: string | null;
  employment_end_date: string | null;
  dapodik_status: string;
  nip: string | null;
  nuptk: string | null;
  jenjangs: JenjangOption[];
  age_years: number | null;
  service_years: number | null;
  service_months: number | null;
  service_duration_status: string;
  highest_education_level: string | null;
  highest_education_institution: string | null;
};

export type StaffDetail = StaffSummary & {
  birth_place: string | null;
  birth_date: string | null;
  identifiers: Array<{ type: string; value: string; verification_status: string }>;
  contact: { email: string | null; phone: string | null; address: string | null } | null;
  education_history: EducationRecord[];
};

export type StaffListResponse = {
  items: StaffSummary[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  counts: { ACTIVE: number; FORMER: number; ALL: number };
};

export type StaffListParams = {
  search?: string;
  status?: string;
  job_title?: string;
  dapodik_status?: string;
  jenjang_id?: number;
  page?: number;
  page_size?: number;
};

export async function fetchStaff(params: StaffListParams = {}): Promise<StaffListResponse> {
  return (await apiRequest<StaffListResponse>({ path: "/api/staff", params })).data;
}

export async function fetchStaffDetail(id: string): Promise<StaffDetail> {
  return (await apiRequest<StaffDetail>({ path: `/api/staff/${id}` })).data;
}

export async function fetchJenjangOptions(): Promise<JenjangOption[]> {
  return (await apiRequest<JenjangOption[]>({ path: "/api/academic-masters/jenjangs" })).data;
}

export async function replaceStaffJenjangs(id: string, jenjang_ids: number[]): Promise<StaffDetail> {
  return (await apiRequest<StaffDetail>({ path: `/api/staff/${id}/jenjangs`, method: "PUT", body: { jenjang_ids } })).data;
}

export async function updateStaffEmployment(id: string, employment_end_date: string | null): Promise<StaffDetail> {
  return (await apiRequest<StaffDetail>({ path: `/api/staff/${id}`, method: "PATCH", body: { employment_end_date } })).data;
}

export async function fetchStaffEducation(id: string): Promise<EducationSummary> {
  return (await apiRequest<EducationSummary>({ path: `/api/staff/${id}/education` })).data;
}

export async function createStaffEducation(id: string, payload: Omit<EducationRecord, "id" | "created_at" | "updated_at">): Promise<EducationRecord> {
  return (await apiRequest<EducationRecord>({ path: `/api/staff/${id}/education`, method: "POST", body: payload })).data;
}

export async function updateStaffEducation(id: string, educationId: number, payload: Omit<EducationRecord, "id" | "created_at" | "updated_at">): Promise<EducationRecord> {
  return (await apiRequest<EducationRecord>({ path: `/api/staff/${id}/education/${educationId}`, method: "PATCH", body: payload })).data;
}

export async function deleteStaffEducation(id: string, educationId: number): Promise<void> {
  await apiRequest({ path: `/api/staff/${id}/education/${educationId}`, method: "DELETE" });
}
