import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './client';
import { getServerStatus } from './endpoints';

vi.mock('./client', () => ({ apiRequest: vi.fn() }));

describe('server status API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the canonical proxied system health endpoint', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      data: { status: 'ok' },
      status: 200,
      headers: {},
    });

    const controller = new AbortController();
    await expect(getServerStatus(controller.signal)).resolves.toBe('online');
    expect(apiRequest).toHaveBeenCalledWith({ path: '/api/system/health', signal: controller.signal });
  });
});
