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

export function getUploadHistory(params: Record<string, string | number | boolean | undefined>) {
  return api.get("/api/uploads/history", { params }).then((response) => response.data as HistoryPage);
}

export function getUploadDetail(uploadId: string) {
  return api.get(`/api/uploads/history/${encodeURIComponent(uploadId)}`).then((response) => response.data as UploadRecord);
}

export function getUploadTimeline(uploadId: string) {
  return api.get(`/api/uploads/history/${encodeURIComponent(uploadId)}/timeline`).then((response) => response.data.items as any[]);
}

export function getUploadRows(uploadId: string, page: number, outcome?: string) {
  return api.get(`/api/uploads/history/${encodeURIComponent(uploadId)}/rows`, {
    params: { page, page_size: 25, outcome: outcome || undefined },
  }).then((response) => response.data as any);
}

export function downloadUploadEvidence(uploadId: string, format: "csv" | "json") {
  return api.get(`/api/uploads/history/${encodeURIComponent(uploadId)}/export.${format}`, {
    responseType: "blob",
  }).then((response) => response.data as Blob);
}
