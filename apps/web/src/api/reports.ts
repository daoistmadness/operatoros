import {
  API_BLOB_TYPES,
  apiRequest,
  createDownloadUrl,
  revokeDownloadUrl,
} from "../lib/api/client";
import type { MonthlyReportResponse, ReportFiltersResponse, ReportQuery, ReportScope } from "@operatoros/contracts/reports";

export type ReportType = "monthly" | "annual";
export type { ReportFiltersResponse, ReportQuery, ReportScope } from "@operatoros/contracts/reports";

export interface NamedCount { name: string; count: number; percentage: number | null }
export type { MonthlyReportResponse };
export interface AnnualAttendanceSummary {
  present: number; sakit: number; izin: number; alfa: number; incomplete: number;
  late_days: number | null; late_minutes: number | null; attendance_rate: number | null; coverage_rate: number | null;
  expected_student_days: number; recorded_student_days: number; unrecorded_student_days: number;
  late_event_rate: number | null; late_among_present: number | null;
  lateness_availability: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE"; lateness_coverage_rate: number | null;
  late_unknown_duration_events: number | null;
  basis_counts: { observed: number; declared: number; not_reported: number }; conflict_count: number;
}
export interface AnnualAttendanceLevel {
  level: string; present: number; sakit: number; izin: number; alfa: number; incomplete: number;
  attendance_denominator: number; attendance_rate: number | null; recorded_student_days: number;
  unrecorded_student_days: number; coverage_rate: number | null;
  observed_class_months: number; declared_class_months: number; not_reported_class_months: number;
  late_events: number | null; late_event_rate: number | null;
  lateness_availability: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE"; lateness_coverage_rate: number | null;
  late_minutes: number | null; unknown_duration_events: number | null; conflict_count: number;
}
export interface AnnualTrend {
  month: string; label: string; present: number; sakit: number; izin: number; alfa: number; incomplete: number;
  attendance_denominator: number; attendance_rate: number | null; recorded_student_days: number;
  unrecorded_student_days: number; coverage_rate: number | null;
  basis_counts: { observed: number; declared: number; not_reported: number }; conflict_count: number;
  late_days: number | null; late_event_rate: number | null; lateness_availability: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  lateness_coverage_rate: number | null; late_minutes: number | null; unknown_duration_events: number | null;
  late_rate: number | null; sumatif_average: number | null; formatif_average: number | null; below_kkm_count: number;
}
export interface ExecutiveReport {
  meta: { report_type: ReportType; scope: ReportScope; academic_year: { id: number; name: string }; period: { start: string; end: string }; generated_at: string };
  report_period: ReportPeriod;
  executive_summary: { total_students: number; attendance_rate: number | null; late_rate: number | null; late_event_rate: number | null; late_minutes: number | null; below_kkm_count: number; data_completeness_rate: number | null };
  student_distribution: { by_level: NamedCount[]; by_class: NamedCount[]; by_gender: NamedCount[]; by_religion: NamedCount[]; by_domicile: NamedCount[] };
  attendance_summary: AnnualAttendanceSummary;
  attendance_by_level: AnnualAttendanceLevel[];
  academic_summary: { availability: boolean; reason: string | null; sumatif_average: number | null; formatif_average: number | null; below_kkm_count: number; by_subject: Array<{ subject_id: number; subject_name: string; jenjang: string; sumatif_average: number | null; formatif_average: number | null; below_kkm_count: number }> };
  trends: AnnualTrend[];
  comparisons?: Record<string, { name: string; attendance_rate: number | null; attendance_denominator: number | null } | null>;
  data_quality: { not_reported_class_months: number; partial_observed_class_months: number; unresolved_conflicts: number; empty_grade_cells: number; unmapped_levels: string[]; warnings: string[] };
}

export interface ReportPeriod {
  selected_month: string;
  academic_year_id: number;
  academic_year_label: string;
  sections: Record<"attendance" | "population" | "academics", { basis: string; month_bound: boolean; label: string }>;
}

export const reportsApiPath = (path: string) => `/api/reports${path}`;

const reportParams = (query: ReportQuery) => ({
  academic_year_id: query.academic_year_id,
  scope: query.scope,
  month: query.month,
  class_id: query.class_id || undefined,
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
  return (await apiRequest<MonthlyReportResponse>({ path: reportsApiPath("/monthly"), method: "GET", params: reportParams(query) })).data;
}

export async function getAnnualReport(query: ReportQuery) {
  const params = reportParams(query);
  delete params.month;
  return (await apiRequest<ExecutiveReport>({ path: reportsApiPath("/annual"), method: "GET", params })).data;
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

export function downloadReportBlob(blob: Blob, filename: string) {
  const url = createDownloadUrl(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => revokeDownloadUrl(url), 100);
}
