import api from "../api";

export type UploadRecord = {
  upload_id: string;
  workflow_type: "ATTENDANCE" | "ROSTER";
  source_filename: string;
  checksum_prefix: string;
  first_activity_at: string | null;
  latest_activity_at: string | null;
  actor: string;
  status: string;
  reconciliation_state: string;
  reconciliation_messages: string[];
  preview_total: number | null;
  preview_eligible: number | null;
  preview_blocked: number | null;
  selected_total: number | null;
  committed_total: number | null;
  created_total: number | null;
  updated_total: number | null;
  unchanged_total: number | null;
  skipped_total: number | null;
  duplicate_total: number | null;
  conflict_total: number | null;
  invalid_total: number | null;
  protected_total: number | null;
  failed_total: number | null;
  unresolved_total: number | null;
  retried_total: number | null;
  retry_selected_total: number | null;
  retry_committed_total: number | null;
  retry_attempt_count: number;
  rollback_attempted: boolean;
  rollback_succeeded: boolean;
};

export type HistoryPage = {
  items: UploadRecord[];
  page: number;
  page_size: number;
  total: number;
  pages: number;
};

export type UploadTimelineItem = {
  reference_id: string;
  timestamp: string | null;
  event: string;
  message: string;
  actor: string | null;
};
export type UploadRow = {
  stable_row_reference: string;
  source_row_number: number | null;
  preview_classification: string;
  selection_state: string;
  commit_outcome: string;
  retry_outcome: string;
  masked_identifier: string | null;
  explanation: string;
  recommended_action: string;
};

export function getUploadHistory(params: Record<string, string | number | boolean | undefined>, signal?: AbortSignal) {
  return api.get("/api/uploads/history", { params, signal }).then((response) => response.data as HistoryPage);
}

export function getUploadDetail(uploadId: string, signal?: AbortSignal) {
  return api.get(`/api/uploads/history/${encodeURIComponent(uploadId)}`, { signal }).then((response) => response.data as UploadRecord);
}

export function getUploadTimeline(uploadId: string, signal?: AbortSignal) {
  return api.get<{ items: UploadTimelineItem[] }>(
    `/api/uploads/history/${encodeURIComponent(uploadId)}/timeline`,
    { signal },
  ).then((response) => response.data.items);
}

export function getUploadRows(uploadId: string, page: number, outcome?: string, signal?: AbortSignal) {
  return api.get(`/api/uploads/history/${encodeURIComponent(uploadId)}/rows`, {
    params: { page, page_size: 25, outcome: outcome || undefined },
    signal,
  }).then((response) => response.data as { items: UploadRow[]; page: number; pages: number; total: number });
}

export function downloadUploadEvidence(uploadId: string, format: "csv" | "json") {
  return api.get(`/api/uploads/history/${encodeURIComponent(uploadId)}/export.${format}`, {
    responseType: "blob",
  }).then((response) => response.data as Blob);
}
