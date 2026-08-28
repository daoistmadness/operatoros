import { gradeApiPath } from "./grades";
import { apiRequest } from "../lib/api/client";

export interface JenjangOption {
  id: number;
  name: string;
}

export interface EnrollmentStudent {
  id: string; // student_master_id
  student_id: number | null;
  name: string;
  jenjang: string | null;
  class_name: string | null;
  device_linked: boolean;
}

export type EnrollmentLifecycleState = "DRAFT" | "ACTIVE" | "ENDED" | "WITHDRAWN" | "GRADUATED" | "VOIDED";

export interface EnrollmentClassHistory {
  id: number;
  class_name: string | null;
  effective_from: string;
  effective_to: string | null;
  source: string;
}

export interface EnrollmentRow {
  enrollment_id: number;
  student_id: number | null;
  student_name: string;
  jenjang: string | null;
  student_class_name: string | null;
  academic_year_id: number;
  jenjang_id: number;
  class_name: string | null;
  class_assigned: boolean;
  student_master_id?: string;
  lifecycle_state: EnrollmentLifecycleState;
  device_linked: boolean;
  effective_from: string | null;
  effective_to: string | null;
  class_history: EnrollmentClassHistory[];
  deletion: {
    can_hard_delete: boolean;
    code: string;
    message: string;
    dependencies: string[];
  };
}

export interface BulkEnrollmentRequest {
  academic_year_id: number;
  academic_class_id: number;
  student_master_ids: string[];
}

export interface BulkEnrollmentResult {
  status: "success";
  created: number;
  skipped_existing: number;
  enrollment_ids: number[];
  enrollments: EnrollmentRow[];
}

export async function fetchJenjangs(): Promise<JenjangOption[]> {
  const response = await apiRequest<JenjangOption[]>({
    path: gradeApiPath("/jenjangs"),
    method: "GET",
  });

  return response.data;
}

export async function fetchEnrollmentCandidates(params: {
  academicYearId: number;
  jenjangId: number;
  sourceClass?: string;
}): Promise<EnrollmentStudent[]> {
  const response = await apiRequest<EnrollmentStudent[]>({
    path: gradeApiPath("/enrollment/candidates"),
    method: "GET",
    params: {
      academic_year_id: params.academicYearId,
      jenjang_id: params.jenjangId,
      source_class: params.sourceClass,
    },
  });

  return response.data;
}

export async function fetchEnrollmentSourceClasses(params: {
  academicYearId: number;
  jenjangId: number;
}): Promise<string[]> {
  const response = await apiRequest<string[]>({
    path: gradeApiPath("/enrollment/source-classes"),
    method: "GET",
    params: {
      academic_year_id: params.academicYearId,
      jenjang_id: params.jenjangId,
    },
  });

  return response.data;
}

export async function fetchEnrollments(params: {
  academicYearId: number;
  jenjangId: number;
  className?: string;
}): Promise<EnrollmentRow[]> {
  const response = await apiRequest<EnrollmentRow[]>({
    path: gradeApiPath("/enrollment"),
    method: "GET",
    params: {
      academic_year_id: params.academicYearId,
      jenjang_id: params.jenjangId,
      class_name: params.className,
    },
  });

  return response.data;
}

export async function bulkEnrollStudents(payload: BulkEnrollmentRequest): Promise<BulkEnrollmentResult> {
  const response = await apiRequest<BulkEnrollmentResult>({
    path: gradeApiPath("/enrollment/bulk"),
    method: "POST",
    body: payload,
  });

  return response.data;
}

export async function deleteEnrollment(enrollmentId: number): Promise<{ status: "success"; deleted: number }> {
  const response = await apiRequest<{ status: "success"; deleted: number }>({
    path: gradeApiPath(`/enrollment/${enrollmentId}`),
    method: "DELETE",
    body: { confirmation: "DELETE_UNUSED_DRAFT_ENROLLMENT" },
  });

  return response.data;
}

export type EnrollmentLifecycleAction = "end" | "withdraw" | "graduate" | "reactivate" | "void";

const lifecycleConfirmation: Record<EnrollmentLifecycleAction, string> = {
  end: "END_STUDENT_ENROLLMENT",
  withdraw: "WITHDRAW_STUDENT_ENROLLMENT",
  graduate: "GRADUATE_STUDENT_ENROLLMENT",
  reactivate: "REACTIVATE_STUDENT_ENROLLMENT",
  void: "VOID_STUDENT_ENROLLMENT",
};

export async function changeEnrollmentLifecycle(
  enrollmentId: number,
  action: EnrollmentLifecycleAction,
  effectiveDate: string,
  reason: string,
): Promise<{ id: number; lifecycle_state: EnrollmentLifecycleState }> {
  const response = await apiRequest<{ id: number; lifecycle_state: EnrollmentLifecycleState }>({
    path: `/api/student-enrollments/${enrollmentId}/${action}`,
    method: "POST",
    body: {
      effective_date: effectiveDate,
      reason,
      ...(action === "end" ? {} : { reason_code: `MANUAL_${action.toUpperCase()}` }),
      confirmation: lifecycleConfirmation[action],
    },
  });
  return response.data;
}

export interface AcademicClass {
  id: number;
  academic_year_id: number;
  grade_id: number;
  class_name: string;
  section_code: string;
  active: boolean;
}

export interface AcademicGrade {
  id: number;
  jenjang_id: number;
  program_id: number;
  name: string;
  sequence_number: number;
  active: boolean;
}

export interface AcademicProgram {
  id: number;
  jenjang_id: number;
  name: string;
  active: boolean;
}

export async function fetchAcademicClasses(): Promise<AcademicClass[]> {
  const response = await apiRequest<AcademicClass[]>({
    path: "/api/academic-masters/classes",
    method: "GET",
  });
  return response.data;
}

export async function fetchAcademicGrades(): Promise<AcademicGrade[]> {
  const response = await apiRequest<AcademicGrade[]>({
    path: "/api/academic-masters/grades",
    method: "GET",
  });
  return response.data;
}

export async function fetchAcademicPrograms(): Promise<AcademicProgram[]> {
  const response = await apiRequest<AcademicProgram[]>({
    path: "/api/academic-masters/programs",
    method: "GET",
  });
  return response.data;
}
