import { apiRequest } from "../lib/api/client";
import type {
  AcademicAssessmentSession,
  AcademicYear,
  AssessmentComponent,
  GradeGridSaveRequest,
  GradeSaveResult,
  Subject,
  AssessmentOperationsResponse,
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

export interface CreateAcademicAssessmentSessionPayload {
  academic_year_id: number;
  term_number: number;
  label: string;
  assessment_date?: string | null;
}

export function gradeApiPath(path: string): string {
  return `/api/grades${path}`;
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

export async function fetchAssessmentSessions(academicYearId: number): Promise<AcademicAssessmentSession[]> {
  const response = await apiRequest<AcademicAssessmentSession[]>({
    path: gradeApiPath("/assessment-sessions"),
    method: "GET",
    params: { academic_year_id: academicYearId },
  });
  return response.data;
}

export async function createAssessmentSession(payload: CreateAcademicAssessmentSessionPayload): Promise<AcademicAssessmentSession> {
  const response = await apiRequest<AcademicAssessmentSession>({
    path: gradeApiPath("/assessment-sessions"),
    method: "POST",
    body: payload,
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

export type AssessmentOperationsFilters = {
  academic_year_id: number;
  term?: "term_1" | "term_2" | "term_3" | "term_4" | null;
  class_id?: number | null;
  subject_id?: number | null;
  coverage_state?: "ALL" | "COMPLETE" | "PARTIAL" | "NONE" | "EMPTY";
  search?: string;
  sort?: "assessment_date" | "assessment" | "class" | "subject" | "term" | "applicable" | "recorded" | "unrecorded" | "coverage";
  order?: "asc" | "desc";
  page?: number;
  page_size?: number;
};

export async function fetchAssessmentOperations(filters: AssessmentOperationsFilters): Promise<AssessmentOperationsResponse> {
  const response = await apiRequest<AssessmentOperationsResponse>({
    path: gradeApiPath("/assessment-operations"),
    method: "GET",
    params: {
      academic_year_id: filters.academic_year_id,
      term: filters.term ?? undefined,
      class_id: filters.class_id ?? undefined,
      subject_id: filters.subject_id ?? undefined,
      coverage_state: filters.coverage_state && filters.coverage_state !== "ALL" ? filters.coverage_state : undefined,
      search: filters.search || undefined,
      sort: filters.sort ?? "assessment_date",
      order: filters.order ?? "asc",
      page: filters.page ?? 1,
      page_size: filters.page_size ?? 25,
    },
  });
  return response.data;
}
