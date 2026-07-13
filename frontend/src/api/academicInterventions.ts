import { apiRequest } from "../lib/api/client";

export type InterventionStatus = "open" | "in_progress" | "monitoring" | "resolved" | "closed";
export type InterventionPriority = "low" | "medium" | "high" | "urgent";
export type InterventionAssessmentType = "sumatif" | "formatif" | "overall";

export interface AcademicIntervention {
  id: number;
  student_id: number;
  enrollment_id: number | null;
  academic_year_id: number;
  jenjang_id: number | null;
  subject_id: number;
  assessment_type: InterventionAssessmentType | null;
  term: string | null;
  class_name: string | null;
  student_name: string;
  subject_name: string;
  effective_threshold: number;
  threshold_source: string;
  current_average: number | null;
  status: InterventionStatus;
  priority: InterventionPriority;
  owner_name: string | null;
  planned_action: string | null;
  notes: string | null;
  follow_up_date: string | null;
  outcome: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  resolved_at?: string | null;
}

export interface AcademicInterventionPayload {
  student_id: number;
  enrollment_id?: number | null;
  academic_year_id: number;
  jenjang_id?: number | null;
  subject_id: number;
  assessment_type?: InterventionAssessmentType | null;
  term?: string | null;
  class_name?: string | null;
  student_name: string;
  subject_name: string;
  effective_threshold: number;
  threshold_source: string;
  current_average?: number | null;
  status?: InterventionStatus;
  priority?: InterventionPriority;
  owner_name?: string | null;
  planned_action?: string | null;
  notes?: string | null;
  follow_up_date?: string | null;
  outcome?: string | null;
}

export interface AcademicInterventionUpdatePayload {
  status?: InterventionStatus;
  priority?: InterventionPriority;
  owner_name?: string | null;
  planned_action?: string | null;
  notes?: string | null;
  follow_up_date?: string | null;
  outcome?: string | null;
}

export function academicInterventionsApiPath(path: string): string {
  return `/api/academic-interventions${path}`;
}

export async function fetchAcademicInterventions(params?: {
  academic_year_id?: number | null;
  jenjang_id?: number | null;
  class_name?: string | null;
  student_id?: number | null;
  subject_id?: number | null;
  term?: string | null;
  status?: InterventionStatus | null;
  priority?: InterventionPriority | null;
}): Promise<AcademicIntervention[]> {
  const response = await apiRequest<AcademicIntervention[]>({
    path: academicInterventionsApiPath(""),
    method: "GET",
    params,
  });

  return response.data;
}

export async function createAcademicIntervention(
  payload: AcademicInterventionPayload
): Promise<AcademicIntervention> {
  const response = await apiRequest<AcademicIntervention>({
    path: academicInterventionsApiPath(""),
    method: "POST",
    body: payload,
  });

  return response.data;
}

export async function createAcademicInterventionFromAlert(
  payload: AcademicInterventionPayload
): Promise<AcademicIntervention> {
  const response = await apiRequest<AcademicIntervention>({
    path: academicInterventionsApiPath("/from-alert"),
    method: "POST",
    body: payload,
  });

  return response.data;
}

export async function updateAcademicIntervention(
  id: number,
  payload: AcademicInterventionUpdatePayload
): Promise<AcademicIntervention> {
  const response = await apiRequest<AcademicIntervention>({
    path: academicInterventionsApiPath(`/${id}`),
    method: "PATCH",
    body: payload,
  });

  return response.data;
}
