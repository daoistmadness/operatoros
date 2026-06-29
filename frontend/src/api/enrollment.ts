import { gradeApiPath } from "./grades";
import { apiRequest } from "../lib/api/client";

export interface JenjangOption {
  id: number;
  name: string;
}

export interface EnrollmentStudent {
  id: number;
  name: string;
  jenjang: string | null;
  class_name: string | null;
}

export interface EnrollmentRow {
  enrollment_id: number;
  student_id: number;
  student_name: string;
  jenjang: string | null;
  student_class_name: string | null;
  academic_year_id: number;
  jenjang_id: number;
  class_name: string | null;
  class_assigned: boolean;
}

export interface BulkEnrollmentRequest {
  academic_year_id: number;
  jenjang_id: number;
  class_name: string | null;
  student_ids: number[];
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
  });

  return response.data;
}
