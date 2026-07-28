import { apiRequest } from './client';

export type DeploymentMode = 'single_user_offline' | 'multi_user';

export type DeploymentModeResponse = {
  deployment_mode: DeploymentMode;
};

export type OperatorWorkQueueItem = Record<string, unknown> & {
  item_type: 'FOLLOWUP_CASE' | 'FOLLOWUP_CANDIDATE' | 'CORRECTION_REQUEST' | 'UNMATCHED_DEVICE';
  source_id: string;
  deduplication_key: string;
  available_actions: string[];
  source_route: string;
};

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
