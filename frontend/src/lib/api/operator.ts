import { apiRequest } from './client';

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
        item_type: 'FOLLOWUP_CASE' | 'FOLLOWUP_CANDIDATE' | 'UNMATCHED_DEVICE';
        metadata: Record<string, unknown>;
      }
  );

export type AttendanceCorrectionRequestId = number;

export type SelfConfirmCorrectionPayload = {
  expected_version: number;
  confirmation: string;
  confirmation_note: string;
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

export async function fetchOperatorWorkQueue(): Promise<OperatorWorkQueueItem[]> {
  const response = await apiRequest<OperatorWorkQueueItem[]>({
    path: '/api/operator/work-queue',
  });
  return response.data || [];
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
