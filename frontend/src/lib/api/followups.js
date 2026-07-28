import { apiRequest } from './client';

export async function fetchFollowUpCandidates(params = {}) {
  const response = await apiRequest({
    path: '/api/attendance/followups/candidates',
    params,
  });
  return response.data?.items || [];
}

export async function fetchFollowUpCases(params = {}) {
  const response = await apiRequest({
    path: '/api/attendance/followups',
    params,
  });
  return response.data?.items || [];
}

export async function fetchFollowUpDetail(caseId) {
  const response = await apiRequest({
    path: `/api/attendance/followups/${caseId}`,
  });
  return response.data;
}

export async function createFollowUpCase(payload) {
  const response = await apiRequest({
    path: '/api/attendance/followups',
    method: 'POST',
    body: payload,
  });
  return response.data;
}

export async function updateFollowUpState(caseId, payload) {
  const response = await apiRequest({
    path: `/api/attendance/followups/${caseId}/status`,
    method: 'PATCH',
    body: payload,
  });
  return response.data;
}

export async function addFollowUpNote(caseId, payload) {
  const response = await apiRequest({
    path: `/api/attendance/followups/${caseId}/notes`,
    method: 'POST',
    body: payload,
  });
  return response.data;
}

export async function fetchFollowUpHistory(caseId) {
  const response = await apiRequest({
    path: `/api/attendance/followups/${caseId}/history`,
  });
  return response.data || [];
}

export async function fetchFollowUpMetrics() {
  const response = await apiRequest({
    path: '/api/attendance/followups/metrics/summary',
  });
  return response.data || {};
}
