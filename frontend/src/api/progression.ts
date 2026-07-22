import { apiRequest } from "../lib/api/client";

export type ProgressionOutcome = "PROMOTE" | "RETAIN" | "GRADUATE" | "CROSS_JENJANG" | "WITHDRAW" | "EXCLUDE" | "MANUAL_REVIEW";
export type ProgressionValidation = "VALID" | "CONFLICT" | "MANUAL_REVIEW";

export interface ProgressionRow {
  preview_row_id: number;
  source_enrollment_id: number;
  student_master_id: string;
  student_name: string;
  source_jenjang_id: number;
  source_program_id: number | null;
  source_grade_id: number | null;
  source_class_id: number | null;
  source_class_name: string | null;
  proposed_outcome: ProgressionOutcome;
  destination_jenjang_id: number | null;
  destination_program_id: number | null;
  destination_grade_id: number | null;
  destination_class_id: number | null;
  mapping_source: string;
  operator_override: boolean;
  reason_code: string | null;
  reason: string | null;
  warning_codes: string[];
  conflict_codes: string[];
  validation_result: ProgressionValidation;
  device_linked: boolean;
}

export interface ProgressionSummary {
  total: number;
  valid: number;
  manual_review: number;
  conflict: number;
  outcomes: Partial<Record<ProgressionOutcome, number>>;
  conflicts_by_code: Record<string, number>;
}

export interface ProgressionBatch {
  batch_id: string;
  source_academic_year_id: number;
  destination_academic_year_id: number;
  status: "PREVIEW" | "STALE" | "COMMITTING" | "COMMITTED" | "FAILED" | "EXPIRED";
  preview_version: number;
  snapshot_checksum: string;
  summary: ProgressionSummary;
  rows: ProgressionRow[];
  result: ProgressionResult | null;
}

export interface ProgressionResult {
  status: "COMMITTED";
  batch_id: string;
  preview_version: number;
  applied: number;
  destination_enrollments_created: number;
  graduated: number;
  retained: number;
  cross_jenjang: number;
  withdrawn: number;
  excluded: number;
  skipped: number;
}

export async function createProgressionPreview(payload: {
  source_academic_year_id: number;
  destination_academic_year_id: number;
  source_enrollment_ids?: number[];
}): Promise<ProgressionBatch> {
  const response = await apiRequest<ProgressionBatch>({ path: "/api/student-progression/previews", method: "POST", body: { ...payload, overrides: [] } });
  return response.data;
}

export async function fetchProgressionPreview(batchId: string): Promise<ProgressionBatch> {
  const response = await apiRequest<ProgressionBatch>({ path: `/api/student-progression/previews/${batchId}`, method: "GET" });
  return response.data;
}

export async function patchProgressionRow(batchId: string, rowId: number, payload: {
  preview_version: number;
  outcome?: ProgressionOutcome;
  destination_jenjang_id?: number;
  destination_program_id?: number;
  destination_grade_id?: number;
  destination_class_id?: number;
  reason_code?: string;
  reason?: string;
}): Promise<ProgressionBatch> {
  const response = await apiRequest<ProgressionBatch>({ path: `/api/student-progression/previews/${batchId}/rows/${rowId}`, method: "PATCH", body: payload });
  return response.data;
}

export async function revalidateProgressionPreview(batchId: string, previewVersion: number): Promise<ProgressionBatch> {
  const response = await apiRequest<ProgressionBatch>({ path: `/api/student-progression/previews/${batchId}/revalidate`, method: "POST", body: { preview_version: previewVersion } });
  return response.data;
}

export async function commitProgressionPreview(batchId: string, payload: {
  preview_version: number;
  effective_date: string;
  confirmation: string;
}): Promise<ProgressionResult> {
  const response = await apiRequest<ProgressionResult>({ path: `/api/student-progression/previews/${batchId}/commit`, method: "POST", body: payload });
  return response.data;
}
