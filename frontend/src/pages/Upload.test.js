import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../api';
import { classifyUploadError, uploadAttendanceFile } from './Upload';

vi.mock('../api', () => ({
  default: { post: vi.fn() },
}));

describe('attendance upload errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts a browser-managed multipart body to the canonical route', async () => {
    api.post.mockResolvedValue({ data: { report: {} } });
    const file = new File(['workbook'], 'attendance export.xls.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await uploadAttendanceFile(file);

    expect(api.post).toHaveBeenCalledTimes(1);
    const [path, body, config] = api.post.mock.calls[0];
    expect(path).toBe('/api/uploads/upload');
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file')).toBe(file);
    expect(config).toBeUndefined();
  });

  it.each([
    [401, 'session has expired'],
    [403, 'does not have permission'],
    [404, 'service was not found'],
    [405, 'could not be accepted'],
    [413, 'larger than'],
    [422, 'could not be validated'],
    [500, 'could not process the workbook'],
    [0, 'could not be reached'],
  ])('classifies status %s', (status, message) => {
    expect(classifyUploadError({ status, response: { status, data: {} } })).toContain(message);
  });

  it('preserves safe validation details', () => {
    expect(classifyUploadError({ status: 400, response: { status: 400, data: { detail: 'Missing required column: Tanggal' } } }))
      .toBe('Missing required column: Tanggal');
  });

  it.each([404, 405, 500])('does not expose implementation terms for status %s', (status) => {
    const message = classifyUploadError({ status, response: { status, data: {} } });
    expect(message).not.toMatch(/routing configuration|backend logs|endpoint|upload method/i);
  });
});
