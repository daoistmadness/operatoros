import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './client';
import {
  addFollowUpNote,
  createFollowUpCase,
  fetchFollowUpCandidates,
  fetchFollowUpDetail,
  updateFollowUpState,
} from './followups';

vi.mock('./client', () => ({ apiRequest: vi.fn() }));

describe('attendance follow-up API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps list query and integer detail paths stable', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ data: { total: 0, items: [] }, status: 200, headers: {} })
      .mockResolvedValueOnce({ data: { id: 42 }, status: 200, headers: {} });
    await fetchFollowUpCandidates({ class_id: 3 });
    await fetchFollowUpDetail(42);
    expect(apiRequest).toHaveBeenNthCalledWith(1, {
      path: '/api/attendance/followups/candidates',
      params: { class_id: 3 },
    });
    expect(apiRequest).toHaveBeenNthCalledWith(2, { path: '/api/attendance/followups/42' });
  });

  it('preserves accepted-main mutation serialization', async () => {
    const createPayload = { exception_key: 'late:42', exception_kind: 'LATE' };
    const updatePayload = { target_status: 'CLOSED', version: 2 };
    const notePayload = { body: 'Reviewed' };
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: 42 }, status: 200, headers: {} });
    await createFollowUpCase(createPayload);
    await updateFollowUpState(42, updatePayload);
    await addFollowUpNote(42, notePayload);
    expect(apiRequest).toHaveBeenNthCalledWith(1, {
      path: '/api/attendance/followups',
      method: 'POST',
      body: createPayload,
    });
    expect(apiRequest).toHaveBeenNthCalledWith(2, {
      path: '/api/attendance/followups/42/status',
      method: 'PATCH',
      body: updatePayload,
    });
    expect(apiRequest).toHaveBeenNthCalledWith(3, {
      path: '/api/attendance/followups/42/notes',
      method: 'POST',
      body: notePayload,
    });
  });
});
