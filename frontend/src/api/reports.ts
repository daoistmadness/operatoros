import {
  API_BLOB_TYPES,
  apiRequest,
  createDownloadUrl,
  revokeDownloadUrl,
} from "../lib/api/client";

export type ReportScope = "combined" | "early_year" | "primary" | "secondary";
export type ReportType = "monthly" | "annual";

export interface ReportQuery {
  academic_year_id: number;
  scope: ReportScope;
  month?: string;
  class_name?: string | null;
  subject_id?: number | null;
}

export interface ReportFiltersResponse {
  academic_years: Array<{ id: number; name: string; start_date: string; end_date: string; is_default: boolean }>;
  default_academic_year_id: number | null;
  months: Array<{ value: string; label: string }>;
  scopes: Array<{ value: ReportScope; label: string }>;
  classes: string[];
  subjects: Array<{ id: number; name: string; jenjang_id: number; jenjang_name: string }>;
}

export interface NamedCount { name: string; count: number; percentage: number | null }
export interface AttendanceSummary {
  present: number; sakit: number; izin: number; alfa: number; incomplete: number;
  late_days: number; late_minutes: number; attendance_rate: number | null; late_rate: number | null;
}
export interface ExecutiveReport {
  meta: { report_type: ReportType; scope: ReportScope; academic_year: { id: number; name: string }; period: { start: string; end: string }; generated_at: string };
  report_period: ReportPeriod;
  executive_summary: { total_students: number; male_students: number; female_students: number; attendance_rate: number | null; late_rate: number | null; late_minutes: number; below_kkm_count: number; data_completeness_rate: number | null };
  student_distribution: { by_level: NamedCount[]; by_class: NamedCount[]; by_gender: NamedCount[]; by_religion: NamedCount[]; by_domicile: NamedCount[] };
  attendance_summary: AttendanceSummary;
  attendance_by_level: Array<AttendanceSummary & { level: string }>;
  academic_summary: { availability: boolean; reason: string | null; sumatif_average: number | null; formatif_average: number | null; below_kkm_count: number; by_subject: Array<{ subject_id: number; subject_name: string; jenjang: string; sumatif_average: number | null; formatif_average: number | null; below_kkm_count: number }> };
  trends: Array<{ month: string; label: string; present: number; sakit: number; izin: number; alfa: number; incomplete: number; attendance_denominator: number; attendance_rate: number | null; late_days: number; late_minutes: number; late_rate: number | null; sumatif_average: number | null; formatif_average: number | null; below_kkm_count: number }>;
  comparisons?: Record<string, { name: string; attendance_rate: number; attendance_denominator: number } | null>;
  data_quality: { missing_gender: number; missing_religion: number; missing_domicile: number; incomplete_attendance: number; empty_grade_cells: number; unmapped_levels: string[]; warnings: string[] };
}

export interface ReportPeriod {
  selected_month: string;
  academic_year_id: number;
  academic_year_label: string;
  sections: Record<"attendance" | "population" | "academics", { basis: string; month_bound: boolean; label: string }>;
}

export interface ManagementReport {
  metadata: { report_type: "monthly_management"; title: string; scope: ReportScope; academic_year: { id: number; name: string }; generated_at: string; filters: { class_name: string | null; subject_id: number | null } };
  report_period: ReportPeriod;
  executive_summary: Record<string, number | null> & { total_students: number; total_classes: number; attendance_rate: number | null };
  student_population: { eligible_count: number; by_jenjang: Array<{ jenjang: string; student_count: number; percentage_of_eligible: number | null; class_count: number; classification: string }>; by_class: Array<{ jenjang: string; class_name: string; student_count: number; percentage_within_jenjang: number | null; percentage_of_eligible: number | null }> };
  attendance: { summary: AttendanceSummary; by_jenjang: Array<AttendanceSummary & { level: string }> };
  academic_summary: ExecutiveReport["academic_summary"];
  demographics: Record<"religion" | "gender" | "residential_area", { eligible_count: number; known_count: number; unknown_count: number; denominator_used: string; percentage_basis: string; rows: Array<{ name: string; count: number; percentage_of_known: number | null; percentage_of_eligible: number | null }> }>;
  data_quality: { reconciliation: Record<string, number>; sections: Record<string, { eligible_count: number; known_count: number; unknown_count: number; excluded_count: number; denominator_used: string; percentage_basis: string; exclusion_reasons: string[]; reconciliation_difference: number; reconciles: boolean }>; unmapped_levels: string[]; warnings: string[] };
}

export const reportsApiPath = (path: string) => `/api/reports${path}`;

const reportParams = (query: ReportQuery) => ({
  academic_year_id: query.academic_year_id,
  scope: query.scope,
  month: query.month,
  class_name: query.class_name || undefined,
  subject_id: query.subject_id || undefined,
});

export async function getReportFilters(params?: { academic_year_id?: number | null; scope?: ReportScope }) {
  return (await apiRequest<ReportFiltersResponse>({
    path: reportsApiPath("/filters"), method: "GET", params: {
      academic_year_id: params?.academic_year_id || undefined,
      scope: params?.scope,
    },
  })).data;
}

export async function getMonthlyReport(query: ReportQuery) {
  return (await apiRequest<ExecutiveReport>({ path: reportsApiPath("/monthly"), method: "GET", params: reportParams(query) })).data;
}

export async function getAnnualReport(query: ReportQuery) {
  const params = reportParams(query);
  delete params.month;
  return (await apiRequest<ExecutiveReport>({ path: reportsApiPath("/annual"), method: "GET", params })).data;
}

export async function getMonthlyManagementReport(query: ReportQuery) {
  return (await apiRequest<ManagementReport>({ path: reportsApiPath("/management/monthly"), method: "GET", params: reportParams(query) })).data;
}

async function exportReport(type: ReportType, format: "pdf" | "xlsx", query: ReportQuery) {
  const params = { ...reportParams(query), format };
  if (type === "annual") delete params.month;
  const response = await apiRequest<Blob>({
    path: reportsApiPath(`/${type}/export`), method: "GET", params,
    responseType: "blob", expectedBlobTypes: format === "pdf" ? API_BLOB_TYPES.pdf : API_BLOB_TYPES.excel,
  });
  const disposition = response.headers["content-disposition"] || "";
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `executive-report_${type}.${format}`;
  return { blob: response.data, filename };
}

export const exportMonthlyReport = (format: "pdf" | "xlsx", query: ReportQuery) => exportReport("monthly", format, query);
export const exportAnnualReport = (format: "pdf" | "xlsx", query: ReportQuery) => exportReport("annual", format, query);

export async function exportMonthlyManagementReport(format: "pdf" | "xlsx", query: ReportQuery) {
  const response = await apiRequest<Blob>({
    path: reportsApiPath("/management/monthly/export"), method: "GET", params: { ...reportParams(query), format },
    responseType: "blob", expectedBlobTypes: format === "pdf" ? API_BLOB_TYPES.pdf : API_BLOB_TYPES.excel,
  });
  const disposition = response.headers["content-disposition"] || "";
  return { blob: response.data, filename: disposition.match(/filename="?([^";]+)"?/i)?.[1] || `management-report_monthly.${format}` };
}

export function downloadReportBlob(blob: Blob, filename: string) {
  const url = createDownloadUrl(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  revokeDownloadUrl(url);
}
