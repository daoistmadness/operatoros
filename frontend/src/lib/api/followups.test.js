import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './client';
import {
  createFollowUpCase,
  fetchFollowUpCandidates,
  fetchFollowUpCases,
} from './followups';

vi.mock('./client', () => ({ apiRequest: vi.fn() }));

describe('attendance follow-up API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('unwraps candidate items from the paginated response', async () => {
    const items = [{ exception_key: 'absence:1:2026-07-27' }];
    apiRequest.mockResolvedValueOnce({
      data: { total: 1, items },
      status: 200,
      headers: {},
    });

    await expect(fetchFollowUpCandidates()).resolves.toEqual(items);
  });

  it('unwraps case items from the paginated response', async () => {
    const items = [{ id: 7, status: 'OPEN' }];
    apiRequest.mockResolvedValueOnce({
      data: { total: 1, items },
      status: 200,
      headers: {},
    });

    await expect(fetchFollowUpCases()).resolves.toEqual(items);
  });

  it('sends create payloads through the shared client body contract', async () => {
    const payload = { exception_key: 'absence:1:2026-07-27' };
    apiRequest.mockResolvedValueOnce({
      data: { id: 7 },
      status: 200,
      headers: {},
    });

    await createFollowUpCase(payload);

    expect(apiRequest).toHaveBeenCalledWith({
      path: '/api/attendance/followups',
      method: 'POST',
      body: payload,
    });
  });
});
