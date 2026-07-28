import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './client';
import {
  getRekapAbsensiReport,
  getServerStatus,
  normalizeAbsenceTotals,
  saveHebOverride,
} from './endpoints';

vi.mock('./client', () => ({
  API_BLOB_TYPES: { excel: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
  apiRequest: vi.fn(),
}));

describe('shared endpoint contracts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses canonical health and report routes', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ data: {}, status: 200, headers: {} })
      .mockResolvedValueOnce({ data: {}, status: 200, headers: {} });
    await getServerStatus();
    const report = await getRekapAbsensiReport({ month: 7, year: 2026 });
    expect(apiRequest).toHaveBeenNthCalledWith(1, { path: '/api/system/health' });
    expect(apiRequest).toHaveBeenNthCalledWith(2, {
      path: '/api/analytics/v2/rekap-absensi',
      params: { month: 7, year: 2026 },
    });
    expect(report).toMatchObject({ jenjang: [], chart_data: [], period: {} });
  });

  it('preserves encoded HEB routes and request bodies', async () => {
    const body = { heb_value: 20, note: 'revision' };
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {}, status: 200, headers: {} });
    await saveHebOverride('SMA Plus', 2026, 7, body);
    expect(apiRequest).toHaveBeenCalledWith({
      path: '/api/config/heb/SMA%20Plus/2026/7',
      method: 'PUT',
      body,
    });
  });

  it('normalizes numeric absence totals', () => {
    expect(normalizeAbsenceTotals([
      { total_sakit: '2', total_izin: 1, total_alfa: null, classes_entered: 3, classes_total: 4 },
    ])).toEqual({ sakit: 2, izin: 1, alfa: 0, entered: 3, total: 4 });
  });
});
