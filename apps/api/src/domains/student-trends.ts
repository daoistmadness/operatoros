import { StudentTrendInsightsResponseSchema, StudentTrendQuerySchema, type StudentTrendInsightsResponse, type StudentTrendMetric, type StudentTrendWindow } from "@operatoros/contracts/analytics";
import { capabilitiesForRole } from "../auth/capabilities";
import { actor } from "./core";
import { effectiveAcademicTerms, hasAcademicTimelineTable } from "./academic-timeline";
import { roundHalfEven } from "../analytics/queries";
import { attendancePeriodStudentsByRanges } from "./term-attendance";
import { tallyLatenessRange } from "./term-lateness";
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

export interface StudentPeriodAttendance {
  expectedStudentDays: number;
  hadir: number;
  alfa: number;
  lateEvents: number;
  attendanceRate: number | null;
  alfaRate: number | null;
  lateEventRate: number | null;
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

export function studentInsightStudents(context: AuthContext, scope: StudentTrendScope, search = "", studentMasterId = ""): Row[] {
  const base = studentTrendScopeCte(scope, search, studentMasterId);
  return rows(context, `${base.sql}
    SELECT student_master_id AS student_id, student_name, class_name, jenjang
      FROM scope_students ORDER BY student_name, student_master_id`, base.params);
}

export function studentPeriodAttendance(context: AuthContext, scope: StudentTrendScope, current: { startDate: string; endDate: string }, previous?: { startDate: string; endDate: string }): { current: Map<string, StudentPeriodAttendance>; previous: Map<string, StudentPeriodAttendance> } {
  const ranges = [{ key: "current", start_date: current.startDate, end_date: current.endDate }, ...(previous ? [{ key: "previous", start_date: previous.startDate, end_date: previous.endDate }] : [])];
  const attendance = attendancePeriodStudentsByRanges(context, { academic_year_id: scope.academicYearId, jenjang_id: scope.jenjangId ?? undefined, ranges });
  const startDate = previous && previous.startDate < current.startDate ? previous.startDate : current.startDate;
  const endDate = previous && previous.endDate > current.endDate ? previous.endDate : current.endDate;
  const lateness = tallyLatenessRange(context, {
    startDate, endDate, academicYearId: scope.academicYearId,
    scope: { jenjang_id: scope.jenjangId, program_id: null, grade_id: null, class_id: null },
    scopeIsValidated: true,
  });
  const period = (key: "current" | "previous", range: { startDate: string; endDate: string } | undefined) => {
    const result = new Map<string, StudentPeriodAttendance>();
    if (!range) return result;
    for (const [studentKey, counts] of attendance.get(key) ?? []) {
      if (studentKey.startsWith("legacy:")) continue;
      const lateEvents = [...(lateness.byStudent.get(studentKey)?.late_events_by_date ?? [])]
        .reduce((sum, [date, count]) => date >= range.startDate && date <= range.endDate ? sum + count : sum, 0);
      result.set(studentKey, {
        expectedStudentDays: counts.expectedStudentDays, hadir: counts.hadir, alfa: counts.alfa, lateEvents,
        attendanceRate: counts.expectedStudentDays ? roundPercent(counts.hadir / counts.expectedStudentDays * 100) : null,
        alfaRate: counts.expectedStudentDays ? roundPercent(counts.alfa / counts.expectedStudentDays * 100) : null,
        lateEventRate: counts.expectedStudentDays ? roundPercent(lateEvents / counts.expectedStudentDays * 100) : null,
      });
    }
    return result;
  };
  return { current: period("current", current), previous: period("previous", previous) };
}

function latestAttendanceDate(context: AuthContext, scope: StudentTrendScope, studentMasterId = ""): string | null {
  const base = studentTrendScopeCte(scope, "", studentMasterId);
  const value = row(context, `${base.sql}
    SELECT MAX(a.date) AS anchor_date
      FROM scope_students ss
      JOIN attendance a ON a.student_id = ss.legacy_student_id
       AND a.date >= COALESCE(ss.effective_from, '0000-01-01')
       AND a.date <= COALESCE(ss.effective_to, '9999-12-31')
       AND a.date >= ? AND a.date <= ?`, [...base.params, scope.yearStart, scope.yearEnd]);
  return value?.anchor_date ? String(value.anchor_date) : null;
}

function effectiveTerms(context: AuthContext, scope: StudentTrendScope): Row[] {
  return effectiveAcademicTerms(context, { id: scope.academicYearId, start_date: scope.yearStart, end_date: scope.yearEnd });
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

function academicMetrics(context: AuthContext, scope: StudentTrendScope, studentMasterId = ""): Map<string, StudentTrendMetric> {
  if (!hasAcademicTimelineTable(context)) return new Map();
  const base = studentTrendScopeCte(scope, "", studentMasterId);
  const values = rows(context, `${base.sql}
    SELECT ss.student_master_id AS student_id, aas.term_number,
           SUM(g.score) AS score_sum, COUNT(g.score) AS score_count
      FROM scope_students ss
      JOIN student_subject_grades g ON g.enrollment_id = ss.enrollment_id AND g.score IS NOT NULL
      JOIN academic_assessment_sessions aas ON aas.id = g.assessment_session_id AND aas.academic_year_id = ?
     GROUP BY ss.student_master_id, aas.term_number`, [...base.params, scope.academicYearId]);
  const grouped = new Map<string, Row[]>();
  for (const value of values) {
    const list = grouped.get(String(value.student_id)) ?? [];
    list.push(value);
    grouped.set(String(value.student_id), list);
  }
  const result = new Map<string, StudentTrendMetric>();
  for (const [studentId, terms] of grouped) {
    const currentTerm = terms.reduce((latest, value) => Math.max(latest, Number(value.term_number)), 0);
    const current = terms.find((value) => Number(value.term_number) === currentTerm);
    const previous = terms.find((value) => Number(value.term_number) === currentTerm - 1);
    const currentValue = current ? roundHalfEven(Number(current.score_sum) / Number(current.score_count), 1) : null;
    const previousValue = previous ? roundHalfEven(Number(previous.score_sum) / Number(previous.score_count), 1) : null;
    result.set(studentId, metric("score", currentValue, previousValue, Number(current?.score_count ?? 0), Number(previous?.score_count ?? 0)));
  }
  return result;
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
  const values = studentInsightStudents(context, scope, search, studentMasterId);
  const academicByStudent = academicMetrics(context, scope, studentMasterId);
  const attendancePeriods = canAttendance ? studentPeriodAttendance(context, scope,
    { startDate: window.currentStart, endDate: window.currentEnd },
    window.previousStart && window.previousEnd ? { startDate: window.previousStart, endDate: window.previousEnd } : undefined)
    : { current: new Map<string, StudentPeriodAttendance>(), previous: new Map<string, StudentPeriodAttendance>() };
  const currentAttendance = attendancePeriods.current;
  const previousAttendance = attendancePeriods.previous;
  const resultRows = values.map((value) => {
    const id = String(value.student_id);
    const current = currentAttendance.get(id);
    const previous = previousAttendance.get(id);
    const combine = (kind: "attendanceRate" | "lateEventRate" | "alfaRate"): StudentTrendMetric | null => !canAttendance ? null : metric(
      "percent", current?.[kind] ?? null, previous?.[kind] ?? null,
      current?.expectedStudentDays ?? 0, previous?.expectedStudentDays ?? 0,
    );
    return {
      studentId: String(value.student_id), studentName: String(value.student_name), className: value.class_name === null ? null : String(value.class_name), jenjang: value.jenjang === null ? null : String(value.jenjang),
      attendance: combine("attendanceRate"), academic: academicByStudent.get(id) ?? metric("score", null, null, 0, 0),
      tardiness: combine("lateEventRate"), alfa: combine("alfaRate"),
    };
  });
  const metricForSort = (value: StudentTrendInsightsResponse["rows"][number]): number | null => {
    if (sort === "attendance_delta") return value.attendance?.delta ?? null;
    if (sort === "academic_delta") return value.academic.delta;
    if (sort === "tardiness_delta") return value.tardiness?.delta ?? null;
    if (sort === "alfa_delta") return value.alfa?.delta ?? null;
    return null;
  };
  const sortedRows = resultRows.sort((left, right) => {
    let compared = 0;
    if (sort === "name") compared = left.studentName.localeCompare(right.studentName) * (order === "DESC" ? -1 : 1);
    else {
      const a = metricForSort(left);
      const b = metricForSort(right);
      if (a === null && b !== null) return 1;
      if (a !== null && b === null) return -1;
      if (a !== null && b !== null) compared = (a - b) * (order === "DESC" ? -1 : 1);
    }
    return compared || left.studentName.localeCompare(right.studentName) || left.studentId.localeCompare(right.studentId);
  });
  return {
    scope: { academicYearId: scope.academicYearId, academicYearLabel: scope.academicYearLabel, jenjangId: scope.jenjangId, classId: scope.classId },
    window: { kind: windowKind, anchorDate: window.anchorDate, currentStart: window.currentStart, currentEnd: window.currentEnd, previousStart: window.previousStart, previousEnd: window.previousEnd, currentEligibleDays: dateDays(window.currentStart, window.currentEnd), previousEligibleDays: dateDays(window.previousStart, window.previousEnd), comparison: window.previousStart ? "comparable" : "insufficient_data" } satisfies StudentTrendWindow,
    totalStudents: values.length, page, pageSize, rows: sortedRows.slice((page - 1) * pageSize, page * pageSize),
    limitations: [
      "Rolling and term windows use calendar dates because the current schema has no instructional-day calendar.",
      "Legacy grade rows with no date or term field remain period-unknown and are excluded from session-backed academic comparisons.",
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
