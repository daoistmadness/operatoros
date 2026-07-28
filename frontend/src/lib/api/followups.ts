import { apiRequest, type QueryParams } from './client';

export type FollowUpCaseId = number;

export type FollowUpCandidateQuery = QueryParams & {
  class_id?: number;
  status_filter?: string;
  date_from?: string;
  date_to?: string;
  exception_kind?: string;
};

export type FollowUpListQuery = QueryParams & {
  status?: string;
  priority?: string;
  exception_kind?: string;
  assigned_to_user_id?: number;
  academic_class_id?: number;
  is_overdue?: boolean;
  unassigned_only?: boolean;
  my_cases_only?: boolean;
};

export type FollowUpCandidate = Record<string, unknown> & {
  exception_key: string;
  exception_kind: string;
  student_master_id?: number | null;
  academic_class_id?: number | null;
  exception_date?: string | null;
};

export type FollowUpCase = Record<string, unknown> & {
  id: FollowUpCaseId;
  exception_key?: string;
  exception_kind?: string;
  status?: string;
  priority?: string;
  version?: number;
  student_name?: string | null;
  class_name?: string | null;
  exception_date?: string | null;
  evidence_summary?: string | null;
  notes?: FollowUpNote[];
};

export type FollowUpNote = {
  id: number;
  created_by_user_id?: number | null;
  created_at: string;
  body: string;
};

export type FollowUpHistoryItem = {
  id: number;
  action: string;
  created_at: string;
  actor: string;
  metadata_payload?: Record<string, unknown> | null;
};

export type FollowUpPage<T> = {
  total: number;
  items: T[];
};

export type CreateFollowUpPayload = {
  exception_key: string;
  exception_kind: string;
  student_master_id?: number | null;
  student_enrollment_id?: number | null;
  attendance_id?: number | null;
  attendance_correction_request_id?: number | null;
  early_departure_excuse_id?: number | null;
  academic_class_id?: number | null;
  academic_year_id?: number | null;
  exception_date?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  source_snapshot?: Record<string, unknown> | null;
  priority?: string;
  assigned_to_user_id?: number | null;
  due_at?: string | null;
};

export type UpdateFollowUpStatePayload = Record<string, unknown> & {
  target_status: string;
  version?: number;
};

export type AddFollowUpNotePayload = {
  body: string;
  note_type?: string;
};

export type FollowUpHistory = {
  follow_up_id: FollowUpCaseId;
  history: FollowUpHistoryItem[];
};

export async function fetchFollowUpCandidates(
  params: FollowUpCandidateQuery = {},
): Promise<FollowUpPage<FollowUpCandidate> | []> {
  const response = await apiRequest<FollowUpPage<FollowUpCandidate>>({
    path: '/api/attendance/followups/candidates',
    params,
  });
  return response.data || [];
}

export async function fetchFollowUpCases(
  params: FollowUpListQuery = {},
): Promise<FollowUpPage<FollowUpCase> | []> {
  const response = await apiRequest<FollowUpPage<FollowUpCase>>({
    path: '/api/attendance/followups',
    params,
  });
  return response.data || [];
}

export async function fetchFollowUpDetail(caseId: FollowUpCaseId): Promise<FollowUpCase> {
  const response = await apiRequest<FollowUpCase>({
    path: `/api/attendance/followups/${caseId}`,
  });
  return response.data;
}

export async function createFollowUpCase(payload: CreateFollowUpPayload): Promise<FollowUpCase> {
  const response = await apiRequest<FollowUpCase>({
    path: '/api/attendance/followups',
    method: 'POST',
    data: payload,
  });
  return response.data;
}

export async function updateFollowUpState(
  caseId: FollowUpCaseId,
  payload: UpdateFollowUpStatePayload,
): Promise<FollowUpCase> {
  const response = await apiRequest<FollowUpCase>({
    path: `/api/attendance/followups/${caseId}/status`,
    method: 'PATCH',
    data: payload,
  });
  return response.data;
}

export async function addFollowUpNote(
  caseId: FollowUpCaseId,
  payload: AddFollowUpNotePayload,
): Promise<Record<string, unknown>> {
  const response = await apiRequest<Record<string, unknown>>({
    path: `/api/attendance/followups/${caseId}/notes`,
    method: 'POST',
    data: payload,
  });
  return response.data;
}

export async function fetchFollowUpHistory(
  caseId: FollowUpCaseId,
): Promise<FollowUpHistoryItem[]> {
  const response = await apiRequest<FollowUpHistory>({
    path: `/api/attendance/followups/${caseId}/history`,
  });
  return response.data?.history || [];
}

export async function fetchFollowUpMetrics(): Promise<Record<string, unknown>> {
  const response = await apiRequest<Record<string, unknown>>({
    path: '/api/attendance/followups/metrics/summary',
  });
  return response.data || {};
}
