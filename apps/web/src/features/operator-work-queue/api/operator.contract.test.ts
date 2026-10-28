import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../../lib/api/client';
import {
  acknowledgeBospReminder,
  fetchDeploymentMode,
  fetchOperatorWorkQueue,
  selfConfirmCorrection,
  updateBospReminderSettings,
} from './operator';

vi.mock('../../../lib/api/client', () => ({ apiRequest: vi.fn() }));

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
      body: payload,
    });
  });

  it('sends BOSP acknowledgement and settings as request bodies', async () => {
    const acknowledgement = { calendar_year: 2027, notes: 'Reviewed' };
    const settings = { advance_notice_days: 45 };
    vi.mocked(apiRequest).mockResolvedValue({ data: {}, status: 200, headers: {} });
    await acknowledgeBospReminder(acknowledgement);
    await updateBospReminderSettings(settings);
    expect(apiRequest).toHaveBeenNthCalledWith(1, {
      path: '/api/operator/bosp-reminder/acknowledge',
      method: 'POST',
      body: acknowledgement,
    });
    expect(apiRequest).toHaveBeenNthCalledWith(2, {
      path: '/api/operator/bosp-reminder/settings',
      method: 'PUT',
      body: settings,
    });
  });
});
