import { apiRequest } from '../../../lib/api/client';

export type DeploymentMode = 'single_user_offline' | 'multi_user';

export type DeploymentModeResponse = {
  deployment_mode: DeploymentMode;
};

type OperatorWorkQueueCommon = Record<string, unknown> & {
  source_id: string;
  deduplication_key: string;
  student_display_label: string;
  class_reference: string | null;
  event_date: string | null;
  title: string;
  evidence_summary: string;
  workflow_status: string;
  derived_due_state: string;
  available_actions: string[];
  source_route: string;
};

export type OperatorWorkQueueItem = OperatorWorkQueueCommon &
  (
    | {
        item_type: 'CORRECTION_REQUEST';
        metadata: {
          id: number;
          version: number;
          requester: string;
        };
      }
    | {
        item_type:
          | 'FOLLOWUP_CASE'
          | 'FOLLOWUP_CANDIDATE'
          | 'UNMATCHED_DEVICE'
          | 'STUDENT_VERIFICATION'
          | 'STUDENT_IDENTITY_CORRECTION'
          | 'STUDENT_DAPODIK_CORRECTION'
          | 'STAFF_PTK_REVIEW'
          | 'UPP_REPORT_PENDING';
        metadata: Record<string, unknown>;
      }
  );

export type AttendanceCorrectionRequestId = number;

export type SelfConfirmCorrectionPayload = {
  expected_version: number;
  confirmation: string;
  confirmation_note: string;
};

export type DashboardOperationalOverviewResponse = {
  students: {
    active_count: number;
    nisn_inputted_count: number;
    nisn_not_inputted_count: number;
    pending_verification_count: number;
  };
  staff: {
    active_count: number;
    monthly_ptk_completed_count: number;
    monthly_ptk_pending_count: number;
  };
  upp: {
    current_period: string;
    status: string | null;
    has_workbook: boolean;
    submitted_at: string | null;
  };
};

export type BospReminderStatusResponse = {
  calendar_year: number;
  cutoff_date: string;
  advance_notice_days: number;
  is_in_notice_window: boolean;
  days_remaining: number;
  is_acknowledged: boolean;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  notes: string | null;
  is_blocking: boolean;
};

export async function fetchDeploymentMode(): Promise<DeploymentModeResponse> {
  try {
    const response = await apiRequest<DeploymentModeResponse>({
      path: '/api/config/deployment-mode',
    });
    return response.data || { deployment_mode: 'multi_user' };
  } catch (_error: unknown) {
    return { deployment_mode: 'multi_user' };
  }
}

export async function fetchOperatorWorkQueue(signal?: AbortSignal): Promise<OperatorWorkQueueItem[]> {
  const response = await apiRequest<OperatorWorkQueueItem[]>({
    path: '/api/operator/work-queue',
    ...(signal ? { signal } : {}),
  });
  return response.data || [];
}

export async function fetchDashboardOverview(signal?: AbortSignal): Promise<DashboardOperationalOverviewResponse> {
  const response = await apiRequest<DashboardOperationalOverviewResponse>({
    path: '/api/operator/dashboard-overview',
    ...(signal ? { signal } : {}),
  });
  return response.data;
}

export async function fetchBospReminderStatus(signal?: AbortSignal): Promise<BospReminderStatusResponse> {
  const response = await apiRequest<BospReminderStatusResponse>({
    path: '/api/operator/bosp-reminder',
    ...(signal ? { signal } : {}),
  });
  return response.data;
}

export async function acknowledgeBospReminder(payload: {
  calendar_year: number;
  notes?: string | null;
}): Promise<BospReminderStatusResponse> {
  const response = await apiRequest<BospReminderStatusResponse>({
    path: '/api/operator/bosp-reminder/acknowledge',
    method: 'POST',
    data: payload,
  });
  return response.data;
}

export async function updateBospReminderSettings(payload: {
  advance_notice_days: number;
}): Promise<BospReminderStatusResponse> {
  const response = await apiRequest<BospReminderStatusResponse>({
    path: '/api/operator/bosp-reminder/settings',
    method: 'PUT',
    data: payload,
  });
  return response.data;
}

export async function selfConfirmCorrection(
  requestId: AttendanceCorrectionRequestId,
  payload: SelfConfirmCorrectionPayload,
): Promise<Record<string, unknown>> {
  const response = await apiRequest<Record<string, unknown>>({
    path: `/api/attendance-corrections/${requestId}/self-confirm`,
    method: 'POST',
    data: payload,
  });
  return response.data;
}
