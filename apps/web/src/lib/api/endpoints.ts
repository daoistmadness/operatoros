import { API_BLOB_TYPES, apiRequest, type ApiResponse, type QueryParams } from './client';

type JsonObject = Record<string, unknown>;
export type ReportQuery = QueryParams & {
  month?: number;
  year?: number;
  term?: number;
  date_from?: string;
  date_to?: string;
  jenjang?: string;
};
export type AttendancePercentages = {
  hadir_pct?: number | null;
  sakit_pct?: number | null;
  izin_pct?: number | null;
  alfa_pct?: number | null;
  total_pct?: number | null;
};

export type RekapClassRow = {
  class_name: string;
  percentages: AttendancePercentages;
  warning_flags: {
    excluded_unclassified?: boolean;
    data_quality_issue?: boolean;
    lain2_count?: number;
  };
};

export type RekapJenjangRow = {
  name: string;
  summary: { percentages: AttendancePercentages };
  classes: RekapClassRow[];
};

export type RekapChartRow = {
  label: 'Hadir' | 'Sakit' | 'Izin' | 'Alfa' | string;
  value: number;
};

export type RekapReport = JsonObject & {
  report_title: string;
  school_name: string;
  jenjang: RekapJenjangRow[];
  global_summary: JsonObject & { percentages?: AttendancePercentages };
  global_flags: JsonObject & {
    heb_missing?: boolean;
    sia_missing?: boolean;
    has_data_quality_issue?: boolean;
    affected_classes?: number;
  };
  chart_data: RekapChartRow[];
  warning_flags: JsonObject;
  period: JsonObject & { label?: string };
  heb_by_jenjang?: Record<string, number | null>;
};
export type TardinessClassRow = {
  jenjang: string;
  class_name: string;
  total_late_duration_str: string;
  late_duration_pct: number;
  total_days_late: number;
  days_late_pct: number;
  late_student_count: number;
  sakit?: number | null;
  izin?: number | null;
  alfa?: number | null;
  total_absence_reasons?: number | null;
};
export type TardinessJenjangSummaryRow = {
  jenjang: string;
  total_kejadian: number;
  percentage_of_total: number;
  hari_efektif_terlambat: number;
  rata_rata_siswa_terlambat_per_hari: number;
};
export type TardinessTotals = {
  total_late_duration_str: string;
  total_days_late: number;
  total_late_incidents: number;
  unique_late_days: number;
  tracked_school_days: number;
  school_impact_rate_pct: number;
  average_lateness_density: number;
  total_students_ever_late: number;
};
export type TardinessManagementSummary = Pick<
  TardinessTotals,
  'total_late_incidents' | 'unique_late_days' | 'tracked_school_days' | 'school_impact_rate_pct' | 'average_lateness_density'
>;
export type TardinessReport = JsonObject & {
  report_title: string;
  school_name: string;
  breakdown_by_jenjang: TardinessJenjangSummaryRow[];
  summary_by_jenjang: TardinessJenjangSummaryRow[];
  breakdown_by_class: TardinessClassRow[];
  totals: TardinessTotals;
  management_summary: TardinessManagementSummary;
  period: JsonObject & { label?: string };
  heb_by_jenjang?: Record<string, number | null>;
};
export type TardinessSummary = JsonObject & {
  rows: TardinessJenjangSummaryRow[];
  period: JsonObject & { label?: string };
};
type HebOverridePayload = { heb_value: number; note?: string; set_by?: string };
type StudentClassAssignmentPayload = { student_id: number | string; class_name: string; jenjang: string };
export type AbsenceTotalRow = {
  total_sakit?: unknown;
  total_izin?: unknown;
  total_alfa?: unknown;
  classes_entered?: unknown;
  classes_total?: unknown;
};

export type DashboardMonthlyRow = {
  month: string;
  late_count: number;
};

export type DashboardClassRow = {
  class_name: string;
  punctuality_score: number;
};

export type DashboardOffender = {
  name: string;
  class_name?: string | null;
  late_count: number;
};

export type DashboardPendingStudent = {
  id: number | string;
  name: string;
};

export type DashboardSummary = {
  total_late: number;
  total_incomplete: number;
  total_offenders: number;
};

export type DashboardIncompleteSummary = {
  total_incomplete?: number;
};

export type DashboardSnapshot = {
  monthlyData: DashboardMonthlyRow[];
  classData: DashboardClassRow[];
  offenders: DashboardOffender[];
  pending: DashboardPendingStudent[];
  summary: DashboardSummary;
  existingClasses: string[];
  incompleteSummary: DashboardIncompleteSummary | null;
  absenceSummary: AbsenceTotalRow[];
  rekapAbsensiSummary: RekapReport | null;
  mappingWarning: string;
};

function ensureObject(value: unknown, message: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as JsonObject;
}

function ensureArray<T = unknown>(value: unknown, fallback: T[] = []): T[] {
  return Array.isArray(value) ? value as T[] : fallback;
}

function ensureNumber(value: unknown, fallback = 0): number {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function ensureRekapReportShape(data: unknown): RekapReport {
  const report = ensureObject(data, 'Format data rekap absensi tidak valid.');
  return {
    ...report,
    jenjang: ensureArray<RekapJenjangRow>(report.jenjang),
    global_summary: ensureObject(report.global_summary || {}, 'Ringkasan tidak valid.') as RekapReport['global_summary'],
    global_flags: ensureObject(report.global_flags || {}, 'Flags tidak valid.') as RekapReport['global_flags'],
    chart_data: ensureArray<RekapChartRow>(report.chart_data),
    warning_flags: ensureObject(report.warning_flags || {}, 'Penanda peringatan rekap absensi tidak valid.'),
    period: ensureObject(report.period || {}, 'Periode laporan rekap absensi tidak valid.') as RekapReport['period'],
  } as RekapReport;
}

function ensureTardinessReportShape(data: unknown): TardinessReport {
  const report = ensureObject(data, 'Format data laporan keterlambatan tidak valid.');
  return {
    ...report,
    breakdown_by_jenjang: ensureArray<TardinessJenjangSummaryRow>(report.breakdown_by_jenjang),
    summary_by_jenjang: ensureArray<TardinessJenjangSummaryRow>(report.summary_by_jenjang),
    breakdown_by_class: ensureArray<TardinessClassRow>(report.breakdown_by_class),
    totals: ensureObject(report.totals || {}, 'Ringkasan keterlambatan tidak valid.') as TardinessTotals,
    management_summary: ensureObject(report.management_summary || {}, 'Ringkasan manajemen keterlambatan tidak valid.') as TardinessManagementSummary,
    period: ensureObject(report.period || {}, 'Periode laporan keterlambatan tidak valid.') as TardinessReport['period'],
  } as TardinessReport;
}

function ensureTardinessSummaryByJenjangShape(data: unknown): TardinessSummary {
  const payload = ensureObject(data, 'Format ringkasan keterlambatan per jenjang tidak valid.');
  return {
    ...payload,
    rows: ensureArray<TardinessJenjangSummaryRow>(payload.rows),
    period: ensureObject(payload.period || {}, 'Periode ringkasan keterlambatan tidak valid.') as TardinessSummary['period'],
  };
}

export async function getRekapAbsensiReport(params: ReportQuery): Promise<RekapReport> {
  const response = await apiRequest({ path: '/api/analytics/v2/rekap-absensi', params });
  return ensureRekapReportShape(response.data);
}

export async function downloadStudentAttendanceHistoryExcel(params: { studentMasterId: string; month?: number; year?: number }): Promise<Blob> {
  const response = await apiRequest({
    path: `/api/student-masters/${params.studentMasterId}/attendance-history/export-excel`,
    params: { month: params.month, year: params.year },
    responseType: 'blob',
    timeout: 60000,
    expectedBlobTypes: API_BLOB_TYPES.excel,
  });
  return response.data;
}

export async function downloadRekapAbsensiExcel(params: ReportQuery): Promise<Blob> {
  const response = await apiRequest({
    path: '/api/analytics/v2/rekap-absensi/export-excel',
    params,
    responseType: 'blob',
    timeout: 60000,
    expectedBlobTypes: API_BLOB_TYPES.excel,
  });
  return response.data;
}

export async function getTardinessReport(params: ReportQuery): Promise<TardinessReport> {
  const response = await apiRequest({ path: '/api/analytics/tardiness-report', params });
  return ensureTardinessReportShape(response.data);
}

export async function getTardinessSummaryByJenjang(params: ReportQuery): Promise<TardinessSummary> {
  const response = await apiRequest({ path: '/api/analytics/tardiness-report/summary-by-jenjang', params });
  return ensureTardinessSummaryByJenjangShape(response.data);
}

export async function downloadTardinessExcel(params: ReportQuery): Promise<Blob> {
  const response = await apiRequest({
    path: '/api/analytics/tardiness-report/export-excel',
    params,
    responseType: 'blob',
    timeout: 60000,
    expectedBlobTypes: API_BLOB_TYPES.excel,
  });
  return response.data;
}

export async function downloadTardinessManagementExcel(params: ReportQuery): Promise<Blob> {
  const response = await apiRequest({
    path: '/api/analytics/tardiness-report/export-management-excel',
    params,
    responseType: 'blob',
    timeout: 60000,
    expectedBlobTypes: API_BLOB_TYPES.excel,
  });
  return response.data;
}

export async function getServerStatus(): Promise<'online'> {
  await apiRequest({ path: '/api/system/health' });
  return 'online';
}

export async function getSystemHealth(): Promise<JsonObject> {
  const response = await apiRequest<JsonObject>({ path: '/api/system/health' });
  return response.data;
}

export async function getJenjangs(): Promise<string[]> {
  const response = await apiRequest<string[]>({ path: '/api/analytics/jenjangs' });
  return ensureArray<string>(response.data);
}

export async function getDashboardSnapshot(currentDate: Date): Promise<DashboardSnapshot> {
  const month = currentDate.getMonth() + 1;
  const year = currentDate.getFullYear();

  const requests = await Promise.allSettled([
    apiRequest<DashboardMonthlyRow[]>({ path: '/api/analytics/monthly' }),
    apiRequest<DashboardClassRow[]>({ path: '/api/analytics/class-leaderboard' }),
    apiRequest<DashboardOffender[]>({ path: '/api/analytics/frequent-offenders' }),
    apiRequest<DashboardPendingStudent[]>({ path: '/api/analytics/pending-categorization' }),
    apiRequest<DashboardSummary>({ path: '/api/analytics/summary' }),
    apiRequest<string[]>({ path: '/api/students/classes' }),
    apiRequest<DashboardIncompleteSummary>({ path: '/api/analytics/incomplete-summary' }),
    apiRequest<AbsenceTotalRow[]>({ path: '/api/config/absence-reasons/summary', params: { month, year } }),
    apiRequest({ path: '/api/analytics/v2/rekap-absensi', params: { month, year } }),
  ]);

  const [monthly, classes, freq, pend, summ, cls, incSumm, absenceSumm, rekapSumm] = requests;
  const pendingRows = pend.status === 'fulfilled' && Array.isArray(pend.value.data) ? pend.value.data : [];

  return {
    monthlyData: monthly.status === 'fulfilled' && Array.isArray(monthly.value.data) ? monthly.value.data : [],
    classData: classes.status === 'fulfilled' && Array.isArray(classes.value.data) ? classes.value.data : [],
    offenders: freq.status === 'fulfilled' && Array.isArray(freq.value.data) ? freq.value.data : [],
    pending: pendingRows,
    summary: summ.status === 'fulfilled' ? summ.value.data : { total_late: 0, total_incomplete: 0, total_offenders: 0 },
    existingClasses: cls.status === 'fulfilled' && Array.isArray(cls.value.data) ? cls.value.data : [],
    incompleteSummary: incSumm.status === 'fulfilled' ? incSumm.value.data : null,
    absenceSummary: absenceSumm.status === 'fulfilled' && Array.isArray(absenceSumm.value.data) ? absenceSumm.value.data : [],
    rekapAbsensiSummary: rekapSumm.status === 'fulfilled' ? ensureRekapReportShape(rekapSumm.value.data) : null,
    mappingWarning:
      pendingRows.length > 0
        ? `${pendingRows.length} students have no class assigned. Some charts may be incomplete.`
        : '',
  };
}

export async function getHebOverview(month: number, year: number): Promise<unknown[]> {
  const response = await apiRequest<JsonObject>({ path: '/api/analytics/heb', params: { month, year } });
  return ensureArray(response.data.heb_by_jenjang);
}

export async function saveHebOverride(
  jenjang: string,
  year: number,
  month: number,
  payload: HebOverridePayload,
): Promise<ApiResponse<unknown>> {
  return apiRequest({
    path: `/api/config/heb/${encodeURIComponent(jenjang)}/${year}/${month}`,
    method: 'PUT',
    body: payload,
  });
}

export async function deleteHebOverride(
  jenjang: string,
  year: number,
  month: number,
): Promise<ApiResponse<unknown>> {
  return apiRequest({
    path: `/api/config/heb/${encodeURIComponent(jenjang)}/${year}/${month}`,
    method: 'DELETE',
  });
}

export async function assignStudentClass(
  payload: StudentClassAssignmentPayload,
): Promise<ApiResponse<unknown>> {
  return apiRequest({
    path: '/api/students/set-class',
    method: 'POST',
    body: payload,
  });
}

export function normalizeAbsenceTotals(rows: unknown) {
  return ensureArray<AbsenceTotalRow>(rows).reduce(
    (acc, row) => {
      acc.sakit += ensureNumber(row.total_sakit);
      acc.izin += ensureNumber(row.total_izin);
      acc.alfa += ensureNumber(row.total_alfa);
      acc.entered += ensureNumber(row.classes_entered);
      acc.total += ensureNumber(row.classes_total);
      return acc;
    },
    { sakit: 0, izin: 0, alfa: 0, entered: 0, total: 0 }
  );
}
