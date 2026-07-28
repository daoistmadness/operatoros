import { queryOptions, useQuery } from "@tanstack/react-query";
import { fetchRosterComparison, fetchStudentCandidates, fetchUploadConflicts } from "../api/uploadConflicts";
import { getUploadDetail, getUploadHistory, getUploadRows, getUploadTimeline } from "../api/uploadHistory";
import { queryKeys } from "../lib/query/queryKeys";

export type UploadHistoryFilters = {
  page: number;
  page_size: number;
  workflow_type?: string;
  reconciliation_state?: string;
  filename?: string;
  unresolved_only?: boolean;
};

export type UploadConflictFilters = {
  page: number;
  page_size: number;
  workflow_type?: string;
  resolution_status?: string;
};

export function uploadHistoryListOptions(filters: UploadHistoryFilters, enabled = true) {
  return queryOptions({
    queryKey: queryKeys.uploads.history.list(filters),
    queryFn: ({ signal }) => getUploadHistory(filters, signal),
    enabled,
  });
}

export function useUploadHistoryListQuery(filters: UploadHistoryFilters, enabled = true) {
  return useQuery(uploadHistoryListOptions(filters, enabled));
}

export function uploadHistoryDetailOptions(uploadId: string, enabled = true) {
  return queryOptions({
    queryKey: queryKeys.uploads.history.detail(uploadId),
    queryFn: ({ signal }) => getUploadDetail(uploadId, signal),
    enabled: enabled && Boolean(uploadId),
  });
}

export function useUploadHistoryDetailQuery(uploadId: string, enabled = true) {
  return useQuery(uploadHistoryDetailOptions(uploadId, enabled));
}

export function useUploadTimelineQuery(uploadId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.uploads.history.timeline(uploadId),
    queryFn: ({ signal }) => getUploadTimeline(uploadId, signal),
    enabled: enabled && Boolean(uploadId),
  });
}

export function useUploadRowsQuery(uploadId: string, page: number, outcome: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.uploads.history.rows(uploadId, page, outcome || undefined),
    queryFn: ({ signal }) => getUploadRows(uploadId, page, outcome || undefined, signal),
    enabled: enabled && Boolean(uploadId),
    placeholderData: (previous) => previous,
  });
}

export function uploadConflictListOptions(filters: UploadConflictFilters, enabled = true) {
  return queryOptions({
    queryKey: queryKeys.uploads.conflicts.list(filters),
    queryFn: ({ signal }) => fetchUploadConflicts(filters, signal),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useUploadConflictListQuery(filters: UploadConflictFilters, enabled = true) {
  return useQuery(uploadConflictListOptions(filters, enabled));
}

export function uploadConflictCandidatesOptions(itemId: string, search: string, enabled = true) {
  return queryOptions({
    queryKey: queryKeys.uploads.conflicts.candidates(itemId, search),
    queryFn: ({ signal }) => fetchStudentCandidates(itemId, search, signal),
    enabled: enabled && Boolean(itemId) && search.length >= 2,
  });
}

export function useUploadConflictCandidatesQuery(itemId: string, search: string, enabled = true) {
  return useQuery(uploadConflictCandidatesOptions(itemId, search, enabled));
}

export function rosterComparisonOptions(itemId: string, studentId: string, enabled = true) {
  return queryOptions({
    queryKey: queryKeys.uploads.conflicts.comparison(itemId, studentId),
    queryFn: ({ signal }) => fetchRosterComparison(itemId, studentId, signal),
    enabled: enabled && Boolean(itemId) && Boolean(studentId),
  });
}

export function useRosterComparisonQuery(itemId: string, studentId: string, enabled = true) {
  return useQuery(rosterComparisonOptions(itemId, studentId, enabled));
}
