import { StudentTrendInsightsResponseSchema, StudentTrendQuerySchema, type StudentTrendInsightsResponse, type StudentTrendMetric, type StudentTrendWindow } from "@operatoros/contracts/analytics";
import { capabilitiesForRole } from "../auth/capabilities";
import { actor } from "./core";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;
type WindowKind = "rolling_4w" | "term";

export interface StudentTrendScope {
  academicYearId: number;
  academicYearLabel: string;
  yearStart: string;
  yearEnd: string;
  jenjangId: number | null;
  classId: number | null;
}

export interface StudentTrendDateWindow {
  currentStart: string;
  currentEnd: string;
  previousStart: string | null;
  previousEnd: string | null;
  anchorDate: string;
}

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function row(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

function id(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateAdd(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateDays(start: string | null, end: string | null): number {
  if (!start || !end || start > end) return 0;
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

function roundPercent(value: number): number {
  return Number(value.toFixed(2));
}

export function buildStudentTrendScope(context: AuthContext, query: Row): StudentTrendScope {
  const academicYearId = id(query.academic_year_id);
  if (academicYearId === null) fail(400, "academic_year_id is invalid.");
  const year = row(context, "SELECT id, label, start_date, end_date FROM academic_years WHERE id = ?", [academicYearId]);
  if (!year) fail(404, "Academic year not found.");
  const jenjangId = id(query.jenjang_id);
  const classId = id(query.class_id);
  if (query.jenjang_id !== undefined && jenjangId === null) fail(400, "jenjang_id is invalid.");
  if (query.class_id !== undefined && classId === null) fail(400, "class_id is invalid.");
  if (jenjangId !== null && !row(context, "SELECT id FROM jenjangs WHERE id = ?", [jenjangId])) fail(404, "Jenjang not found.");
  const classRow = classId === null ? null : row(context, `SELECT c.id, g.jenjang_id
    FROM academic_classes c JOIN academic_grades g ON g.id = c.grade_id
    WHERE c.id = ? AND c.academic_year_id = ?`, [classId, academicYearId]);
  if (classId !== null && !classRow) fail(404, "Class not found in the academic year.");
  if (classRow && jenjangId !== null && Number(classRow.jenjang_id) !== jenjangId) fail(400, "The class and jenjang filters do not match.");
  return { academicYearId, academicYearLabel: String(year.label), yearStart: String(year.start_date), yearEnd: String(year.end_date), jenjangId: jenjangId ?? (classRow ? Number(classRow.jenjang_id) : null), classId };
}

export function studentTrendScopeCte(scope: StudentTrendScope, search = "", studentMasterId = ""): { sql: string; params: unknown[] } {
  const filters = ["e.academic_year_id = ?", "e.student_master_id IS NOT NULL"];
  const params: unknown[] = [scope.academicYearId];
  if (scope.jenjangId !== null) { filters.push("e.jenjang_id = ?"); params.push(scope.jenjangId); }
  if (scope.classId !== null) { filters.push("e.academic_class_id = ?"); params.push(scope.classId); }
  if (studentMasterId) { filters.push("e.student_master_id = ?"); params.push(studentMasterId); }
  if (search) { filters.push("lower(m.full_name) LIKE ?"); params.push(`%${search.toLowerCase()}%`); }
  return {
    sql: `WITH ranked_students AS (
      SELECT e.id AS enrollment_id, e.student_id AS legacy_student_id, e.student_master_id,
             e.jenjang_id, e.academic_class_id AS class_id, e.effective_from, e.effective_to,
             m.full_name AS student_name, j.name AS jenjang,
             COALESCE(c.class_name, e.class_name, s.class_name) AS class_name,
             ROW_NUMBER() OVER (
               PARTITION BY e.student_master_id
               ORDER BY CASE WHEN e.lifecycle_state = 'ACTIVE' THEN 0 ELSE 1 END,
                        CASE WHEN e.effective_from IS NULL THEN 1 ELSE 0 END,
                        e.effective_from DESC, e.id DESC
             ) AS enrollment_rank
        FROM student_enrollments e
        JOIN student_masters m ON m.id = e.student_master_id
        LEFT JOIN students s ON s.id = e.student_id
        LEFT JOIN academic_classes c ON c.id = e.academic_class_id
        LEFT JOIN jenjangs j ON j.id = e.jenjang_id
       WHERE ${filters.join(" AND ")}
    ), scope_students AS (
      SELECT * FROM ranked_students WHERE enrollment_rank = 1
    )`,
    params,
  };
}

function latestAttendanceDate(context: AuthContext, scope: StudentTrendScope, studentMasterId = ""): string | null {
  const base = studentTrendScopeCte(scope, "", studentMasterId);
  const value = row(context, `${base.sql}
    SELECT MAX(a.date) AS anchor_date
      FROM scope_students ss
      JOIN attendance a ON a.student_id = ss.legacy_student_id
       AND a.date >= COALESCE(ss.effective_from, '0000-01-01')
       AND a.date <= COALESCE(ss.effective_to, '9999-12-31')`, base.params);
  return value?.anchor_date ? String(value.anchor_date) : null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function effectiveTerms(context: AuthContext, scope: StudentTrendScope): Row[] {
  const configured = rows(context, "SELECT id, term_number, label, start_date, end_date FROM academic_term_configs WHERE academic_year_id = ? ORDER BY term_number", [scope.academicYearId]);
  const byNumber = new Map(configured.map((value) => [Number(value.term_number), value]));
  const defaults: [number, number, number, string][] = [[1, 7, 9, "Term 1"], [2, 10, 12, "Term 2"], [3, 1, 3, "Term 3"], [4, 4, 6, "Term 4"]];
  return defaults.map(([termNumber, startMonth, endMonth, label]) => {
    const configuredTerm = byNumber.get(termNumber);
    if (configuredTerm) return configuredTerm;
    const year = termNumber <= 2 ? Number(scope.yearStart.slice(0, 4)) : Number(scope.yearEnd.slice(0, 4));
    const start = `${year}-${String(startMonth).padStart(2, "0")}-01`;
    const end = `${year}-${String(endMonth).padStart(2, "0")}-${String(daysInMonth(year, endMonth)).padStart(2, "0")}`;
    return { term_number: termNumber, label, start_date: start < scope.yearStart ? scope.yearStart : start, end_date: end > scope.yearEnd ? scope.yearEnd : end };
  });
}

export function resolveStudentTrendWindow(context: AuthContext, scope: StudentTrendScope, kind: WindowKind, studentMasterId = ""): StudentTrendDateWindow {
  const anchorDate = latestAttendanceDate(context, scope, studentMasterId) ?? scope.yearEnd;
  if (kind === "rolling_4w") {
    const currentStart = anchorDate > dateAdd(scope.yearStart, 27) ? dateAdd(anchorDate, -27) : scope.yearStart;
    const previousEnd = dateAdd(currentStart, -1);
    const previousStart = previousEnd >= scope.yearStart ? (previousEnd > dateAdd(scope.yearStart, 27) ? dateAdd(previousEnd, -27) : scope.yearStart) : null;
    return { anchorDate, currentStart, currentEnd: anchorDate, previousStart, previousEnd: previousStart ? previousEnd : null };
  }
  const terms = effectiveTerms(context, scope);
  let index = terms.findIndex((term) => anchorDate >= String(term.start_date) && anchorDate <= String(term.end_date));
  if (index < 0) index = terms.length - 1;
  const currentTerm = terms[index]!;
  const currentStart = String(currentTerm.start_date);
  const currentEnd = anchorDate < String(currentTerm.end_date) ? anchorDate : String(currentTerm.end_date);
  const previousTerm = terms[index - 1];
  if (!previousTerm) return { anchorDate, currentStart, currentEnd, previousStart: null, previousEnd: null };
  const elapsed = dateDays(currentStart, currentEnd);
  const previousStart = String(previousTerm.start_date);
  const previousEnd = dateAdd(previousStart, elapsed - 1) < String(previousTerm.end_date) ? dateAdd(previousStart, elapsed - 1) : String(previousTerm.end_date);
  return { anchorDate, currentStart, currentEnd, previousStart, previousEnd };
}

function metric(unit: StudentTrendMetric["unit"], current: number | null, previous: number | null, currentSampleSize: number, previousSampleSize: number): StudentTrendMetric {
  const delta = current !== null && previous !== null ? roundPercent(current - previous) : null;
  return {
    unit, current, previous, delta,
    direction: delta === null ? "insufficient_data" : delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    currentSampleSize, previousSampleSize,
  };
}

function attendanceMetric(value: Row, period: "current" | "previous", kind: "attendance" | "tardiness" | "alfa"): StudentTrendMetric {
  const present = Number(value[`${period}_present`] ?? 0);
  const late = Number(value[`${period}_late`] ?? 0);
  const sakit = Number(value[`${period}_sakit`] ?? 0);
  const izin = Number(value[`${period}_izin`] ?? 0);
  const alfa = Number(value[`${period}_alfa`] ?? 0);
  const denominator = present + late + sakit + izin + alfa;
  const attended = present + late;
  if (kind === "tardiness") return metric("percent", attended ? roundPercent(late / attended * 100) : null, null, attended, 0);
  if (kind === "alfa") return metric("percent", denominator ? roundPercent(alfa / denominator * 100) : null, null, denominator, 0);
  return metric("percent", denominator ? roundPercent(attended / denominator * 100) : null, null, denominator, 0);
}

function aggregateQuery(scope: StudentTrendScope, window: StudentTrendDateWindow, search: string, sort: string, order: "ASC" | "DESC", page: number, pageSize: number, studentMasterId = ""): { sql: string; params: unknown[] } {
  const base = studentTrendScopeCte(scope, search, studentMasterId);
  const hasPrevious = window.previousStart !== null && window.previousEnd !== null;
  const periodCase = hasPrevious ? "CASE WHEN a.date >= ? AND a.date <= ? THEN 'current' ELSE 'previous' END" : "'current'";
  const periodWhere = hasPrevious ? "(a.date >= ? AND a.date <= ? OR a.date >= ? AND a.date <= ?)" : "a.date >= ? AND a.date <= ?";
  const params: unknown[] = [...base.params];
  if (hasPrevious) params.push(window.currentStart, window.currentEnd);
  params.push(window.currentStart, window.currentEnd);
  if (hasPrevious) params.push(window.previousStart, window.previousEnd);
  const sortColumn: Record<string, string> = { name: "student_name", attendance_delta: "attendance_delta", academic_delta: "academic_delta", tardiness_delta: "tardiness_delta", alfa_delta: "alfa_delta" };
  const orderColumn = sortColumn[sort] ?? "student_name";
  const currentDenominator = "(COALESCE(aa.current_present, 0) + COALESCE(aa.current_late, 0) + COALESCE(aa.current_sakit, 0) + COALESCE(aa.current_izin, 0) + COALESCE(aa.current_alfa, 0))";
  const previousDenominator = "(COALESCE(aa.previous_present, 0) + COALESCE(aa.previous_late, 0) + COALESCE(aa.previous_sakit, 0) + COALESCE(aa.previous_izin, 0) + COALESCE(aa.previous_alfa, 0))";
  const currentAttended = "(COALESCE(aa.current_present, 0) + COALESCE(aa.current_late, 0))";
  const previousAttended = "(COALESCE(aa.previous_present, 0) + COALESCE(aa.previous_late, 0))";
  const offset = (page - 1) * pageSize;
  params.push(pageSize, offset);
  return {
    sql: `${base.sql}, attendance_events AS (
      SELECT ss.student_master_id AS student_id, ${periodCase} AS period,
             COALESCE(o.override_status, a.status) AS effective_status
        FROM scope_students ss
        JOIN attendance a ON a.student_id = ss.legacy_student_id
         AND a.date >= COALESCE(ss.effective_from, '0000-01-01')
         AND a.date <= COALESCE(ss.effective_to, '9999-12-31')
        LEFT JOIN attendance_overrides o ON o.attendance_id = a.id
       WHERE ${periodWhere}
    ), attendance_aggregates AS (
      SELECT student_id,
        SUM(CASE WHEN period = 'current' AND effective_status = 'on-time' THEN 1 ELSE 0 END) AS current_present,
        SUM(CASE WHEN period = 'current' AND effective_status = 'late' THEN 1 ELSE 0 END) AS current_late,
        SUM(CASE WHEN period = 'current' AND effective_status = 'sakit' THEN 1 ELSE 0 END) AS current_sakit,
        SUM(CASE WHEN period = 'current' AND effective_status = 'izin' THEN 1 ELSE 0 END) AS current_izin,
        SUM(CASE WHEN period = 'current' AND effective_status = 'alfa' THEN 1 ELSE 0 END) AS current_alfa,
        SUM(CASE WHEN period = 'previous' AND effective_status = 'on-time' THEN 1 ELSE 0 END) AS previous_present,
        SUM(CASE WHEN period = 'previous' AND effective_status = 'late' THEN 1 ELSE 0 END) AS previous_late,
        SUM(CASE WHEN period = 'previous' AND effective_status = 'sakit' THEN 1 ELSE 0 END) AS previous_sakit,
        SUM(CASE WHEN period = 'previous' AND effective_status = 'izin' THEN 1 ELSE 0 END) AS previous_izin,
        SUM(CASE WHEN period = 'previous' AND effective_status = 'alfa' THEN 1 ELSE 0 END) AS previous_alfa
      FROM attendance_events GROUP BY student_id
    ), scored AS (
      SELECT ss.student_master_id AS student_id, ss.student_name, ss.class_name, ss.jenjang,
             COALESCE(aa.current_present, 0) AS current_present, COALESCE(aa.current_late, 0) AS current_late,
             COALESCE(aa.current_sakit, 0) AS current_sakit, COALESCE(aa.current_izin, 0) AS current_izin,
             COALESCE(aa.current_alfa, 0) AS current_alfa, COALESCE(aa.previous_present, 0) AS previous_present,
             COALESCE(aa.previous_late, 0) AS previous_late, COALESCE(aa.previous_sakit, 0) AS previous_sakit,
             COALESCE(aa.previous_izin, 0) AS previous_izin, COALESCE(aa.previous_alfa, 0) AS previous_alfa,
             CASE WHEN ${currentDenominator} = 0 OR ${previousDenominator} = 0 THEN NULL ELSE ROUND(100.0 * ${currentAttended} / ${currentDenominator} - 100.0 * ${previousAttended} / ${previousDenominator}, 2) END AS attendance_delta,
             CASE WHEN ${currentAttended} = 0 OR ${previousAttended} = 0 THEN NULL ELSE ROUND(100.0 * COALESCE(aa.current_late, 0) / ${currentAttended} - 100.0 * COALESCE(aa.previous_late, 0) / ${previousAttended}, 2) END AS tardiness_delta,
             CASE WHEN ${currentDenominator} = 0 OR ${previousDenominator} = 0 THEN NULL ELSE ROUND(100.0 * COALESCE(aa.current_alfa, 0) / ${currentDenominator} - 100.0 * COALESCE(aa.previous_alfa, 0) / ${previousDenominator}, 2) END AS alfa_delta,
             NULL AS academic_delta
        FROM scope_students ss LEFT JOIN attendance_aggregates aa ON aa.student_id = ss.student_master_id
    )
    SELECT scored.*, (SELECT COUNT(*) FROM scored) AS total_students
      FROM scored
     ORDER BY CASE WHEN ${orderColumn} IS NULL THEN 1 ELSE 0 END, ${orderColumn} ${order}, student_name ASC, student_id ASC
     LIMIT ? OFFSET ?`,
    params,
  };
}

export function studentTrendInsights(context: AuthContext, query: Row, canAttendance = true): StudentTrendInsightsResponse {
  const scope = buildStudentTrendScope(context, query);
  const windowKind: WindowKind = query.window === "term" ? "term" : "rolling_4w";
  const studentMasterId = String(query.student_id ?? "");
  const window = resolveStudentTrendWindow(context, scope, windowKind, studentMasterId);
  const page = Math.max(1, Number(query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(query.page_size ?? 25)));
  const search = String(query.search ?? "").trim();
  const sort = String(query.sort ?? "name");
  const order = String(query.order ?? "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
  const built = aggregateQuery(scope, window, search, sort, order, page, pageSize, studentMasterId);
  const values = rows(context, built.sql, built.params);
  const academic = metric("score", null, null, 0, 0);
  const resultRows = values.map((value) => {
    const currentValue = canAttendance ? attendanceMetric(value, "current", "attendance") : null;
    const previousValue = canAttendance ? attendanceMetric(value, "previous", "attendance") : null;
    const currentTardiness = canAttendance ? attendanceMetric(value, "current", "tardiness") : null;
    const previousTardiness = canAttendance ? attendanceMetric(value, "previous", "tardiness") : null;
    const currentAlfa = canAttendance ? attendanceMetric(value, "current", "alfa") : null;
    const previousAlfa = canAttendance ? attendanceMetric(value, "previous", "alfa") : null;
    const combine = (current: StudentTrendMetric | null, previous: StudentTrendMetric | null): StudentTrendMetric | null => current === null || previous === null ? null : metric(current.unit, current.current, previous.current, current.currentSampleSize, previous.currentSampleSize);
    return {
      studentId: String(value.student_id), studentName: String(value.student_name), className: value.class_name === null ? null : String(value.class_name), jenjang: value.jenjang === null ? null : String(value.jenjang),
      attendance: combine(currentValue, previousValue), academic,
      tardiness: combine(currentTardiness, previousTardiness), alfa: combine(currentAlfa, previousAlfa),
    };
  });
  return {
    scope: { academicYearId: scope.academicYearId, academicYearLabel: scope.academicYearLabel, jenjangId: scope.jenjangId, classId: scope.classId },
    window: { kind: windowKind, anchorDate: window.anchorDate, currentStart: window.currentStart, currentEnd: window.currentEnd, previousStart: window.previousStart, previousEnd: window.previousEnd, currentEligibleDays: dateDays(window.currentStart, window.currentEnd), previousEligibleDays: dateDays(window.previousStart, window.previousEnd), comparison: window.previousStart ? "comparable" : "insufficient_data" } satisfies StudentTrendWindow,
    totalStudents: Number(values[0]?.total_students ?? 0), page, pageSize, rows: resultRows,
    limitations: [
      "Rolling and term windows use calendar dates because the current schema has no instructional-day calendar.",
      "Academic trend values are unavailable because canonical grade rows have no date or term field.",
      "Teacher class-assignment scoping is not applied because the current analytics capability model does not provide an assignment-scoped student capability.",
    ],
  };
}

export function studentTrendRoutes(app: any, context: AuthContext): void {
  app.get("/api/analytics/student-trends", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_student" });
    if (!user) return { detail: "Insufficient permissions" };
    const canAttendance = capabilitiesForRole(user.role).includes("view_attendance");
    return studentTrendInsights(context, ctx.query, canAttendance);
  }, { query: StudentTrendQuerySchema, response: StudentTrendInsightsResponseSchema });
}
