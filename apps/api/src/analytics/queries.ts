import type {
  AnalyticsCohort,
  AnalyticsCohortsResponse,
  AnalyticsFilterResult,
  AnalyticsMetricDefinition,
  AnalyticsMetricValue,
  AnalyticsOverviewResponse,
  AnalyticsSummary,
  AnalyticsTrendPoint,
  AnalyticsTrendsResponse,
} from "@operatoros/contracts/analytics";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;

export interface AnalyticsQuery {
  academic_year_id: number;
  start_date?: string;
  end_date?: string;
  jenjang_id?: number;
  class_name?: string;
  subject_id?: number;
}

const METRIC_DEFINITIONS: AnalyticsMetricDefinition[] = [
  {
    id: "attendance_rate",
    label: "Attendance rate",
    unit: "percent",
    numerator: "present attendance records plus late attendance records",
    denominator: "present, sick, excused, and unexplained absence records",
    rounding: "round half even to one decimal place",
    missing_data: "null when the denominator is zero",
  },
  {
    id: "grade_average",
    label: "Grade average",
    unit: "score",
    numerator: "non-null grade score total",
    denominator: "non-null grade score count",
    rounding: "round half even to one decimal place",
    missing_data: "null when no score exists",
  },
];

function rows(context: AuthContext, sql: string, params: any[] = []): Row[] {
  return context.database.client.query(sql).all(...params) as Row[];
}

function row(context: AuthContext, sql: string, params: any[] = []): Row | null {
  return (context.database.client.query(sql).get(...params) as Row | null) ?? null;
}

function fail(code: string, status: number): never {
  throw Object.assign(new Error(code), { status });
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function roundHalfEven(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  const scaled = Math.abs(value) * factor;
  const lower = Math.floor(scaled);
  const fraction = scaled - lower;
  const epsilon = 1e-9;
  let rounded = lower;
  if (fraction > 0.5 + epsilon || Math.abs(fraction - 0.5) <= epsilon && lower % 2 === 1) rounded++;
  return (value < 0 ? -1 : 1) * rounded / factor;
}

function metricValue(
  numerator: number,
  denominator: number,
  unit: AnalyticsMetricValue["unit"],
  value: number | null = null,
): AnalyticsMetricValue {
  if (denominator === 0) return { value: null, numerator, denominator, unit, status: "unavailable" };
  const calculated = value ?? numerator / denominator;
  const rounded = unit === "percent" ? roundHalfEven(calculated * 100, 1) : roundHalfEven(calculated, 1);
  return { value: rounded, numerator, denominator, unit, status: rounded === 0 ? "zero" : "value" };
}

function queryRange(context: AuthContext, query: AnalyticsQuery): { year: Row; startDate: string; endDate: string } {
  const year = row(context, "SELECT id, label, start_date, end_date FROM academic_years WHERE id = ?", [query.academic_year_id]);
  if (!year) fail("Academic year not found", 404);
  const startDate = query.start_date ?? String(year.start_date);
  const endDate = query.end_date ?? String(year.end_date);
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) fail("The analytics date range is invalid", 422);
  if (startDate < String(year.start_date) || endDate > String(year.end_date)) fail("The analytics date range is outside the academic year", 422);
  return { year, startDate, endDate };
}

function filterContext(context: AuthContext, query: AnalyticsQuery): { filters: AnalyticsFilterResult; where: string[]; params: unknown[] } {
  const range = queryRange(context, query);
  const jenjang = query.jenjang_id === undefined ? null : row(context, "SELECT id FROM jenjangs WHERE id = ?", [query.jenjang_id]);
  if (query.jenjang_id !== undefined && !jenjang) fail("Jenjang not found", 404);
  const subject = query.subject_id === undefined ? null : row(context, "SELECT id FROM subjects WHERE id = ?", [query.subject_id]);
  if (query.subject_id !== undefined && !subject) fail("Subject not found", 404);
  const where = ["e.academic_year_id = ?"];
  const params: any[] = [query.academic_year_id];
  if (query.jenjang_id !== undefined) { where.push("e.jenjang_id = ?"); params.push(query.jenjang_id); }
  if (query.class_name) { where.push("COALESCE(c.class_name, e.class_name, s.class_name) = ?"); params.push(query.class_name.trim()); }
  return {
    filters: {
      academic_year_id: Number(range.year.id),
      academic_year_label: String(range.year.label),
      start_date: range.startDate,
      end_date: range.endDate,
      jenjang_id: query.jenjang_id ?? null,
      class_name: query.class_name?.trim() || null,
      subject_id: query.subject_id ?? null,
    },
    where,
    params,
  };
}

function absenceTotals(context: AuthContext, query: AnalyticsQuery, where: string[], params: unknown[], startDate: string, endDate: string): Row {
  const absenceWhere = where.filter((value) => value !== "e.academic_year_id = ?");
  const start = Number(startDate.slice(0, 4)) * 100 + Number(startDate.slice(5, 7));
  const end = Number(endDate.slice(0, 4)) * 100 + Number(endDate.slice(5, 7));
  return row(context, `SELECT COALESCE(SUM(ar.sakit), 0) AS sakit, COALESCE(SUM(ar.izin), 0) AS izin, COALESCE(SUM(ar.alfa), 0) AS alfa
    FROM absence_reasons ar
    JOIN students s ON s.id = ar.student_id
    JOIN student_enrollments e ON e.student_id = ar.student_id AND e.academic_year_id = ?
    LEFT JOIN academic_classes c ON c.id = e.academic_class_id
    WHERE (ar.year * 100 + ar.month) BETWEEN ? AND ? AND ${absenceWhere.join(" AND ") || "1 = 1"}`,
    [query.academic_year_id, start, end, ...params.slice(1)]) ?? { sakit: 0, izin: 0, alfa: 0 };
}

function aggregateAttendance(context: AuthContext, query: AnalyticsQuery, where: string[], params: unknown[], startDate: string, endDate: string): Row {
  return row(context, `SELECT
      COALESCE(SUM(CASE WHEN a.id IS NOT NULL AND COALESCE(o.override_status, a.status) IN ('on-time', 'late') THEN 1 ELSE 0 END), 0) AS present,
      COALESCE(SUM(CASE WHEN a.id IS NOT NULL AND COALESCE(o.override_status, a.status) = 'late' THEN 1 ELSE 0 END), 0) AS late
    FROM student_enrollments e
    JOIN students s ON s.id = e.student_id
    LEFT JOIN academic_classes c ON c.id = e.academic_class_id
    LEFT JOIN attendance a ON a.student_id = e.student_id AND a.date >= ? AND a.date <= ?
    LEFT JOIN attendance_overrides o ON o.attendance_id = a.id
    WHERE ${where.join(" AND ")}`,
    [startDate, endDate, ...params]) ?? { present: 0, late: 0 };
}

function aggregateGrades(context: AuthContext, query: AnalyticsQuery, where: string[], params: unknown[]): Row {
  const gradeWhere = [...where, "g.score IS NOT NULL"];
  if (query.subject_id !== undefined) { gradeWhere.push("g.subject_id = ?"); params = [...params, query.subject_id]; }
  return row(context, `SELECT COALESCE(SUM(g.score), 0) AS score_sum, COUNT(g.score) AS score_count
    FROM student_enrollments e
    JOIN students s ON s.id = e.student_id
    LEFT JOIN academic_classes c ON c.id = e.academic_class_id
    JOIN student_subject_grades g ON g.enrollment_id = e.id
    WHERE ${gradeWhere.join(" AND ")}`, params) ?? { score_sum: 0, score_count: 0 };
}

function cohortData(context: AuthContext, query: AnalyticsQuery, dimension: "class" | "jenjang", range: { startDate: string; endDate: string }, where: string[], params: unknown[]): AnalyticsCohort[] {
  const classLabel = "COALESCE(c.class_name, e.class_name, s.class_name)";
  const group = dimension === "class" ? `${classLabel}, e.academic_class_id, j.id, j.name` : "j.id, j.name";
  const select = dimension === "class"
    ? `${classLabel} AS label, e.academic_class_id AS cohort_id, j.id AS jenjang_id`
    : "j.name AS label, j.id AS cohort_id, j.id AS jenjang_id";
  const attendanceRows = rows(context, `SELECT ${select}, COUNT(DISTINCT e.student_id) AS student_count,
      COALESCE(SUM(CASE WHEN a.id IS NOT NULL AND COALESCE(o.override_status, a.status) IN ('on-time', 'late') THEN 1 ELSE 0 END), 0) AS present,
      COALESCE(SUM(CASE WHEN a.id IS NOT NULL AND COALESCE(o.override_status, a.status) = 'late' THEN 1 ELSE 0 END), 0) AS late
    FROM student_enrollments e
    JOIN students s ON s.id = e.student_id
    JOIN jenjangs j ON j.id = e.jenjang_id
    LEFT JOIN academic_classes c ON c.id = e.academic_class_id
    LEFT JOIN attendance a ON a.student_id = e.student_id AND a.date >= ? AND a.date <= ?
    LEFT JOIN attendance_overrides o ON o.attendance_id = a.id
    WHERE ${where.join(" AND ")}
    GROUP BY ${group}
    ORDER BY label`, [range.startDate, range.endDate, ...params]);
  const absenceWhere = where.filter((value) => value !== "e.academic_year_id = ?");
  const start = Number(range.startDate.slice(0, 4)) * 100 + Number(range.startDate.slice(5, 7));
  const end = Number(range.endDate.slice(0, 4)) * 100 + Number(range.endDate.slice(5, 7));
  const absenceRows = rows(context, `SELECT ${select}, COALESCE(SUM(ar.sakit), 0) AS sakit, COALESCE(SUM(ar.izin), 0) AS izin, COALESCE(SUM(ar.alfa), 0) AS alfa
    FROM absence_reasons ar
    JOIN student_enrollments e ON e.student_id = ar.student_id AND e.academic_year_id = ?
    JOIN students s ON s.id = e.student_id
    JOIN jenjangs j ON j.id = e.jenjang_id
    LEFT JOIN academic_classes c ON c.id = e.academic_class_id
    WHERE (ar.year * 100 + ar.month) BETWEEN ? AND ?${absenceWhere.length ? ` AND ${absenceWhere.join(" AND ")}` : ""}
    GROUP BY ${group}`, [query.academic_year_id, start, end, ...params.slice(1)]);
  const gradeWhere = [...where, "g.score IS NOT NULL"];
  if (query.subject_id !== undefined) gradeWhere.push("g.subject_id = ?");
  const gradeRows = rows(context, `SELECT ${select}, COALESCE(SUM(g.score), 0) AS score_sum, COUNT(g.score) AS score_count
    FROM student_enrollments e
    JOIN students s ON s.id = e.student_id
    JOIN jenjangs j ON j.id = e.jenjang_id
    LEFT JOIN academic_classes c ON c.id = e.academic_class_id
    JOIN student_subject_grades g ON g.enrollment_id = e.id
    WHERE ${gradeWhere.join(" AND ")}
    GROUP BY ${group}`, [...params, ...(query.subject_id === undefined ? [] : [query.subject_id])]);
  const key = (value: Row) => dimension === "class" ? `${value.jenjang_id}|${value.label ?? ""}` : String(value.cohort_id);
  const absenceByKey = new Map(absenceRows.map((value) => [key(value), value]));
  const gradeByKey = new Map(gradeRows.map((value) => [key(value), value]));
  return attendanceRows.map((value) => {
    const absence = absenceByKey.get(key(value)) ?? {};
    const grade = gradeByKey.get(key(value)) ?? {};
    const present = Number(value.present ?? 0);
    const sakit = Number(absence.sakit ?? 0);
    const izin = Number(absence.izin ?? 0);
    const alfa = Number(absence.alfa ?? 0);
    const attendanceDenominator = present + sakit + izin + alfa;
    const scoreCount = Number(grade.score_count ?? 0);
    return {
      dimension,
      id: dimension === "class" ? (value.cohort_id === null ? null : Number(value.cohort_id)) : Number(value.cohort_id),
      label: String(value.label || "Unknown"),
      student_count: Number(value.student_count ?? 0),
      attendance_rate: metricValue(present, attendanceDenominator, "percent"),
      grade_average: metricValue(Number(grade.score_sum ?? 0), scoreCount, "score"),
    };
  });
}

function baseData(context: AuthContext, query: AnalyticsQuery): { filters: AnalyticsFilterResult; summary: AnalyticsSummary; range: { startDate: string; endDate: string } } {
  const range = queryRange(context, query);
  const { filters, where, params } = filterContext(context, query);
  const attendance = aggregateAttendance(context, query, where, params, range.startDate, range.endDate);
  const absence = absenceTotals(context, query, where, params, range.startDate, range.endDate);
  const present = Number(attendance.present ?? 0);
  const sakit = Number(absence.sakit ?? 0);
  const izin = Number(absence.izin ?? 0);
  const alfa = Number(absence.alfa ?? 0);
  const grade = aggregateGrades(context, query, where, params);
  const studentCount = row(context, `SELECT COUNT(DISTINCT e.student_id) AS count FROM student_enrollments e JOIN students s ON s.id = e.student_id LEFT JOIN academic_classes c ON c.id = e.academic_class_id WHERE ${where.join(" AND ")}`, params);
  const attendanceDenominator = present + sakit + izin + alfa;
  return {
    filters,
    range: { startDate: range.startDate, endDate: range.endDate },
    summary: {
      student_count: Number(studentCount?.count ?? 0),
      attendance_counts: { present, sakit, izin, alfa, late: Number(attendance.late ?? 0) },
      attendance_rate: metricValue(present, attendanceDenominator, "percent"),
      grade_average: metricValue(Number(grade.score_sum ?? 0), Number(grade.score_count ?? 0), "score"),
    },
  };
}

export function analyticsOverview(context: AuthContext, query: AnalyticsQuery): AnalyticsOverviewResponse {
  const data = baseData(context, query);
  const scoped = filterContext(context, query);
  return {
    contract_version: "analytics.v1",
    filters: data.filters,
    metric_definitions: METRIC_DEFINITIONS,
    summary: data.summary,
    cohorts: [
      ...cohortData(context, query, "jenjang", data.range, scoped.where, scoped.params),
      ...cohortData(context, query, "class", data.range, scoped.where, scoped.params),
    ],
  };
}

function monthStarts(startDate: string, endDate: string): string[] {
  const result: string[] = [];
  const start = new Date(`${startDate.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${endDate.slice(0, 7)}-01T00:00:00Z`);
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) result.push(cursor.toISOString().slice(0, 7));
  return result;
}

export function analyticsTrends(context: AuthContext, query: AnalyticsQuery): AnalyticsTrendsResponse {
  const data = baseData(context, query);
  const scoped = filterContext(context, query);
  const months = monthStarts(data.range.startDate, data.range.endDate);
  const attendanceWhere = [...scoped.where, "a.date >= ?", "a.date <= ?"];
  const attendanceRows = rows(context, `SELECT strftime('%Y-%m', a.date) AS period,
      COALESCE(SUM(CASE WHEN COALESCE(o.override_status, a.status) IN ('on-time', 'late') THEN 1 ELSE 0 END), 0) AS present
    FROM attendance a
    JOIN student_enrollments e ON e.student_id = a.student_id AND e.academic_year_id = ?
    JOIN students s ON s.id = e.student_id
    LEFT JOIN academic_classes c ON c.id = e.academic_class_id
    LEFT JOIN attendance_overrides o ON o.attendance_id = a.id
    WHERE ${attendanceWhere.join(" AND ")}
    GROUP BY period`, [query.academic_year_id, ...scoped.params, data.range.startDate, data.range.endDate]);
  const absenceRows = rows(context, `SELECT printf('%04d-%02d', ar.year, ar.month) AS period,
      COALESCE(SUM(ar.sakit), 0) AS sakit, COALESCE(SUM(ar.izin), 0) AS izin, COALESCE(SUM(ar.alfa), 0) AS alfa
    FROM absence_reasons ar
    JOIN student_enrollments e ON e.student_id = ar.student_id AND e.academic_year_id = ?
    JOIN students s ON s.id = e.student_id
    LEFT JOIN academic_classes c ON c.id = e.academic_class_id
    WHERE (ar.year * 100 + ar.month) BETWEEN ? AND ?${scoped.where.length > 1 ? ` AND ${scoped.where.slice(1).join(" AND ")}` : ""}
    GROUP BY period`, [query.academic_year_id, Number(data.range.startDate.slice(0, 7).replace("-", "")), Number(data.range.endDate.slice(0, 7).replace("-", "")), ...scoped.params.slice(1)]);
  const attendanceByMonth = new Map(attendanceRows.map((value) => [String(value.period), value]));
  const absenceByMonth = new Map(absenceRows.map((value) => [String(value.period), value]));
  const points: AnalyticsTrendPoint[] = months.map((period) => {
    const attendance = attendanceByMonth.get(period) ?? {};
    const absence = absenceByMonth.get(period) ?? {};
    const present = Number(attendance.present ?? 0);
    const sakit = Number(absence.sakit ?? 0);
    const izin = Number(absence.izin ?? 0);
    const alfa = Number(absence.alfa ?? 0);
    const denominator = present + sakit + izin + alfa;
    const end = new Date(`${period}-01T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    const monthStart = period === data.range.startDate.slice(0, 7) ? data.range.startDate : `${period}-01`;
    const monthEnd = period === data.range.endDate.slice(0, 7) ? data.range.endDate : end.toISOString().slice(0, 10);
    return { period, start_date: monthStart, end_date: monthEnd, metric: metricValue(present, denominator, "percent") };
  });
  return { contract_version: "analytics.v1", filters: data.filters, metric_definitions: METRIC_DEFINITIONS, series: [{ metric_id: "attendance_rate", time_grain: "month", points }] };
}

export function analyticsCohorts(context: AuthContext, query: AnalyticsQuery, dimension: "class" | "jenjang"): AnalyticsCohortsResponse {
  const data = baseData(context, query);
  const scoped = filterContext(context, query);
  return { contract_version: "analytics.v1", filters: data.filters, metric_definitions: METRIC_DEFINITIONS, dimension, cohorts: cohortData(context, query, dimension, data.range, scoped.where, scoped.params) };
}
