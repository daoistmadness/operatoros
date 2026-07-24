import { apiRequest } from '../lib/api/client';

export interface DismissalPolicyItem {
  id: number;
  jenjang_id?: number | null;
  jenjang: string;
  weekday: number;
  dismissal_time: string;
  grace_period_minutes: number;
  effective_from: string;
  effective_to?: string | null;
  is_active: boolean;
  change_reason?: string | null;
  created_by?: string;
  created_at?: string;
}

export interface DepartureResolutionItem {
  attendance_id: number | null;
  date: string;
  student_id: number;
  student_name: string;
  class_name: string;
  classification:
    | 'NOT_APPLICABLE'
    | 'MISSING_CHECKOUT'
    | 'UNKNOWN_POLICY'
    | 'ON_TIME_DEPARTURE'
    | 'EARLY_DEPARTURE'
    | 'EXCUSED_EARLY_DEPARTURE';
  effective_check_in?: string | null;
  effective_check_out?: string | null;
  raw_check_out?: string | null;
  has_override: boolean;
  scheduled_dismissal?: string | null;
  grace_period_minutes: number;
  minutes_early: number;
  policy_id?: number | null;
  policy_version?: string | null;
  excuse?: {
    id: number;
    reason_code: string;
    explanation?: string | null;
    recorded_by: string;
    recorded_at?: string | null;
    state: string;
  } | null;
  has_pending_correction: boolean;
  is_period_finalized: boolean;
}

export async function getDeparturePolicies(jenjang?: string, activeOnly = false): Promise<DismissalPolicyItem[]> {
  const params = new URLSearchParams();
  if (jenjang) params.append('jenjang', jenjang);
  if (activeOnly) params.append('active_only', 'true');
  const qs = params.toString();
  return apiRequest<DismissalPolicyItem[]>(`/api/attendance/departure-policies${qs ? `?${qs}` : ''}`);
}

export async function createDeparturePolicy(payload: {
  jenjang: string;
  weekday: number;
  dismissal_time: string;
  grace_period_minutes: number;
  effective_from: string;
  effective_to?: string;
  change_reason?: string;
  jenjang_id?: number;
}): Promise<DismissalPolicyItem> {
  return apiRequest<DismissalPolicyItem>('/api/attendance/departure-policies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deactivateDeparturePolicy(policyId: number, changeReason?: string): Promise<any> {
  return apiRequest(`/api/attendance/departure-policies/${policyId}/deactivate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ change_reason: changeReason }),
  });
}

export async function getClassDateDepartures(classId: string, dateVal: string): Promise<{
  class_id: string;
  date: string;
  departures: DepartureResolutionItem[];
}> {
  return apiRequest(`/api/attendance/classes/${encodeURIComponent(classId)}/dates/${dateVal}/departures`);
}

export async function recordDepartureExcuse(
  attendanceId: number,
  payload: { reason_code: string; explanation?: string }
): Promise<any> {
  return apiRequest(`/api/attendance/${attendanceId}/departure-excuses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function revokeDepartureExcuse(
  attendanceId: number,
  excuseId: number,
  payload: { revocation_reason: string }
): Promise<any> {
  return apiRequest(`/api/attendance/${attendanceId}/departure-excuses/${excuseId}/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function getDepartureHistory(attendanceId: number): Promise<any> {
  return apiRequest(`/api/attendance/${attendanceId}/departure-history`);
}
