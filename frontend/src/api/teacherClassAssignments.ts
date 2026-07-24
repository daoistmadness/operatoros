import { apiRequest } from "../lib/api/client";

export interface TeacherClassAssignment {
  id: number;
  user_id: number;
  username?: string | null;
  full_name?: string | null;
  academic_year_id: number;
  academic_year_label?: string | null;
  academic_class_id: number;
  class_name?: string | null;
  class_role: "HOMEROOM_TEACHER" | "SUBJECT_TEACHER";
  subject_id?: number | null;
  subject_name?: string | null;
  effective_from: string;
  effective_to?: string | null;
  is_active: boolean;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeacherClassAssignmentCreatePayload {
  user_id: number;
  academic_year_id: number;
  academic_class_id: number;
  class_role: "HOMEROOM_TEACHER" | "SUBJECT_TEACHER";
  subject_id?: number | null;
  effective_from: string;
  effective_to?: string | null;
  notes?: string | null;
}

export interface TeacherClassAssignmentUpdatePayload {
  class_role?: "HOMEROOM_TEACHER" | "SUBJECT_TEACHER";
  subject_id?: number | null;
  effective_from?: string;
  effective_to?: string | null;
  is_active?: boolean;
  notes?: string | null;
}

export interface AssignedClassSummary {
  id: number;
  class_name: string;
  academic_year_id: number;
  academic_year_label: string;
  class_role: string;
  subject_id?: number | null;
  subject_name?: string | null;
  effective_from: string;
  effective_to?: string | null;
}

export interface StudentRosterItem {
  student_id: number;
  student_master_id?: string | null;
  nisn?: string | null;
  full_name: string;
  attendance_id?: number | null;
  status?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  note?: string | null;
  lifecycle_state: string;
}

export interface ClassDateAttendanceResponse {
  class_id: number;
  class_name: string;
  date: string;
  is_finalized: boolean;
  items: StudentRosterItem[];
}

export interface AttendanceEntryPayload {
  student_id: number;
  status: string;
  check_in?: string | null;
  check_out?: string | null;
  note?: string | null;
}

export async function fetchTeacherClassAssignments(params?: {
  user_id?: number;
  academic_year_id?: number;
  academic_class_id?: number;
  is_active?: boolean;
}): Promise<TeacherClassAssignment[]> {
  const query = new URLSearchParams();
  if (params?.user_id) query.append("user_id", String(params.user_id));
  if (params?.academic_year_id) query.append("academic_year_id", String(params.academic_year_id));
  if (params?.academic_class_id) query.append("academic_class_id", String(params.academic_class_id));
  if (params?.is_active !== undefined) query.append("is_active", String(params.is_active));

  const queryString = query.toString() ? `?${query.toString()}` : "";
  return apiRequest(`/api/teacher-class-assignments${queryString}`, { method: "GET" });
}

export async function createTeacherClassAssignment(
  payload: TeacherClassAssignmentCreatePayload
): Promise<TeacherClassAssignment> {
  return apiRequest("/api/teacher-class-assignments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateTeacherClassAssignment(
  id: number,
  payload: TeacherClassAssignmentUpdatePayload
): Promise<TeacherClassAssignment> {
  return apiRequest(`/api/teacher-class-assignments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deactivateTeacherClassAssignment(id: number): Promise<TeacherClassAssignment> {
  return apiRequest(`/api/teacher-class-assignments/${id}/deactivate`, { method: "POST" });
}

export async function reactivateTeacherClassAssignment(id: number): Promise<TeacherClassAssignment> {
  return apiRequest(`/api/teacher-class-assignments/${id}/reactivate`, { method: "POST" });
}

export async function fetchAssignedClasses(): Promise<AssignedClassSummary[]> {
  return apiRequest("/api/attendance/classes/assigned", { method: "GET" });
}

export async function fetchClassAttendanceForDate(
  classId: number,
  dateVal: string
): Promise<ClassDateAttendanceResponse> {
  return apiRequest(`/api/attendance/classes/${classId}/dates/${dateVal}`, { method: "GET" });
}

export async function submitClassAttendanceEntries(
  classId: number,
  dateVal: string,
  entries: AttendanceEntryPayload[]
): Promise<{ success: boolean; total_submitted: number }> {
  return apiRequest(`/api/attendance/classes/${classId}/dates/${dateVal}/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
}
