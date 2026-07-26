import { apiRequest } from '../lib/api/client';

export interface DatasetInfo {
  identifier: string;
  format_version: string;
  required_columns: string[];
  optional_columns: string[];
  export_eligible: boolean;
  import_eligible: boolean;
  requires_sensitive_capability: boolean;
  has_sensitive_access: boolean;
  update_policy: string;
}

export interface ExportPreviewResult {
  dataset: string;
  format_version: string;
  estimated_row_count: number;
  sensitive_fields_included: boolean;
  allowed: boolean;
  warnings: string[];
  maximum_permitted_rows: number;
}

export interface ImportPreviewResult {
  batch_id: string;
  dataset: string;
  filename: string;
  source_hash: string;
  total_rows: number;
  valid_count: number;
  error_count: number;
  summary: Record<string, number>;
  classified_rows: Array<{
    row: string;
    student_id?: string;
    device_id?: string;
    full_name?: string;
    status: string;
    error?: string;
  }>;
  errors: Array<{
    row: string;
    field: string;
    code: string;
    message: string;
  }>;
}

export interface HistoryItem {
  id: number;
  timestamp: string;
  operation: string;
  entity_type: string;
  dataset: string;
  actor: string;
  role: string;
  success: boolean;
  failure_code: string | null;
  row_count: number;
  sensitive: boolean;
  format: string;
}

export async function fetchDatasets(): Promise<DatasetInfo[]> {
  return apiRequest('/api/data-portability/datasets');
}

export async function previewExport(data: {
  dataset: string;
  filters?: Record<string, any>;
  include_sensitive_fields?: boolean;
}): Promise<ExportPreviewResult> {
  return apiRequest('/api/data-portability/exports/preview', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function downloadExport(data: {
  dataset: string;
  format_type: 'csv' | 'csv_bundle';
  filters?: Record<string, any>;
  include_sensitive_fields?: boolean;
}): Promise<Blob> {
  const response = await fetch('/api/data-portability/exports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.detail || 'Export download failed');
  }
  return response.blob();
}

export async function previewImport(dataset: string, file: File): Promise<ImportPreviewResult> {
  const formData = new FormData();
  formData.append('dataset', dataset);
  formData.append('file', file);

  const response = await fetch('/api/data-portability/imports/preview', {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.detail || 'Import preview failed');
  }
  return response.json();
}

export async function commitImport(batch_id: string, confirmation: string = 'CONFIRM_IMPORT'): Promise<{ success: boolean; committed_count: number; message: string }> {
  return apiRequest('/api/data-portability/imports/commit', {
    method: 'POST',
    body: JSON.stringify({ batch_id, confirmation }),
  });
}

export async function downloadErrorFile(errors: any[]): Promise<Blob> {
  const response = await fetch('/api/data-portability/imports/error-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ errors }),
  });
  if (!response.ok) {
    throw new Error('Failed to generate error file');
  }
  return response.blob();
}

export async function fetchPortabilityHistory(): Promise<HistoryItem[]> {
  return apiRequest('/api/data-portability/history');
}
