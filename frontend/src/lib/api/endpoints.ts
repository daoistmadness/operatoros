import { API_BLOB_TYPES, apiRequest, type ApiResponse, type QueryParams } from './client';

type JsonObject = Record<string, unknown>;
type ReportQuery = QueryParams & {
  month?: number;
  year?: number;
  term?: number;
  date_from?: string;
  date_to?: string;
  jenjang?: string;
};
type RekapReport = JsonObject & {
  jenjang: unknown[];
  global_summary: JsonObject;
  global_flags: JsonObject;
  chart_data: unknown[];
  warning_flags: JsonObject;
  period: JsonObject;
};
type TardinessReport = JsonObject & {
  breakdown_by_jenjang: unknown[];
  summary_by_jenjang: unknown[];
  breakdown_by_class: unknown[];
  totals: JsonObject;
  management_summary: JsonObject;
  period: JsonObject;
};
type TardinessSummary = JsonObject & { rows: unknown[]; period: JsonObject };
type HebOverridePayload = { heb_value: number; note?: string; set_by?: string };
type StudentClassAssignmentPayload = { student_id: number | string; class_name: string; jenjang: string };
type AbsenceTotalRow = {
  total_sakit?: unknown;
  total_izin?: unknown;
  total_alfa?: unknown;
  classes_entered?: unknown;
  classes_total?: unknown;
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
    jenjang: ensureArray(report.jenjang),
    global_summary: ensureObject(report.global_summary || {}, 'Ringkasan tidak valid.'),
    global_flags: ensureObject(report.global_flags || {}, 'Flags tidak valid.'),
    chart_data: ensureArray(report.chart_data),
    warning_flags: ensureObject(report.warning_flags || {}, 'Penanda peringatan rekap absensi tidak valid.'),
    period: ensureObject(report.period || {}, 'Periode laporan rekap absensi tidak valid.'),
  };
}

function ensureTardinessReportShape(data: unknown): TardinessReport {
  const report = ensureObject(data, 'Format data laporan keterlambatan tidak valid.');
  return {
    ...report,
    breakdown_by_jenjang: ensureArray(report.breakdown_by_jenjang),
    summary_by_jenjang: ensureArray(report.summary_by_jenjang),
    breakdown_by_class: ensureArray(report.breakdown_by_class),
    totals: ensureObject(report.totals || {}, 'Ringkasan keterlambatan tidak valid.'),
    management_summary: ensureObject(report.management_summary || {}, 'Ringkasan manajemen keterlambatan tidak valid.'),
    period: ensureObject(report.period || {}, 'Periode laporan keterlambatan tidak valid.'),
  };
}

function ensureTardinessSummaryByJenjangShape(data: unknown): TardinessSummary {
  const payload = ensureObject(data, 'Format ringkasan keterlambatan per jenjang tidak valid.');
  return {
    ...payload,
    rows: ensureArray(payload.rows),
    period: ensureObject(payload.period || {}, 'Periode ringkasan keterlambatan tidak valid.'),
  };
}

export async function getRekapAbsensiReport(params: ReportQuery): Promise<RekapReport> {
  const response = await apiRequest({ path: '/api/analytics/v2/rekap-absensi', params });
  return ensureRekapReportShape(response.data);
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

export async function getJenjangs(): Promise<unknown[]> {
  const response = await apiRequest<unknown[]>({ path: '/api/analytics/jenjangs' });
  return ensureArray(response.data);
}

export async function getDashboardSnapshot(currentDate: Date) {
  const month = currentDate.getMonth() + 1;
  const year = currentDate.getFullYear();

  const requests = await Promise.allSettled([
    apiRequest({ path: '/api/analytics/monthly' }),
    apiRequest({ path: '/api/analytics/class-leaderboard' }),
    apiRequest({ path: '/api/analytics/frequent-offenders' }),
    apiRequest({ path: '/api/analytics/pending-categorization' }),
    apiRequest({ path: '/api/analytics/summary' }),
    apiRequest({ path: '/api/students/classes' }),
    apiRequest({ path: '/api/analytics/incomplete-summary' }),
    apiRequest({ path: '/api/config/absence-reasons/summary', params: { month, year } }),
    apiRequest({ path: '/api/analytics/v2/rekap-absensi', params: { month, year } }),
  ]);

  const [monthly, classes, freq, pend, summ, cls, incSumm, absenceSumm, rekapSumm] = requests;
  const pendingRows = pend.status === 'fulfilled' && Array.isArray(pend.value.data) ? pend.value.data : [];

  return {
    monthlyData: monthly.status === 'fulfilled' && Array.isArray(monthly.value.data) ? monthly.value.data : [],
    classData: classes.status === 'fulfilled' && Array.isArray(classes.value.data) ? classes.value.data : [],
    offenders: freq.status === 'fulfilled' && Array.isArray(freq.value.data) ? freq.value.data : [],
    pending: pendingRows,
    summary: summ.status === 'fulfilled' ? ensureObject(summ.value.data || {}, 'Ringkasan dashboard tidak valid.') : { total_late: 0, total_incomplete: 0, total_offenders: 0 },
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
