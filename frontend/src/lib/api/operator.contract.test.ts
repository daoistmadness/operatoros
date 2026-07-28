import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './client';
import {
  fetchDeploymentMode,
  fetchOperatorWorkQueue,
  selfConfirmCorrection,
} from './operator';

vi.mock('./client', () => ({ apiRequest: vi.fn() }));

describe('operator API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses canonical deployment and queue routes', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ data: { deployment_mode: 'single_user_offline' }, status: 200, headers: {} })
      .mockResolvedValueOnce({ data: [], status: 200, headers: {} });
    await expect(fetchDeploymentMode()).resolves.toEqual({ deployment_mode: 'single_user_offline' });
    await fetchOperatorWorkQueue();
    expect(apiRequest).toHaveBeenNthCalledWith(1, { path: '/api/config/deployment-mode' });
    expect(apiRequest).toHaveBeenNthCalledWith(2, { path: '/api/operator/work-queue' });
  });

  it('preserves integer correction IDs and accepted-main payload serialization', async () => {
    const payload = {
      expected_version: 4,
      confirmation: 'CONFIRM',
      confirmation_note: 'verified',
    };
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {}, status: 200, headers: {} });
    await selfConfirmCorrection(17, payload);
    expect(apiRequest).toHaveBeenCalledWith({
      path: '/api/attendance-corrections/17/self-confirm',
      method: 'POST',
      data: payload,
    });
  });
});
