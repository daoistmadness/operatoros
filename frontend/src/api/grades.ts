import { API_BASE_URL, apiRequest } from "../lib/api/client";
import type {
  AcademicYear,
  AssessmentComponent,
  GradeGridSaveRequest,
  GradeSaveResult,
  Subject,
} from "../types/grade";

export interface CreateAcademicYearPayload {
  label: string;
  start_date: string;
  end_date: string;
  status: AcademicYear["status"];
  is_default: boolean;
}

export interface CreateSubjectPayload {
  name: string;
  jenjang_id: number;
  supports_sumatif: boolean;
  supports_formatif: boolean;
}

export function gradeApiPath(path: string): string {
  const apiBaseOwnsPrefix = /(?:^|\/)api\/?$/.test(API_BASE_URL);
  return apiBaseOwnsPrefix ? `/api/api/grades${path}` : `/api/grades${path}`;
}

export async function fetchAcademicYears(): Promise<AcademicYear[]> {
  const response = await apiRequest<AcademicYear[]>({
    path: gradeApiPath("/academic-years"),
    method: "GET",
  });

  return response.data;
}

export async function createAcademicYear(payload: CreateAcademicYearPayload): Promise<AcademicYear> {
  const response = await apiRequest<AcademicYear>({
    path: gradeApiPath("/academic-years"),
    method: "POST",
    body: payload,
  });

  return response.data;
}

export async function fetchSubjects(jenjangId: number): Promise<Subject[]> {
  const response = await apiRequest<Subject[]>({
    path: gradeApiPath("/subjects"),
    method: "GET",
    params: { jenjang_id: jenjangId },
  });

  return response.data;
}

export async function createSubject(payload: CreateSubjectPayload): Promise<Subject> {
  const response = await apiRequest<Subject>({
    path: gradeApiPath("/subjects"),
    method: "POST",
    body: payload,
  });

  return response.data;
}

export async function fetchComponents(): Promise<AssessmentComponent[]> {
  const response = await apiRequest<AssessmentComponent[]>({
    path: gradeApiPath("/components"),
    method: "GET",
  });

  return response.data;
}

export async function saveGradeLedger(payload: GradeGridSaveRequest): Promise<GradeSaveResult> {
  const response = await apiRequest<GradeSaveResult>({
    path: gradeApiPath("/save"),
    method: "POST",
    body: payload,
  });

  return response.data;
}
