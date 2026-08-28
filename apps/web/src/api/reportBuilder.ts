import { API_BLOB_TYPES, apiRequest } from "../lib/api/client";

export type ReportTemplateType = "management_summary" | "academic_review" | "intervention_review" | "attendance_review";
export type ReportOutputFormat = "pdf" | "excel" | "both";
export type ReportForecastMethod = "moving_average" | "weighted_moving_average" | "linear_trend";
export type ReportGranularity = "month" | "term" | "academic_year";

export interface ReportTemplate {
  id: number;
  name: string;
  description: string | null;
  template_type: ReportTemplateType;
  output_format: ReportOutputFormat;
  is_default: boolean;
  is_active: boolean;
  page_order_json: string[];
  section_visibility_json: Record<string, boolean>;
  chart_visibility_json: Record<string, boolean>;
  excel_sheet_visibility_json: Record<string, boolean>;
  default_filters_json: Record<string, unknown>;
  export_options_json: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ReportBranding {
  id: number;
  school_name: string;
  foundation_name: string | null;
  report_header_title: string;
  report_subtitle: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  logo_path: string | null;
  logo_label: string | null;
  footer_text: string;
  prepared_by: string;
  is_default: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ReportPreviewFilters {
  academic_year_id: number;
  jenjang_id?: number | null;
  class_name?: string | null;
  subject_id?: number | null;
  term?: string | null;
}

export interface ReportPreviewRequest {
  template_id?: number | null;
  filters: ReportPreviewFilters;
  include_trends?: boolean;
  include_forecast?: boolean;
  forecast_method?: ReportForecastMethod;
  granularity?: ReportGranularity;
}

export interface ReportPreviewResponse {
  selected_template: ReportTemplate | null;
  resolved_sections: string[];
  resolved_filters: Record<string, unknown>;
  estimated_pdf_pages: number;
  excel_sheets: string[];
  warnings: string[];
  data_quality_diagnostics: Array<{ code?: string; severity?: string; message: string }>;
  available_sections: string[];
  missing_sections: string[];
  branding: ReportBranding | null;
}

export function reportBuilderApiPath(path: string): string {
  return `/api/report-builder${path}`;
}

export async function fetchReportSections(): Promise<Record<string, { label: string; description: string; supports_pdf: boolean; supports_excel: boolean; default_enabled: boolean }>> {
  const response = await apiRequest<Record<string, { label: string; description: string; supports_pdf: boolean; supports_excel: boolean; default_enabled: boolean }>>({
    path: reportBuilderApiPath("/sections"),
    method: "GET",
  });

  return response.data;
}

export async function fetchReportTemplates(params?: {
  template_type?: ReportTemplateType | null;
  output_format?: ReportOutputFormat | null;
}): Promise<ReportTemplate[]> {
  const response = await apiRequest<ReportTemplate[]>({
    path: reportBuilderApiPath("/templates"),
    method: "GET",
    params,
  });

  return response.data;
}

export async function createReportTemplate(payload: Omit<ReportTemplate, "id" | "created_at" | "updated_at">): Promise<ReportTemplate> {
  const response = await apiRequest<ReportTemplate>({
    path: reportBuilderApiPath("/templates"),
    method: "POST",
    body: payload,
  });

  return response.data;
}

export async function updateReportTemplate(id: number, payload: Partial<Omit<ReportTemplate, "id" | "created_at" | "updated_at">>): Promise<ReportTemplate> {
  const response = await apiRequest<ReportTemplate>({
    path: reportBuilderApiPath(`/templates/${id}`),
    method: "PATCH",
    body: payload,
  });

  return response.data;
}

export async function deleteReportTemplate(id: number): Promise<{ status: "success"; deleted: number; id: number }> {
  const response = await apiRequest<{ status: "success"; deleted: number; id: number }>({
    path: reportBuilderApiPath(`/templates/${id}`),
    method: "DELETE",
  });

  return response.data;
}

export async function fetchReportBranding(): Promise<{ items: ReportBranding[]; default: ReportBranding | null; resolved_default: ReportBranding | null }> {
  const response = await apiRequest<{ items: ReportBranding[]; default: ReportBranding | null; resolved_default: ReportBranding | null }>({
    path: reportBuilderApiPath("/branding"),
    method: "GET",
  });

  return response.data;
}

export async function createReportBranding(payload: Omit<ReportBranding, "id" | "created_at" | "updated_at">): Promise<ReportBranding> {
  const response = await apiRequest<ReportBranding>({
    path: reportBuilderApiPath("/branding"),
    method: "POST",
    body: payload,
  });

  return response.data;
}

export async function updateReportBranding(id: number, payload: Partial<Omit<ReportBranding, "id" | "created_at" | "updated_at">>): Promise<ReportBranding> {
  const response = await apiRequest<ReportBranding>({
    path: reportBuilderApiPath(`/branding/${id}`),
    method: "PATCH",
    body: payload,
  });

  return response.data;
}

export async function previewReportBuilder(payload: ReportPreviewRequest): Promise<ReportPreviewResponse> {
  const response = await apiRequest<ReportPreviewResponse>({
    path: reportBuilderApiPath("/preview"),
    method: "POST",
    body: payload,
  });

  return response.data;
}

export async function downloadReportBuilderPdf(payload: ReportPreviewRequest): Promise<Blob> {
  const response = await apiRequest<Blob>({
    path: reportBuilderApiPath("/export/pdf"),
    method: "POST",
    body: payload,
    responseType: "blob",
    expectedBlobTypes: API_BLOB_TYPES.pdf,
  });

  return response.data;
}

export async function downloadReportBuilderExcel(payload: ReportPreviewRequest & { mode?: string }): Promise<Blob> {
  const response = await apiRequest<Blob>({
    path: reportBuilderApiPath("/export/excel"),
    method: "POST",
    body: payload,
    responseType: "blob",
    expectedBlobTypes: API_BLOB_TYPES.excel,
  });

  return response.data;
}

