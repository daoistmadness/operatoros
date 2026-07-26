import { apiRequest } from './client';

export async function fetchDeploymentMode() {
  try {
    const response = await apiRequest({
      path: '/api/config/deployment-mode',
    });
    return response.data || { deployment_mode: 'multi_user' };
  } catch (err) {
    return { deployment_mode: 'multi_user' };
  }
}

export async function fetchOperatorWorkQueue() {
  const response = await apiRequest({
    path: '/api/operator/work-queue',
  });
  return response.data || [];
}

export async function selfConfirmCorrection(requestId, payload) {
  const response = await apiRequest({
    path: `/api/attendance-corrections/${requestId}/self-confirm`,
    method: 'POST',
    data: payload,
  });
  return response.data;
}
