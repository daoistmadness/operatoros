import { addWorksheet, appendRow, autoSizeColumns, createWorkbook, safeExportFilename, styleHeader, writeXlsxWorkbook } from "@operatoros/excel";
import { randomUUID } from "node:crypto";
import {
  AttendanceAnalyticsQuerySchema,
  AttendanceAnalyticsOptionsQuerySchema,
  AttendanceAnalyticsOptionsResponseSchema,
  AttendanceClassesResponseSchema,
  AttendanceDailyResponseSchema,
  AttendanceJenjangResponseSchema,
  AttendanceOverviewResponseSchema,
  AttendanceStudentsResponseSchema,
  type AttendanceAnalyticsStatusCounts,
  type AttendanceOverviewResponse,
} from "@operatoros/contracts/analytics";
import { actor } from "./core";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;
type Group = "overview" | "class" | "jenjang" | "daily" | "student";

const EMPTY_COUNTS: AttendanceAnalyticsStatusCounts = { present: 0, late: 0, incomplete: 0, absent: 0, sakit: 0, izin: 0, alfa: 0, unrecorded: 0 };

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function row(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  const value = context.database.client.query(sql).get(...(params as never[])) as Row | null;
  return value ?? null;
}

function fail(set: any, detail: string): { detail: string } {
  set.status = 400;
  return { detail };
}

function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

function countsFrom(value: Row): AttendanceAnalyticsStatusCounts {
  return {
    present: Number(value.present ?? 0),
    late: Number(value.late ?? 0),
    incomplete: Number(value.incomplete ?? 0),
    absent: Number(value.absent ?? 0),
    sakit: Number(value.sakit ?? 0),
    izin: Number(value.izin ?? 0),
    alfa: Number(value.alfa ?? 0),
    unrecorded: Number(value.unrecorded ?? 0),
  };
}

function totalRecords(counts: AttendanceAnalyticsStatusCounts): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

// Preserve the existing analytics denominator. Late is attended. Incomplete
// and raw absent rows remain visible but are outside that denominator.
function attendanceRate(counts: AttendanceAnalyticsStatusCounts): number {
  const denominator = counts.present + counts.late + counts.sakit + counts.izin + counts.alfa;
  return percentage(counts.present + counts.late, denominator);
}

function tardinessRate(counts: AttendanceAnalyticsStatusCounts): number {
  return percentage(counts.late, counts.present + counts.late);
}

function unexcusedAbsenceRate(counts: AttendanceAnalyticsStatusCounts): number {
  const denominator = counts.present + counts.late + counts.sakit + counts.izin + counts.alfa;
  return percentage(counts.alfa, denominator);
}

interface AttendanceScope {
  dateFrom: string;
  dateTo: string;
  academicYearId: number;
  academicYearLabel: string;
  jenjangId: number | null;
  classId: number | null;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function buildScope(context: AuthContext, query: Row): AttendanceScope | null {
  const dateFrom = query.date_from;
  const dateTo = query.date_to;
  const academicYearId = Number(query.academic_year_id);
  if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo || !Number.isInteger(academicYearId) || academicYearId < 1) return null;
  const academicYear = row(context, "SELECT id, label FROM academic_years WHERE id = ?", [academicYearId]);
  if (!academicYear) return null;
  const jenjangId = query.jenjang_id === undefined ? null : Number(query.jenjang_id);
  const classId = query.class_id === undefined ? null : Number(query.class_id);
  if (jenjangId !== null && (!Number.isInteger(jenjangId) || !row(context, "SELECT id FROM jenjangs WHERE id = ?", [jenjangId]))) return null;
  if (classId !== null && (!Number.isInteger(classId) || !row(context, "SELECT id FROM academic_classes WHERE id = ? AND academic_year_id = ?", [classId, academicYearId]))) return null;
  return { dateFrom, dateTo, academicYearId, academicYearLabel: String(academicYear.label), jenjangId, classId };
}

interface BuiltQuery { sql: string; params: unknown[] }

function scopedCte(scope: AttendanceScope, search = ""): BuiltQuery {
  const filters = ["a.date >= ?", "a.date <= ?"];
  const params: unknown[] = [scope.dateFrom, scope.dateTo, scope.academicYearId];
  if (scope.jenjangId !== null) { filters.push("e.jenjang_id = ?"); params.push(scope.jenjangId); }
  if (scope.classId !== null) { filters.push("e.academic_class_id = ?"); params.push(scope.classId); }
  if (search) { filters.push("lower(s.name) LIKE ?"); params.push(`%${search.toLowerCase()}%`); }
  return {
    sql: `WITH ranked AS (
      SELECT a.id AS attendance_id, a.student_id, a.date, s.name AS student_name,
             e.academic_class_id, COALESCE(c.class_name, e.class_name, s.class_name) AS class_name,
             e.jenjang_id, j.name AS jenjang_name,
             COALESCE(o.override_status, a.status) AS effective_status,
             CASE WHEN o.id IS NULL THEN 0 ELSE 1 END AS overridden,
             ROW_NUMBER() OVER (
               PARTITION BY a.id
               ORDER BY CASE WHEN e.effective_from IS NULL THEN 1 ELSE 0 END,
                        e.effective_from DESC, e.id DESC
             ) AS enrollment_rank
        FROM attendance a
        JOIN students s ON s.id = a.student_id
        JOIN student_enrollments e
          ON e.student_id = a.student_id
         AND e.academic_year_id = ?
         AND a.date >= COALESCE(e.effective_from, '0000-01-01')
         AND a.date <= COALESCE(e.effective_to, '9999-12-31')
        LEFT JOIN academic_classes c ON c.id = e.academic_class_id
        LEFT JOIN jenjangs j ON j.id = e.jenjang_id
        LEFT JOIN attendance_overrides o ON o.attendance_id = a.id
       WHERE ${filters.join(" AND ")}
    ), selected AS (
      SELECT * FROM ranked WHERE enrollment_rank = 1
    )`,
    params: [scope.academicYearId, scope.dateFrom, scope.dateTo, ...params.slice(3)],
  };
}

function aggregateQuery(scope: AttendanceScope, group: Group, search = ""): BuiltQuery {
  const base = scopedCte(scope, search);
  const groupSql = group === "class" ? "academic_class_id" : group === "jenjang" ? "jenjang_id" : group === "daily" ? "date" : group === "student" ? "student_id" : null;
  const labelSql = group === "class" ? "MAX(class_name) AS label" : group === "jenjang" ? "MAX(jenjang_name) AS label" : group === "student" ? "MAX(student_name) AS label, MAX(class_name) AS class_label" : "";
  const keySql = groupSql ? `${groupSql} AS group_key, ` : "";
  return {
    sql: `${base.sql}
      SELECT ${keySql}${labelSql ? `${labelSql}, ` : ""}
             COUNT(*) AS records,
             COUNT(DISTINCT student_id) AS students,
             COUNT(DISTINCT academic_class_id) AS classes,
             SUM(CASE WHEN effective_status = 'on-time' THEN 1 ELSE 0 END) AS present,
             SUM(CASE WHEN effective_status = 'late' THEN 1 ELSE 0 END) AS late,
             SUM(CASE WHEN effective_status = 'incomplete' THEN 1 ELSE 0 END) AS incomplete,
             SUM(CASE WHEN effective_status = 'absent' THEN 1 ELSE 0 END) AS absent,
             SUM(CASE WHEN effective_status = 'sakit' THEN 1 ELSE 0 END) AS sakit,
             SUM(CASE WHEN effective_status = 'izin' THEN 1 ELSE 0 END) AS izin,
             SUM(CASE WHEN effective_status = 'alfa' THEN 1 ELSE 0 END) AS alfa,
             SUM(CASE WHEN effective_status IS NULL OR effective_status NOT IN ('on-time', 'late', 'incomplete', 'absent', 'sakit', 'izin', 'alfa', 'unrecorded') THEN 1 ELSE 0 END) AS unrecorded,
             SUM(overridden) AS overridden
        FROM selected
       ${groupSql ? `GROUP BY ${groupSql}` : ""}`,
    params: base.params,
  };
}

function aggregate(context: AuthContext, scope: AttendanceScope, group: Group): Row {
  const built = aggregateQuery(scope, group);
  return row(context, built.sql, built.params) ?? { records: 0, overridden: 0, ...EMPTY_COUNTS };
}

function scopeMetadata(scope: AttendanceScope, totalApplicableRecords: number) {
  return { dateFrom: scope.dateFrom, dateTo: scope.dateTo, academicYearId: scope.academicYearId, academicYearLabel: scope.academicYearLabel, jenjangId: scope.jenjangId, classId: scope.classId, totalApplicableRecords };
}

function hebTotal(context: AuthContext, scope: AttendanceScope): number {
  const months = new Set<string>();
  const cursor = new Date(`${scope.dateFrom}T00:00:00Z`);
  const end = new Date(`${scope.dateTo}T00:00:00Z`);
  while (cursor <= end) {
    months.add(`${cursor.getUTCFullYear()}-${cursor.getUTCMonth() + 1}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const jenjangName = scope.jenjangId === null ? null : row(context, "SELECT name FROM jenjangs WHERE id = ?", [scope.jenjangId])?.name;
  return [...months].reduce((total, key) => {
    const [year, month] = key.split("-").map(Number);
    const filter = jenjangName === null ? "" : " AND h.jenjang = ?";
    const params: unknown[] = [month, year];
    if (jenjangName !== null) params.push(jenjangName);
    return total + Number(row(context, `SELECT COALESCE(SUM(h.heb_value), 0) AS total FROM heb_overrides h WHERE h.month = ? AND h.year = ?${filter}`, params)?.total ?? 0);
  }, 0);
}

function responseRow(value: Row, group: Group): Row {
  const counts = countsFrom(value);
  return {
    ...(group === "class" ? { classId: value.group_key === null ? null : Number(value.group_key), className: String(value.label ?? "Unknown"), students: Number(value.students ?? 0) } : {}),
    ...(group === "jenjang" ? { jenjangId: value.group_key === null ? null : Number(value.group_key), jenjang: String(value.label ?? "Unknown"), students: Number(value.students ?? 0) } : {}),
    ...(group === "daily" ? { date: String(value.group_key), records: Number(value.records ?? 0) } : {}),
    ...(group === "student" ? { studentId: Number(value.group_key), studentName: String(value.label ?? "Unknown"), className: value.class_label ? String(value.class_label) : null } : {}),
    counts,
    attendanceRate: attendanceRate(counts),
    ...(group !== "daily" ? { tardinessRate: tardinessRate(counts), unexcusedAbsenceRate: unexcusedAbsenceRate(counts) } : {}),
  };
}

function groupedRows(context: AuthContext, scope: AttendanceScope, group: Exclude<Group, "overview" | "student">): Row[] {
  const built = aggregateQuery(scope, group);
  const values = rows(context, built.sql, built.params);
  return values.map((value) => responseRow(value, group)).sort((left, right) => String(left.date ?? left.className ?? left.jenjang ?? "").localeCompare(String(right.date ?? right.className ?? right.jenjang ?? "")));
}

function studentRows(context: AuthContext, scope: AttendanceScope, search: string, sort: string, direction: "ASC" | "DESC", page: number, pageSize: number): { rows: Row[]; total: number; records: number } {
  const base = scopedCte(scope, search);
  const order = sort === "late" ? "late" : sort === "alfa" ? "alfa" : sort === "attendance_rate" ? "attendance_rate" : "label";
  const offset = (page - 1) * pageSize;
  const sql = `${base.sql}, aggregated AS (
      SELECT student_id AS group_key, student_id, MAX(student_name) AS label, MAX(class_name) AS class_label,
             COUNT(*) AS records,
             SUM(CASE WHEN effective_status = 'on-time' THEN 1 ELSE 0 END) AS present,
             SUM(CASE WHEN effective_status = 'late' THEN 1 ELSE 0 END) AS late,
             SUM(CASE WHEN effective_status = 'incomplete' THEN 1 ELSE 0 END) AS incomplete,
             SUM(CASE WHEN effective_status = 'absent' THEN 1 ELSE 0 END) AS absent,
             SUM(CASE WHEN effective_status = 'sakit' THEN 1 ELSE 0 END) AS sakit,
             SUM(CASE WHEN effective_status = 'izin' THEN 1 ELSE 0 END) AS izin,
             SUM(CASE WHEN effective_status = 'alfa' THEN 1 ELSE 0 END) AS alfa,
             SUM(CASE WHEN effective_status IS NULL OR effective_status NOT IN ('on-time', 'late', 'incomplete', 'absent', 'sakit', 'izin', 'alfa', 'unrecorded') THEN 1 ELSE 0 END) AS unrecorded
        FROM selected GROUP BY student_id
    ), scored AS (
      SELECT aggregated.*, CASE WHEN present + late + sakit + izin + alfa = 0 THEN 0 ELSE ROUND(100.0 * (present + late) / (present + late + sakit + izin + alfa), 2) END AS attendance_rate
        FROM aggregated
    )
    SELECT * FROM scored ORDER BY ${order} ${direction}, label ASC, student_id ASC LIMIT ? OFFSET ?`;
  const values = rows(context, sql, [...base.params, pageSize, offset]);
  const summary = row(context, `${base.sql} SELECT COUNT(*) AS total, COALESCE(SUM(records), 0) AS records FROM (SELECT student_id, COUNT(*) AS records FROM selected GROUP BY student_id)`, base.params) ?? { total: 0, records: 0 };
  return { rows: values.map((value) => responseRow(value, "student")), total: Number(summary.total ?? 0), records: Number(summary.records ?? 0) };
}

function auditExport(context: AuthContext, user: { username: string; role: string }, scope: AttendanceScope, total: number): void {
  context.database.client.run(
    "INSERT INTO operations_audit_events (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source, export_scope, success, failure_code, metadata, schema_version) VALUES (?, ?, ?, 'view_attendance', 'ATTENDANCE_EXPORT', ?, 'EXPORT_ATTENDANCE_ANALYTICS', 'LOW', 'API', ?, 1, NULL, ?, '1')",
    [randomUUID(), user.username, user.role, `ATTENDANCE_ANALYTICS/${scope.dateFrom}_${scope.dateTo}`, `ATTENDANCE_ANALYTICS/${scope.dateFrom}_${scope.dateTo}`, JSON.stringify({ academic_year_id: scope.academicYearId, jenjang_id: scope.jenjangId, class_id: scope.classId, total_records: total })],
  );
}

export function attendanceOverview(context: AuthContext, query: Row): AttendanceOverviewResponse | null {
  const scope = buildScope(context, query);
  if (!scope) return null;
  const value = aggregate(context, scope, "overview");
  const counts = countsFrom(value);
  const total = totalRecords(counts);
  return { scope: scopeMetadata(scope, total), totalRecords: total, students: Number(value.students ?? 0), classes: Number(value.classes ?? 0), counts, attendanceRate: attendanceRate(counts), tardinessRate: tardinessRate(counts), unexcusedAbsenceRate: unexcusedAbsenceRate(counts), overriddenRecords: Number(value.overridden ?? 0), overridePercentage: percentage(Number(value.overridden ?? 0), total), hebTotal: hebTotal(context, scope), generatedAt: new Date().toISOString() };
}

export function attendanceJenjangOverview(context: AuthContext, query: Row): Row[] | null {
  const scope = buildScope(context, query);
  return scope ? groupedRows(context, scope, "jenjang") : null;
}

export function attendanceAnalyticsRoutes(app: any, context: AuthContext): void {
  const options = { query: AttendanceAnalyticsQuerySchema };
  const authorized = (ctx: Context) => actor(context, ctx, { capability: "view_attendance" });

  app.get("/api/analytics/attendance/options", (ctx: Context) => {
    const user = authorized(ctx);
    if (!user) return { detail: "Insufficient permissions" };
    const academicYearId = Number(ctx.query.academic_year_id);
    const jenjangId = ctx.query.jenjang_id === undefined ? null : Number(ctx.query.jenjang_id);
    if (!Number.isInteger(academicYearId) || academicYearId < 1) return fail(ctx.set, "academic_year_id is invalid.");
    const year = row(context, "SELECT id FROM academic_years WHERE id = ?", [academicYearId]);
    if (!year) return fail(ctx.set, "academic_year_id is invalid.");
    const classes = rows(context, `SELECT c.id, c.class_name AS name, g.jenjang_id AS jenjang_id FROM academic_classes c JOIN academic_grades g ON g.id = c.grade_id WHERE c.academic_year_id = ?${jenjangId === null ? "" : " AND g.jenjang_id = ?"} ORDER BY c.class_name, c.id`, jenjangId === null ? [academicYearId] : [academicYearId, jenjangId]).map((value) => ({ id: Number(value.id), name: String(value.name), jenjangId: Number(value.jenjang_id) }));
    return {
      academicYears: rows(context, "SELECT id, label, start_date, end_date, is_default FROM academic_years ORDER BY start_date").map((value) => ({ id: Number(value.id), label: String(value.label), startDate: String(value.start_date), endDate: String(value.end_date), isDefault: Boolean(value.is_default) })),
      jenjangs: rows(context, "SELECT id, name FROM jenjangs ORDER BY name").map((value) => ({ id: Number(value.id), name: String(value.name) })),
      classes,
    };
  }, { query: AttendanceAnalyticsOptionsQuerySchema, response: AttendanceAnalyticsOptionsResponseSchema });

  app.get("/api/analytics/attendance/overview", (ctx: Context) => {
    const user = authorized(ctx);
    if (!user) return { detail: "Insufficient permissions" };
    return attendanceOverview(context, ctx.query);
  }, { ...options, response: AttendanceOverviewResponseSchema });

  app.get("/api/analytics/attendance/classes", (ctx: Context) => {
    const user = authorized(ctx);
    if (!user) return { detail: "Insufficient permissions" };
    const scope = buildScope(context, ctx.query);
    if (!scope) return fail(ctx.set, "The attendance analytics scope is invalid.");
    const values = groupedRows(context, scope, "class");
    return { scope: scopeMetadata(scope, values.reduce((sum, value) => sum + totalRecords(value.counts), 0)), rows: values, generatedAt: new Date().toISOString() };
  }, { ...options, response: AttendanceClassesResponseSchema });

  app.get("/api/analytics/attendance/jenjang", (ctx: Context) => {
    const user = authorized(ctx);
    if (!user) return { detail: "Insufficient permissions" };
    const scope = buildScope(context, ctx.query);
    if (!scope) return fail(ctx.set, "The attendance analytics scope is invalid.");
    const values = groupedRows(context, scope, "jenjang");
    return { scope: scopeMetadata(scope, values.reduce((sum, value) => sum + totalRecords(value.counts), 0)), rows: values, generatedAt: new Date().toISOString() };
  }, { ...options, response: AttendanceJenjangResponseSchema });

  app.get("/api/analytics/attendance/daily", (ctx: Context) => {
    const user = authorized(ctx);
    if (!user) return { detail: "Insufficient permissions" };
    const scope = buildScope(context, ctx.query);
    if (!scope) return fail(ctx.set, "The attendance analytics scope is invalid.");
    const values = groupedRows(context, scope, "daily");
    return { scope: scopeMetadata(scope, values.reduce((sum, value) => sum + Number(value.records), 0)), rows: values, generatedAt: new Date().toISOString() };
  }, { ...options, response: AttendanceDailyResponseSchema });

  app.get("/api/analytics/attendance/students", (ctx: Context) => {
    const user = authorized(ctx);
    if (!user) return { detail: "Insufficient permissions" };
    const scope = buildScope(context, ctx.query);
    if (!scope) return fail(ctx.set, "The attendance analytics scope is invalid.");
    const query = ctx.query as Row;
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(query.page_size ?? 25)));
    const sort = String(query.sort ?? "name");
    const direction = String(query.order ?? "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
    const result = studentRows(context, scope, String(query.search ?? "").trim(), sort, direction, page, pageSize);
    return { scope: scopeMetadata(scope, result.records), total: result.total, page, pageSize, rows: result.rows, generatedAt: new Date().toISOString() };
  }, { ...options, response: AttendanceStudentsResponseSchema });

  app.get("/api/analytics/attendance/export-excel", async (ctx: Context) => {
    const user = authorized(ctx);
    if (!user) return { detail: "Insufficient permissions" };
    const scope = buildScope(context, ctx.query);
    if (!scope) return fail(ctx.set, "The attendance analytics scope is invalid.");
    const value = aggregate(context, scope, "overview");
    const counts = countsFrom(value);
    const total = totalRecords(counts);
    const workbook = createWorkbook({ exportType: "attendance-analytics" });
    const summary = addWorksheet(workbook, "Summary");
    appendRow(summary, ["Metric", "Value"]); appendRow(summary, ["Date range", `${scope.dateFrom} – ${scope.dateTo}`]); appendRow(summary, ["Academic year", scope.academicYearLabel]); appendRow(summary, ["Total records", total]);
    for (const [label, amount] of [["Present", counts.present], ["Late", counts.late], ["Incomplete", counts.incomplete], ["Absent", counts.absent], ["Sakit", counts.sakit], ["Izin", counts.izin], ["Alfa", counts.alfa], ["Unrecorded", counts.unrecorded]] as const) appendRow(summary, [label, amount]);
    appendRow(summary, ["Attendance rate %", attendanceRate(counts)]); appendRow(summary, ["Tardiness rate %", tardinessRate(counts)]); appendRow(summary, ["Unexcused absence rate %", unexcusedAbsenceRate(counts)]); appendRow(summary, ["Override-corrected records", Number(value.overridden ?? 0)]); appendRow(summary, ["HEB total", hebTotal(context, scope)]);
    styleHeader(summary); autoSizeColumns(summary, 16, 34);

    const classRows = groupedRows(context, scope, "class");
    const classSheet = addWorksheet(workbook, "By Class");
    appendRow(classSheet, ["Class", "Students", "Present", "Late", "Incomplete", "Absent", "Sakit", "Izin", "Alfa", "Attendance rate %", "Tardiness rate %", "Unexcused absence rate %"]);
    for (const value of classRows) appendRow(classSheet, [value.className, value.students, value.counts.present, value.counts.late, value.counts.incomplete, value.counts.absent, value.counts.sakit, value.counts.izin, value.counts.alfa, value.attendanceRate, value.tardinessRate, value.unexcusedAbsenceRate]);
    styleHeader(classSheet); autoSizeColumns(classSheet, 10, 22);

    const jenjangRows = groupedRows(context, scope, "jenjang");
    const jenjangSheet = addWorksheet(workbook, "By Jenjang");
    appendRow(jenjangSheet, ["Jenjang", "Students", "Present", "Late", "Incomplete", "Absent", "Sakit", "Izin", "Alfa", "Attendance rate %", "Tardiness rate %", "Unexcused absence rate %"]);
    for (const value of jenjangRows) appendRow(jenjangSheet, [value.jenjang, value.students, value.counts.present, value.counts.late, value.counts.incomplete, value.counts.absent, value.counts.sakit, value.counts.izin, value.counts.alfa, value.attendanceRate, value.tardinessRate, value.unexcusedAbsenceRate]);
    styleHeader(jenjangSheet); autoSizeColumns(jenjangSheet, 10, 22);

    const dailyRows = groupedRows(context, scope, "daily");
    const dailySheet = addWorksheet(workbook, "Daily");
    appendRow(dailySheet, ["Date", "Records", "Present", "Late", "Incomplete", "Absent", "Sakit", "Izin", "Alfa", "Attendance rate %"]);
    for (const value of dailyRows) appendRow(dailySheet, [value.date, value.records, value.counts.present, value.counts.late, value.counts.incomplete, value.counts.absent, value.counts.sakit, value.counts.izin, value.counts.alfa, value.attendanceRate]);
    styleHeader(dailySheet); autoSizeColumns(dailySheet, 12, 20);

    const students = studentRows(context, scope, "", "name", "ASC", 1, 200).rows;
    const studentSheet = addWorksheet(workbook, "By Student");
    appendRow(studentSheet, ["Student", "Class", "Present", "Late", "Incomplete", "Absent", "Sakit", "Izin", "Alfa", "Attendance rate %", "Tardiness rate %", "Unexcused absence rate %"]);
    for (const value of students) appendRow(studentSheet, [value.studentName, value.className ?? "No class", value.counts.present, value.counts.late, value.counts.incomplete, value.counts.absent, value.counts.sakit, value.counts.izin, value.counts.alfa, value.attendanceRate, value.tardinessRate, value.unexcusedAbsenceRate]);
    styleHeader(studentSheet); autoSizeColumns(studentSheet, 12, 22);

    const bytes = await writeXlsxWorkbook(workbook);
    auditExport(context, user, scope, total);
    return new Response(bytes, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${safeExportFilename(`analytics_absensi_${scope.dateFrom}_${scope.dateTo}`, "xlsx")}"`, "cache-control": "no-store, no-cache, must-revalidate, private" } });
  }, options);
}
