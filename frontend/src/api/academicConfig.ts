import { API_BASE_URL, apiRequest } from "../lib/api/client";

export type AssessmentType = "sumatif" | "formatif" | "overall";
export type ConfigSource = "custom" | "default" | "full-year";

export interface KkmThreshold {
  id: number;
  academic_year_id: number;
  academic_year_label?: string | null;
  jenjang_id: number | null;
  jenjang_name?: string | null;
  subject_id: number | null;
  subject_name?: string | null;
  assessment_type: AssessmentType;
  threshold: number;
}

export interface KkmThresholdPayload {
  academic_year_id: number;
  jenjang_id?: number | null;
  subject_id?: number | null;
  assessment_type: AssessmentType;
  threshold: number;
}

export interface AcademicTermConfig {
  id: number | null;
  academic_year_id: number;
  term_number: number;
  value: string;
  label: string;
  start_date: string;
  end_date: string;
  source: ConfigSource;
}

export interface AcademicTermPayload {
  academic_year_id: number;
  term_number: number;
  label: string;
  start_date: string;
  end_date: string;
}

export function academicConfigApiPath(path: string): string {
  const apiBaseOwnsPrefix = /(?:^|\/)api\/?$/.test(API_BASE_URL);
  return apiBaseOwnsPrefix ? `/api/api/academic-config${path}` : `/api/academic-config${path}`;
}

export async function fetchKkmThresholds(params?: {
  academic_year_id?: number | null;
  jenjang_id?: number | null;
  subject_id?: number | null;
}): Promise<KkmThreshold[]> {
  const response = await apiRequest<KkmThreshold[]>({
    path: academicConfigApiPath("/kkm-thresholds"),
    method: "GET",
    params,
  });

  return response.data;
}

export async function createKkmThreshold(payload: KkmThresholdPayload): Promise<KkmThreshold> {
  const response = await apiRequest<KkmThreshold>({
    path: academicConfigApiPath("/kkm-thresholds"),
    method: "POST",
    body: payload,
  });

  return response.data;
}

export async function updateKkmThreshold(id: number, payload: Partial<KkmThresholdPayload>): Promise<KkmThreshold> {
  const response = await apiRequest<KkmThreshold>({
    path: academicConfigApiPath(`/kkm-thresholds/${id}`),
    method: "PUT",
    body: payload,
  });

  return response.data;
}

export async function deleteKkmThreshold(id: number): Promise<{ status: "success"; deleted: number }> {
  const response = await apiRequest<{ status: "success"; deleted: number }>({
    path: academicConfigApiPath(`/kkm-thresholds/${id}`),
    method: "DELETE",
  });

  return response.data;
}

export async function fetchEffectiveTerms(academicYearId: number): Promise<AcademicTermConfig[]> {
  const response = await apiRequest<AcademicTermConfig[]>({
    path: academicConfigApiPath("/terms/effective"),
    method: "GET",
    params: { academic_year_id: academicYearId },
  });

  return response.data;
}

export async function createTermConfig(payload: AcademicTermPayload): Promise<AcademicTermConfig> {
  const response = await apiRequest<AcademicTermConfig>({
    path: academicConfigApiPath("/terms"),
    method: "POST",
    body: payload,
  });

  return response.data;
}

export async function updateTermConfig(id: number, payload: Partial<AcademicTermPayload>): Promise<AcademicTermConfig> {
  const response = await apiRequest<AcademicTermConfig>({
    path: academicConfigApiPath(`/terms/${id}`),
    method: "PUT",
    body: payload,
  });

  return response.data;
}

export async function deleteTermConfig(id: number): Promise<{ status: "success"; deleted: number }> {
  const response = await apiRequest<{ status: "success"; deleted: number }>({
    path: academicConfigApiPath(`/terms/${id}`),
    method: "DELETE",
  });

  return response.data;
}
