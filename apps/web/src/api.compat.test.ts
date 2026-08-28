import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './lib/api/client';
import api from './api';

vi.mock('./lib/api/client', () => ({
  API_BASE_URL: '/api-base',
  apiRequest: vi.fn(),
}));

describe('legacy API compatibility facade', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves query parameters and response metadata', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { ok: true }, status: 200, headers: {} });
    await api.get('/api/example', { params: { page: 2 } });
    expect(apiRequest).toHaveBeenCalledWith({
      path: '/api/example',
      method: 'GET',
      body: undefined,
      params: { page: 2 },
      headers: undefined,
      timeout: undefined,
      responseType: 'json',
    });
    expect(api.defaults.baseURL).toBe('/api-base');
  });

  it('serializes mutation bodies and blob requests without changing routes', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: {}, status: 200, headers: {} });
    await api.post('/api/example', { value: 1 });
    await api.get('/api/export', { responseType: 'blob', timeout: 60_000 });
    expect(apiRequest).toHaveBeenNthCalledWith(1, expect.objectContaining({
      path: '/api/example',
      method: 'POST',
      body: { value: 1 },
      responseType: 'json',
    }));
    expect(apiRequest).toHaveBeenNthCalledWith(2, expect.objectContaining({
      path: '/api/export',
      method: 'GET',
      responseType: 'blob',
      timeout: 60_000,
    }));
  });
});
