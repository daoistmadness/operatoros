import { apiRequest } from "../lib/api/client";

export type ConflictItem = {
  resolution_item_id: string;
  workflow_type: "ATTENDANCE" | "ROSTER";
  source_session_id: string;
  source_filename: string;
  source_checksum: string;
  source_checksum_prefix: string;
  source_row_number: number;
  created_at: string;
  latest_classification: string;
  operator_message: string;
  technical_code: string;
  recommended_action: string;
  resolution_status: string;
  retry_eligible: boolean;
  affected_identifiers: Record<string, string | null>;
  student?: { id: string; full_name: string; student_status: string } | null;
  latest_retry_at?: string | null;
};

export type ConflictQueue = {
  items: ConflictItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  summary: { unresolved: number; attendance: number; roster: number; retry_ready: number };
};

export type StudentCandidate = {
  id: string;
  record_version: string;
  full_name: string;
  nipd_masked?: string | null;
  nisn_masked?: string | null;
  student_status: string;
  current_class?: string | null;
  jenjang_id?: number | null;
  has_active_device: boolean;
  active_device_masked?: string | null;
};

export type RetryOutcome = {
  resolution_item_id: string;
  retry_row_id: number;
  source_row: number;
  classification: string;
  outcome: string;
};

export type RetryPreview = {
  workflow_type: "ATTENDANCE";
  source_session_id: string;
  source_checksum: string;
  retry_batch_id: string;
  outcomes: RetryOutcome[];
  summary: Record<string, number>;
};

export type RosterComparison = {
  resolution_item_id: string;
  source_filename: string;
  source_row: number;
  source_checksum_prefix: string;
  student: { id: string; full_name: string; record_version: string } | null;
  fields: Array<{
    field: string;
    incoming_value: string | null;
    existing_value: string | null;
    classification: string;
    allowed_actions: string[];
    explanation: string;
  }>;
  allowed_plans: string[];
};

export async function fetchUploadConflicts(params: Record<string, string | number | boolean | undefined>, signal?: AbortSignal) {
  return (await apiRequest<ConflictQueue>({ path: "/api/upload-conflicts", params, signal })).data;
}

export async function fetchStudentCandidates(itemId: string, query: string, signal?: AbortSignal) {
  return (await apiRequest<{ items: StudentCandidate[] }>({
    path: `/api/upload-conflicts/${encodeURIComponent(itemId)}/student-candidates`,
    params: { query },
    signal,
  })).data.items;
}

export async function linkConflictDevice(item: ConflictItem, candidate: StudentCandidate) {
  return (await apiRequest({
    path: `/api/upload-conflicts/${encodeURIComponent(item.resolution_item_id)}/link-device`,
    method: "POST",
    body: {
      expected_source_checksum: item.source_checksum,
      expected_device_identifier: item.affected_identifiers.device_identifier,
      student_master_id: candidate.id,
      expected_student_version: candidate.record_version,
      confirmation: "LINK_UNMATCHED_DEVICE_ID",
    },
  })).data;
}

export async function retryConflictPreview(item: ConflictItem) {
  return (await apiRequest<RetryPreview>({
    path: "/api/upload-conflicts/retry-preview",
    method: "POST",
    body: {
      source_session_id: item.source_session_id,
      source_checksum: item.source_checksum,
      resolution_item_ids: [item.resolution_item_id],
      expected_classification: "CONFLICT",
      retry_mode: "PREVIEW_ONLY",
    },
  })).data;
}

export async function commitConflictRetry(item: ConflictItem, preview: RetryPreview, selectedRetryRowIds: number[]) {
  return (await apiRequest<Record<string, number>>({
    path: "/api/upload-conflicts/retry-commit",
    method: "POST",
    body: {
      source_session_id: item.source_session_id,
      source_checksum: item.source_checksum,
      resolution_item_ids: [item.resolution_item_id],
      retry_batch_id: preview.retry_batch_id,
      retry_checksum: preview.source_checksum,
      selected_retry_row_ids: selectedRetryRowIds,
      confirmation: "COMMIT_ATTENDANCE_IMPORT",
    },
  })).data;
}

export async function fetchRosterComparison(itemId: string, studentMasterId: string, signal?: AbortSignal) {
  return (await apiRequest<RosterComparison>({
    path: `/api/upload-conflicts/${encodeURIComponent(itemId)}/roster-comparison`,
    params: { student_master_id: studentMasterId },
    signal,
  })).data;
}

export async function resolveRosterConflict(item: ConflictItem, candidate: StudentCandidate) {
  return (await apiRequest({
    path: `/api/upload-conflicts/${encodeURIComponent(item.resolution_item_id)}/resolve-roster`,
    method: "POST",
    body: {
      expected_source_checksum: item.source_checksum,
      student_master_id: candidate.id,
      expected_student_version: candidate.record_version,
      resolution_plan: "LINK_ROW_TO_EXISTING_STUDENT",
      confirmation: "RESOLVE_ROSTER_CONFLICT",
    },
  })).data;
}
