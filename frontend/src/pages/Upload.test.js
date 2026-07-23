import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../api';
import { classifyUploadError, commitAttendancePreview, previewAttendanceFile } from './Upload';

vi.mock('../api', () => ({
  default: { post: vi.fn() },
}));

describe('attendance upload errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses preview and explicit commit without calling the legacy upload route', async () => {
    api.post.mockResolvedValue({ data: {} });
    const file = new File(['workbook'], 'attendance export.xls.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await previewAttendanceFile(file);
    await commitAttendancePreview('batch-1', [7, 8]);

    expect(api.post).toHaveBeenCalledTimes(2);
    const [path, body] = api.post.mock.calls[0];
    expect(path).toBe('/api/uploads/preview');
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file')).toBe(file);
    expect(api.post).toHaveBeenLastCalledWith('/api/uploads/preview/batch-1/commit', {
      selected_row_ids: [7, 8],
      confirmation: 'COMMIT_ATTENDANCE_IMPORT',
    });
    expect(api.post.mock.calls.flat()).not.toContain('/api/uploads/upload');
  });

  it.each([
    [401, 'session has expired'],
    [403, 'does not have permission'],
    [404, 'could not be completed'],
    [405, 'could not be completed'],
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
