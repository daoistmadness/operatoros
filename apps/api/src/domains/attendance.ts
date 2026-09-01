import { createHash, randomUUID } from "node:crypto";
import { addWorksheet, appendRow, autoSizeColumns, createWorkbook, safeExportFilename, styleHeader, writeXlsxWorkbook } from "@operatoros/excel";
import { t } from "elysia";
import {
  AttendanceCorrectionRequestSchema,
  AttendanceCorrectionReviewQuerySchema,
  AttendanceCorrectionReviewResponseSchema,
  type AttendanceCorrectionReviewItem,
  type AttendanceCorrectionReviewResponse,
} from "@operatoros/contracts/attendance";
import { inTransaction } from "@operatoros/db";
import { actor } from "./core";
import { insertCanonicalAttendanceRecord } from "./attendance-rules";
import { capabilitiesForRole } from "../auth/capabilities";
import type { AuthContext, CurrentUser } from "../auth/service";
import { earlyDepartureRoutes } from "./early-departure";

type Row = Record<string, any>;
type Context = any;
const statuses = ["on-time", "late", "absent", "incomplete"] as const;
const manualStatuses = [...statuses, "sakit", "izin", "alfa"] as const;

function rows(context: AuthContext, sql: string, params: any[] = []): Row[] { return context.database.client.query(sql).all(...params) as Row[]; }
function row(context: AuthContext, sql: string, params: any[] = []): Row | null { return (context.database.client.query(sql).get(...params) as Row | null) ?? null; }
function fail(set: any, status: number, detail: string | Record<string, unknown>): { detail: string | Record<string, unknown> } { set.status = status; return { detail }; }
function validation(set: any, details: Record<string, unknown>[]): { detail: Record<string, unknown>[] } { set.status = 422; return { detail: details }; }
function time(value: string | null): string | null { return value ? value.slice(0, 5) : null; }
function validAttendanceDate(value: unknown): value is string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }
function parsePositiveInteger(value: unknown, fallback: number): number { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function periodOpen(context: AuthContext, date: string): boolean { return !row(context, "SELECT id FROM attendance_periods WHERE attendance_date = ? AND status = 'FINALIZED'", [date]); }
function currentStatus(value: Row): string { return value.override_status ?? value.status; }
function snapshot(value: Row): Row { return { attendance_id: value.id, status: currentStatus(value), check_in: time(value.override_check_in ?? value.check_in), check_out: time(value.override_check_out ?? value.check_out), override_id: value.override_id ?? null, override_reviewed_at: value.reviewed_at ?? null }; }
function fingerprint(value: Row): string { return createHash("sha256").update(JSON.stringify(value, Object.keys(value).sort())).digest("hex"); }
function requestPayload(context: AuthContext, value: Row): Row {
  return { id: value.id, attendance_id: value.attendance_id, original_snapshot: JSON.parse(value.original_snapshot), proposed_status: value.proposed_status, proposed_check_in: time(value.proposed_check_in), proposed_check_out: time(value.proposed_check_out), reason_code: value.reason_code, explanation: value.explanation, requester: value.requester, submitted_at: value.submitted_at, state: value.state, version: value.version, approver: value.approver, decided_at: value.decided_at, rejection_reason: value.rejection_reason, resulting_override_id: value.resulting_override_id, created_at: value.created_at, updated_at: value.updated_at, audit: rows(context, "SELECT action, prior_state, new_state, actor, reason_code, created_at FROM attendance_correction_audit WHERE request_id = ? ORDER BY id", [value.id]) };
}

function appLink(path: string, values: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function correctionReviewRoutes(app: any, context: AuthContext): void {
  app.get("/api/attendance/override-review", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_attendance_corrections" });
    if (!user) return { detail: "Insufficient permissions" };

    const query = ctx.query as Row;
    const defaultYear = row(context, "SELECT id, label, start_date, end_date FROM academic_years WHERE is_default = 1 LIMIT 1");
    const academicYearId = Number(query.academic_year_id ?? defaultYear?.id ?? 0);
    const academicYear = row(context, "SELECT id, label, start_date, end_date FROM academic_years WHERE id = ?", [academicYearId]);
    if (!academicYear) return fail(ctx.set, 400, "The academic year scope is invalid.");

    const jenjangId = query.jenjang_id === undefined ? null : Number(query.jenjang_id);
    const classId = query.class_id === undefined ? null : Number(query.class_id);
    if (jenjangId !== null && (!Number.isInteger(jenjangId) || jenjangId < 1)) return fail(ctx.set, 400, "The jenjang scope is invalid.");
    if (classId !== null && (!Number.isInteger(classId) || classId < 1)) return fail(ctx.set, 400, "The class scope is invalid.");

    const dateFrom = String(query.date_from ?? academicYear.start_date);
    const dateTo = String(query.date_to ?? academicYear.end_date);
    if (!validAttendanceDate(dateFrom) || !validAttendanceDate(dateTo) || dateFrom > dateTo) return fail(ctx.set, 400, "The attendance date range is invalid.");

    const allowedStatuses = new Set<string>(manualStatuses);
    for (const key of ["base_status", "effective_status"]) {
      if (query[key] !== undefined && !allowedStatuses.has(String(query[key]))) return fail(ctx.set, 400, `The ${key} filter is invalid.`);
    }

    const page = parsePositiveInteger(query.page, 1);
    const pageSize = Math.min(100, parsePositiveInteger(query.page_size, 25));
    const filters = [
      "a.date >= ?",
      "a.date <= ?",
      "a.date >= COALESCE(e.effective_from, '0000-01-01')",
      "a.date <= COALESCE(e.effective_to, '9999-12-31')",
    ];
    const params: unknown[] = [academicYearId, dateFrom, dateTo];
    if (jenjangId !== null) { filters.push("e.jenjang_id = ?"); params.push(jenjangId); }
    if (classId !== null) { filters.push("e.academic_class_id = ?"); params.push(classId); }
    if (query.base_status !== undefined) { filters.push("o.original_status = ?"); params.push(String(query.base_status)); }
    if (query.effective_status !== undefined) { filters.push("COALESCE(o.override_status, a.status) = ?"); params.push(String(query.effective_status)); }
    const search = String(query.student_search ?? "").trim().toLowerCase();
    if (search) { filters.push("lower(s.name) LIKE ?"); params.push(`%${search}%`); }
    if (user.role !== "admin") {
      filters.push(`EXISTS (
        SELECT 1 FROM teacher_class_assignments ta
         WHERE ta.user_id = ? AND ta.academic_year_id = e.academic_year_id
           AND ta.academic_class_id = e.academic_class_id AND ta.active = 1
           AND (ta.effective_from IS NULL OR ta.effective_from <= a.date)
           AND (ta.effective_to IS NULL OR ta.effective_to >= a.date)
      )`);
      params.push(user.id);
    }
    const baseSql = `WITH ranked AS (
      SELECT a.id AS attendance_id, a.student_id, e.student_master_id, a.date,
             o.id AS override_id, o.original_status AS base_status,
             COALESCE(o.override_status, a.status) AS effective_status,
             o.note AS correction_note, o.reviewed_by, o.reviewed_at,
             o.override_check_in, o.override_check_out,
             s.name AS student_name, e.academic_class_id AS class_id,
             COALESCE(c.class_name, e.class_name, s.class_name) AS class_name,
             j.name AS jenjang,
             ROW_NUMBER() OVER (
               PARTITION BY a.id
               ORDER BY CASE WHEN e.effective_from IS NULL THEN 1 ELSE 0 END,
                        e.effective_from DESC, e.id DESC
             ) AS enrollment_rank
        FROM attendance a
        JOIN attendance_overrides o ON o.attendance_id = a.id
        JOIN students s ON s.id = a.student_id
        JOIN student_enrollments e
          ON e.student_id = a.student_id
         AND e.academic_year_id = ?
        LEFT JOIN academic_classes c ON c.id = e.academic_class_id
        LEFT JOIN jenjangs j ON j.id = e.jenjang_id
       WHERE ${filters.join(" AND ")}
    ), selected AS (
      SELECT * FROM ranked WHERE enrollment_rank = 1
    )`;
    const count = Number(row(context, `${baseSql} SELECT COUNT(*) AS total FROM selected`, params)?.total ?? 0);
    const offset = (page - 1) * pageSize;
    const values = rows(context, `${baseSql}
      SELECT * FROM selected
       ORDER BY date DESC, lower(student_name), attendance_id DESC
       LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
    const canEdit = capabilitiesForRole(user.role).includes("manage_attendance");
    const items: AttendanceCorrectionReviewItem[] = values.map((value) => {
      const resolvedClassId = value.class_id === null || value.class_id === undefined ? null : Number(value.class_id);
      const date = String(value.date);
      const studentId = Number(value.student_id);
      const studentMasterId = value.student_master_id === null || value.student_master_id === undefined ? null : String(value.student_master_id);
      return {
        attendanceId: Number(value.attendance_id),
        studentId,
        studentMasterId,
        studentName: String(value.student_name),
        classId: resolvedClassId,
        className: String(value.class_name ?? "Unknown class"),
        jenjang: value.jenjang === null || value.jenjang === undefined ? null : String(value.jenjang),
        academicYearId,
        date,
        baseStatus: String(value.base_status),
        effectiveStatus: String(value.effective_status),
        correction: {
          id: Number(value.override_id),
          note: String(value.correction_note),
          reviewedBy: String(value.reviewed_by),
          reviewedAt: String(value.reviewed_at),
          overrideCheckIn: value.override_check_in ? String(value.override_check_in).slice(0, 5) : null,
          overrideCheckOut: value.override_check_out ? String(value.override_check_out).slice(0, 5) : null,
          active: true,
        },
        canEdit,
        links: {
          correctionReview: appLink("/attendance/override-review", { academic_year_id: academicYearId, class_id: resolvedClassId, date_from: dateFrom, date_to: dateTo }),
          editCorrection: canEdit && resolvedClassId !== null ? appLink("/attendance-review", { academic_year_id: academicYearId, academic_class_id: resolvedClassId, date }) : null,
          student360: studentMasterId ? `/students/${encodeURIComponent(studentMasterId)}` : `/attendance/students/${studentId}`,
          class360: resolvedClassId === null ? null : appLink(`/classes/${resolvedClassId}`, { attendance_date_from: date, attendance_date_to: date }),
          dailyAttendance: appLink("/attendance/daily", { date, academic_year_id: academicYearId, class_id: resolvedClassId }),
        },
      };
    });
    const response: AttendanceCorrectionReviewResponse = {
      scope: { academicYearId, academicYearLabel: String(academicYear.label), jenjangId, classId, dateFrom, dateTo },
      summary: { corrections: count }, total: count, page, pageSize, items,
    };
    return response;
  }, { query: AttendanceCorrectionReviewQuerySchema, response: AttendanceCorrectionReviewResponseSchema });
}

function reviewRoutes(app: any, context: AuthContext): void {
  app.get("/api/review/classes", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_attendance" }); if (!user) return { detail: "Insufficient permissions" };
    const year = Number(ctx.query.academic_year_id ?? row(context, "SELECT id FROM academic_years WHERE is_default = 1 LIMIT 1")?.id ?? 0);
    return { classes: year ? rows(context, "SELECT id, class_name AS name FROM academic_classes WHERE academic_year_id = ? AND active = 1 ORDER BY class_name", [year]) : rows(context, "SELECT -1 AS id, class_name AS name FROM students WHERE class_name IS NOT NULL GROUP BY class_name ORDER BY class_name") };
  }, { query: t.Object({ academic_year_id: t.Optional(t.String()) }) });
  app.get("/api/review/attendance", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_attendance" }); if (!user) return { detail: "Insufficient permissions" };
    const classId = Number(ctx.query.academic_class_id); const date = ctx.query.date; const classRow = row(context, "SELECT class_name FROM academic_classes WHERE id = ?", [classId]);
    if (!classRow) return fail(ctx.set, 404, "Class not found");
    const values = rows(context, "SELECT a.id AS attendance_id, a.student_id, s.name AS student_name, s.class_name, a.date, a.check_in, a.check_out, a.status, o.original_status AS override_original_status, o.override_status, o.note AS override_note, o.reviewed_by, o.reviewed_at FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN attendance_overrides o ON o.attendance_id = a.id JOIN student_enrollments e ON e.student_id = a.student_id WHERE a.date = ? AND e.academic_year_id = ? AND e.academic_class_id = ? ORDER BY s.name", [date, Number(ctx.query.academic_year_id), classId]);
    return { date, class_name: classRow.class_name, total: values.length, items: values.map((value) => ({ attendance_id: value.attendance_id, student_id: value.student_id, student_name: value.student_name, class_name: value.class_name, date: value.date, scan_in: time(value.check_in), scan_out: time(value.check_out), original_status: value.override_original_status ?? value.status, effective_status: value.override_status ?? value.status, is_overridden: value.override_status !== null, current_status: value.override_status ?? value.status, override_status: value.override_status, override_note: value.override_note, reviewed_by: value.reviewed_by, reviewed_at: value.reviewed_at })) };
  }, { query: t.Object({ date: t.String(), academic_year_id: t.String(), academic_class_id: t.String() }) });
  app.post("/api/review/attendance/:attendance_id/override", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "manage_attendance" }); if (!user) return { detail: "Insufficient permissions" };
    const status = String(ctx.body.override_status).trim(); const note = String(ctx.body.note).trim(); const attendance = row(context, "SELECT * FROM attendance WHERE id = ?", [ctx.params.attendance_id]);
    if (!attendance) return fail(ctx.set, 404, "Attendance not found");
    if (!(statuses as readonly string[]).includes(status)) return fail(ctx.set, 400, `override_status must be one of ${statuses.join(", ")}`);
    if (note.length < 5) return validation(ctx.set, [{ type: "string_too_short", loc: ["body", "note"], msg: "String should have at least 5 characters", input: note, ctx: { min_length: 5 } }]);
    if (!periodOpen(context, attendance.date)) return fail(ctx.set, 409, "Attendance period is finalized and must be reopened.");
    const client = context.database.client; const existing = row(context, "SELECT * FROM attendance_overrides WHERE attendance_id = ?", [attendance.id]); const now = new Date().toISOString();
    try {
      inTransaction(client, () => {
        if (existing) { client.run("INSERT INTO attendance_override_history (override_id, attendance_id, previous_status, new_status, previous_values, new_values, note, reviewed_by, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [existing.id, attendance.id, existing.override_status, status, null, null, note, user.username, now]); client.run("UPDATE attendance_overrides SET override_status = ?, note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?", [status, note, user.username, now, existing.id]); }
        else { const created = client.run("INSERT INTO attendance_overrides (attendance_id, original_status, override_status, note, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)", [attendance.id, attendance.status, status, note, user.username, now]); client.run("INSERT INTO attendance_override_history (override_id, attendance_id, previous_status, new_status, previous_values, new_values, note, reviewed_by, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [Number(created.lastInsertRowid), attendance.id, attendance.status, status, null, null, note, user.username, now]); }
      });
      const override = row(context, "SELECT * FROM attendance_overrides WHERE attendance_id = ?", [attendance.id]);
      return { attendance_id: attendance.id, original_status: override?.original_status, override_status: override?.override_status, effective_status: override?.override_status, note: override?.note, reviewed_by: override?.reviewed_by, reviewed_at: override?.reviewed_at };
    } catch { return fail(ctx.set, 409, "Override conflict detected. Please retry."); }
  }, { params: t.Object({ attendance_id: t.Number({ minimum: 1 }) }), body: t.Object({ override_status: t.String(), note: t.String() }) });
  app.get("/api/review/attendance/:attendance_id/history", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_attendance" }); if (!user) return { detail: "Insufficient permissions" };
    if (!row(context, "SELECT id FROM attendance WHERE id = ?", [ctx.params.attendance_id])) return fail(ctx.set, 404, "Attendance not found");
    return { attendance_id: Number(ctx.params.attendance_id), items: rows(context, "SELECT id, attendance_id, previous_status, new_status, note, reviewed_by, timestamp FROM attendance_override_history WHERE attendance_id = ? ORDER BY timestamp DESC, id DESC", [ctx.params.attendance_id]) };
  }, { params: t.Object({ attendance_id: t.Number({ minimum: 1 }) }) });
  app.post("/api/review/attendance/mass-override-incomplete", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "manage_attendance" }); if (!user) return { detail: "Insufficient permissions" };
    const status = String(ctx.body.override_status).trim(); const note = String(ctx.body.note).trim();
    if (!(status === "on-time" || status === "late")) return fail(ctx.set, 400, "override_status for mass override must be 'on-time' or 'late'");
    if (note.length < 5) return fail(ctx.set, 400, "note must be at least 5 characters");
    const candidates = rows(context, "SELECT a.*, o.id AS override_id, o.override_status FROM attendance a LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE coalesce(o.override_status, a.status) = 'incomplete' AND a.check_in IS NOT NULL");
    const client = context.database.client; let overridden = 0; let skipped = 0; const now = new Date().toISOString();
    try { inTransaction(client, () => { for (const attendance of candidates) { if (!periodOpen(context, attendance.date)) { skipped++; continue; } if (attendance.override_id) { client.run("INSERT INTO attendance_override_history (override_id, attendance_id, previous_status, new_status, note, reviewed_by, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)", [attendance.override_id, attendance.id, attendance.override_status, status, note, user.username, now]); client.run("UPDATE attendance_overrides SET override_status = ?, note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?", [status, note, user.username, now, attendance.override_id]); } else { const created = client.run("INSERT INTO attendance_overrides (attendance_id, original_status, override_status, note, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)", [attendance.id, attendance.status, status, note, user.username, now]); client.run("INSERT INTO attendance_override_history (override_id, attendance_id, previous_status, new_status, note, reviewed_by, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)", [Number(created.lastInsertRowid), attendance.id, attendance.status, status, note, user.username, now]); } overridden++; } }); return { overridden, skipped, note, reviewed_by: user.username, reviewed_at: now }; } catch { return fail(ctx.set, 409, "Mass override could not be saved."); }
  }, { body: t.Object({ override_status: t.String(), note: t.String() }) });
}

function scopedRoutes(app: any, context: AuthContext): void {
  app.get("/api/attendance/classes/assigned", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_attendance" }); if (!user) return { detail: "Insufficient permissions" };
    const year = ctx.query.academic_year_id ? Number(ctx.query.academic_year_id) : Number(row(context, "SELECT id FROM academic_years WHERE is_default = 1 LIMIT 1")?.id ?? 0);
    const values = user.role === "admin" ? rows(context, "SELECT id, class_name, academic_year_id, 'ADMINISTRATOR' AS role_in_class FROM academic_classes WHERE active = 1 AND (? = 0 OR academic_year_id = ?) ORDER BY class_name", [year, year]) : rows(context, "SELECT c.id, c.class_name, c.academic_year_id, a.class_role AS role_in_class FROM academic_classes c JOIN teacher_class_assignments a ON a.academic_class_id = c.id WHERE a.user_id = ? AND a.active = 1 AND c.active = 1 AND (? = 0 OR c.academic_year_id = ?) ORDER BY c.class_name", [user.id, year, year]);
    return { classes: values };
  }, { query: t.Object({ academic_year_id: t.Optional(t.String()) }) });
  app.get("/api/attendance/classes/:class_id/attendance/export-excel", async (ctx: Context) => {
    const user = actor(context, ctx, { capability: "export_assigned_class_attendance" }); if (!user) return { detail: "Insufficient permissions" };
    const classRow = row(context, "SELECT id, class_name, active FROM academic_classes WHERE id = ?", [ctx.params.class_id]); if (!classRow || !classRow.active) return fail(ctx.set, 404, "Class is inactive, archived, or unknown.");
    if (user.role !== "admin" && !row(context, "SELECT id FROM teacher_class_assignments WHERE user_id = ? AND academic_class_id = ? AND active = 1", [user.id, ctx.params.class_id])) return fail(ctx.set, 403, "Insufficient permissions");
    const month = String(ctx.query.month).padStart(2, "0"); const year = String(ctx.query.year);
    if (Number(month) < 1 || Number(month) > 12) return fail(ctx.set, 400, "month must be between 1 and 12");
    if (!/^\d{4}$/.test(year) || Number(year) < 2020) return fail(ctx.set, 400, "year must be greater than or equal to 2020");
    const jenjangRow = row(context, "SELECT j.name AS jenjang FROM academic_classes c JOIN academic_grades g ON g.id = c.grade_id JOIN jenjangs j ON j.id = g.jenjang_id WHERE c.id = ?", [ctx.params.class_id]);
    const jenjang = String(jenjangRow?.jenjang ?? "Unassigned");
    const rangeStart = `${year}-${month}-01`; const rangeEnd = `${year}-${month}-31`;
    const values = rows(context, "SELECT e.student_id, s.name AS student_name, a.date, a.check_in, a.check_out, a.late_duration, a.status AS raw_status, o.override_status, o.override_check_in, o.override_check_out, o.note, o.reviewed_by FROM student_enrollments e JOIN students s ON s.id = e.student_id LEFT JOIN attendance a ON a.student_id = e.student_id AND a.date >= ? AND a.date <= ? LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE e.academic_class_id = ? AND e.lifecycle_state = 'ACTIVE' AND (e.effective_from IS NULL OR e.effective_from <= ?) AND (e.effective_to IS NULL OR e.effective_to >= ?) ORDER BY s.name, a.date", [rangeStart, rangeEnd, ctx.params.class_id, rangeEnd, rangeStart]);
    const hebOverride = row(context, "SELECT heb_value FROM heb_overrides WHERE jenjang = ? AND month = ? AND year = ?", [jenjang, Number(month), Number(year)]);
    const heb = hebOverride ? Number(hebOverride.heb_value) : new Set(values.filter((v) => v.date).map((v) => String(v.date))).size;
    const statusOf = (value: Row): string => { if (value.override_status) return String(value.override_status); if (value.raw_status) return String(value.raw_status); return "unrecorded"; };
    const students = new Map<number, { name: string; days: Row[] }>();
    for (const value of values) { const entry = students.get(Number(value.student_id)) ?? { name: String(value.student_name), days: [] }; if (value.date) entry.days.push(value); students.set(Number(value.student_id), entry); }
    const workbook = createWorkbook({ exportType: "assigned-class-attendance" });
    const recap = addWorksheet(workbook, "Rekap Siswa");
    appendRow(recap, ["Siswa", "Hadir", "Terlambat", "Absen", "Tidak Lengkap", "Sakit", "Izin", "Alfa", "HEB", "Tingkat Kehadiran"]);
    for (const [studentId, entry] of students) {
      const count = (target: string) => entry.days.filter((value) => statusOf(value) === target).length;
      const attended = entry.days.filter((value) => statusOf(value) !== "absent" && statusOf(value) !== "unrecorded").length;
      const reason = row(context, "SELECT COALESCE(SUM(sakit),0) AS sakit, COALESCE(SUM(izin),0) AS izin, COALESCE(SUM(alfa),0) AS alfa FROM absence_reasons WHERE student_id = ? AND month = ? AND year = ?", [studentId, Number(month), Number(year)]);
      appendRow(recap, [entry.name, count("on-time"), count("late"), count("absent"), count("incomplete"), Number(reason?.sakit ?? 0), Number(reason?.izin ?? 0), Number(reason?.alfa ?? 0), heb, heb > 0 ? Number(((count("on-time") + count("late")) / heb).toFixed(3)) : ""]);
    }
    styleHeader(recap); autoSizeColumns(recap, 10, 22);
    const detail = addWorksheet(workbook, "Rincian Harian");
    appendRow(detail, ["Siswa", "Tanggal", "Status", "Jam Masuk", "Jam Pulang", "Terlambat", "Koreksi Manual", "Catatan"]);
    for (const value of values.filter((value) => value.date)) {
      appendRow(detail, [value.student_name, value.date, statusOf(value), value.override_check_in ?? (value.check_in ? String(value.check_in).slice(0, 5) : null), value.override_check_out ?? (value.check_out ? String(value.check_out).slice(0, 5) : null), `${String(Math.floor(Number(value.late_duration ?? 0) / 60)).padStart(2, "0")}:${String(Number(value.late_duration ?? 0) % 60).padStart(2, "0")}`, value.override_status ? "Ya" : "Tidak", value.note ?? ""]);
    }
    styleHeader(detail); autoSizeColumns(detail, 10, 24);
    const bytes = await writeXlsxWorkbook(workbook);
    context.database.client.run("INSERT INTO operations_audit_events (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source, export_scope, success, failure_code, metadata, schema_version) VALUES (?, ?, ?, 'export_assigned_class_attendance', 'ATTENDANCE_EXPORT', ?, 'EXPORT_ASSIGNED_CLASS_ATTENDANCE', 'MEDIUM', 'API', ?, 1, NULL, ?, '1')", [randomUUID(), user.username, user.role, `CLASS_ATTENDANCE/${ctx.params.class_id}`, `CLASS/${ctx.params.class_id}/${year}-${month}`, JSON.stringify({ class_id: Number(ctx.params.class_id), class_name: classRow.class_name, month: Number(month), year: Number(year), students_exported: students.size, rows_exported: values.filter((value) => value.date).length })]);
    return new Response(bytes, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${safeExportFilename(`absensi_kelas_${classRow.class_name}_${year}-${month}`, "xlsx")}"`, "cache-control": "no-store, no-cache, must-revalidate, private" } });
  }, { params: t.Object({ class_id: t.Number({ minimum: 1 }) }), query: t.Object({ month: t.String(), year: t.String() }) });
  app.get("/api/attendance/classes/:class_id/dates/:date_val", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_attendance" }); if (!user) return { detail: "Insufficient permissions" };
    const classRow = row(context, "SELECT id, class_name, academic_year_id, active FROM academic_classes WHERE id = ?", [ctx.params.class_id]); if (!classRow || !classRow.active) return fail(ctx.set, 400, "Class is inactive or archived.");
    const values = rows(context, "SELECT e.student_id, s.name AS student_name, a.id AS attendance_id, a.status AS raw_status, a.check_in, a.check_out, a.is_absent, o.override_status FROM student_enrollments e JOIN students s ON s.id = e.student_id LEFT JOIN attendance a ON a.student_id = e.student_id AND a.date = ? LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE e.academic_class_id = ? AND e.lifecycle_state = 'ACTIVE' AND (e.effective_from IS NULL OR e.effective_from <= ?) AND (e.effective_to IS NULL OR e.effective_to >= ?) ORDER BY s.name", [ctx.params.date_val, ctx.params.class_id, ctx.params.date_val, ctx.params.date_val]);
    const finalized = Boolean(row(context, "SELECT id FROM attendance_periods WHERE attendance_date = ? AND status = 'FINALIZED'", [ctx.params.date_val]));
    return { class_id: Number(ctx.params.class_id), class_name: classRow.class_name, date: ctx.params.date_val, is_finalized: finalized, total_enrolled: values.length, items: values.map((value) => ({ student_id: value.student_id, student_name: value.student_name, attendance_id: value.attendance_id, raw_status: value.raw_status ?? "unrecorded", effective_status: value.override_status ?? value.raw_status ?? "unrecorded", is_overridden: value.override_status !== null, scan_in: time(value.check_in), scan_out: time(value.check_out), is_absent: Boolean(value.is_absent), pending_correction: false, correction_request_id: null })) };
  }, { params: t.Object({ class_id: t.Number({ minimum: 1 }), date_val: t.String() }) });
  app.post("/api/attendance/classes/:class_id/dates/:date_val/entries", (ctx: Context) => {
    const user = actor(context, ctx, {}); if (!user) return { detail: "Insufficient permissions" };
    if (user.role !== "admin" && !capabilitiesForRole(user.role).includes("enter_assigned_class_attendance")) return fail(ctx.set, 403, "Insufficient permissions");
    const classRow = row(context, "SELECT id, academic_year_id, active FROM academic_classes WHERE id = ?", [ctx.params.class_id]); if (!classRow || !classRow.active) return fail(ctx.set, 400, "Class is inactive or archived.");
    if (user.role !== "admin" && !row(context, "SELECT id FROM teacher_class_assignments WHERE user_id = ? AND academic_class_id = ? AND active = 1", [user.id, ctx.params.class_id])) return fail(ctx.set, 403, "Insufficient permissions");
    if (!periodOpen(context, ctx.params.date_val)) return fail(ctx.set, 400, "Attendance for target date is finalized and locked.");
    const client = context.database.client; const entries = ctx.body.entries; const seen = new Set<number>(); const enrolled = new Set(rows(context, "SELECT student_id FROM student_enrollments WHERE academic_class_id = ? AND lifecycle_state = 'ACTIVE' AND (effective_from IS NULL OR effective_from <= ?) AND (effective_to IS NULL OR effective_to >= ?)", [ctx.params.class_id, ctx.params.date_val, ctx.params.date_val]).map((value) => Number(value.student_id)));
    for (const entry of entries) { if (seen.has(entry.student_id)) return fail(ctx.set, 400, `Duplicate entry for student ID ${entry.student_id}.`); seen.add(entry.student_id); if (!enrolled.has(entry.student_id)) return fail(ctx.set, 400, `Student ID ${entry.student_id} is not effectively enrolled in class on target date.`); if (!(manualStatuses as readonly string[]).includes(entry.status.trim().toLowerCase())) return fail(ctx.set, 400, `Status '${entry.status}' is invalid.`); }
    try { let created = 0; let updated = 0; inTransaction(client, () => { for (const entry of entries) { const status = entry.status.trim().toLowerCase(); const existing = row(context, "SELECT id FROM attendance WHERE student_id = ? AND date = ?", [entry.student_id, ctx.params.date_val]); if (existing) { client.run("UPDATE attendance SET status = ?, check_in = ?, check_out = ?, is_absent = ?, late_source = ?, late_duration = ? WHERE id = ?", [status, entry.check_in ?? null, entry.check_out ?? null, ["absent", "sakit", "izin", "alfa"].includes(status) ? 1 : 0, status === "late" ? "manual" : "none", 0, existing.id]); updated++; } else { insertCanonicalAttendanceRecord(client, { studentId: entry.student_id, date: ctx.params.date_val, checkIn: entry.check_in ?? null, checkOut: entry.check_out ?? null, lateDuration: 0, lateSource: status === "late" ? "manual" : "none", status }); created++; } } }); return { class_id: Number(ctx.params.class_id), date: ctx.params.date_val, total_submitted: entries.length, created, updated, submitted_by: user.username }; } catch { return fail(ctx.set, 400, "Failed to save attendance entries transactionally. Operation rolled back."); }
  }, { params: t.Object({ class_id: t.Number({ minimum: 1 }), date_val: t.String() }), body: t.Object({ entries: t.Array(t.Object({ student_id: t.Number({ minimum: 1 }), status: t.String(), check_in: t.Optional(t.String()), check_out: t.Optional(t.String()), notes: t.Optional(t.String()) }), { minItems: 1 }) }) });
}

function correctionRoutes(app: any, context: AuthContext): void {
  const requestBody = AttendanceCorrectionRequestSchema;
  app.post("/api/attendance-corrections", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "request_attendance_correction" }); if (!user) return { detail: "Insufficient permissions" };
    const attendance = row(context, "SELECT * FROM attendance WHERE id = ?", [ctx.body.attendance_id]); if (!attendance) return fail(ctx.set, 404, "Attendance record was not found.");
    if (!(statuses as readonly string[]).includes(ctx.body.proposed_status)) return fail(ctx.set, 400, "Proposed attendance status is invalid.");
    if (row(context, "SELECT id FROM attendance_correction_requests WHERE attendance_id = ? AND state IN ('DRAFT', 'SUBMITTED')", [attendance.id])) return fail(ctx.set, 409, "An active correction request already exists.");
    const current = snapshot({ ...attendance, ...((row(context, "SELECT o.override_status, o.override_check_in, o.override_check_out, o.id AS override_id, o.reviewed_at FROM attendance_overrides o WHERE o.attendance_id = ?", [attendance.id]) ?? {})) }); const original = JSON.stringify(current); const client = context.database.client;
    try { let createdId = 0; inTransaction(client, () => { const result = client.run("INSERT INTO attendance_correction_requests (attendance_id, active_key, original_snapshot, original_fingerprint, proposed_status, proposed_check_in, proposed_check_out, reason_code, explanation, requester, state, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", [attendance.id, `attendance:${attendance.id}`, original, fingerprint(current), ctx.body.proposed_status, ctx.body.proposed_check_in ?? null, ctx.body.proposed_check_out ?? null, ctx.body.reason_code.trim(), ctx.body.explanation.trim(), user.username]); createdId = Number(result.lastInsertRowid); client.run("INSERT INTO attendance_correction_audit (request_id, action, prior_state, new_state, actor, effective_date, reason_code, explanation_summary, source_workflow, metadata_version, created_at) VALUES (?, 'CREATE', NULL, 'DRAFT', ?, ?, ?, ?, 'ATTENDANCE_CORRECTION', 1, CURRENT_TIMESTAMP)", [createdId, user.username, attendance.date, ctx.body.reason_code.trim(), ctx.body.explanation.trim().slice(0, 255)]); }); return requestPayload(context, row(context, "SELECT * FROM attendance_correction_requests WHERE id = ?", [createdId]) as Row); } catch { return fail(ctx.set, 409, "An active correction request already exists."); }
  }, { body: requestBody });
  app.get("/api/attendance-corrections", (ctx: Context) => { const user = actor(context, ctx, { capability: "view_attendance_corrections" }); if (!user) return { detail: "Insufficient permissions" }; const values = rows(context, `SELECT * FROM attendance_correction_requests ${ctx.query.state ? "WHERE state = ?" : ""} ORDER BY id DESC`, ctx.query.state ? [ctx.query.state.toUpperCase()] : []); return values.map((value) => requestPayload(context, value)); }, { query: t.Object({ state: t.Optional(t.String()) }) });
  app.get("/api/attendance-corrections/:request_id", (ctx: Context) => { const user = actor(context, ctx, { capability: "view_attendance_corrections" }); if (!user) return { detail: "Insufficient permissions" }; const value = row(context, "SELECT * FROM attendance_correction_requests WHERE id = ?", [ctx.params.request_id]); return value ? requestPayload(context, value) : fail(ctx.set, 404, "Correction request was not found."); }, { params: t.Object({ request_id: t.Number({ minimum: 1 }) }) });
  app.post("/api/attendance-corrections/:request_id/submit", (ctx: Context) => { const user = actor(context, ctx, { capability: "request_attendance_correction" }); if (!user) return { detail: "Insufficient permissions" }; const value = row(context, "SELECT * FROM attendance_correction_requests WHERE id = ?", [ctx.params.request_id]); if (!value || value.state !== "DRAFT" || value.requester !== user.username && user.role !== "admin") return fail(ctx.set, 409, { code: "ATTENDANCE_CORRECTION_NOT_REVIEWABLE", message: "Correction request cannot be submitted." }); context.database.client.run("UPDATE attendance_correction_requests SET state = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [value.id]); context.database.client.run("INSERT INTO attendance_correction_audit (request_id, action, prior_state, new_state, actor, effective_date, reason_code, explanation_summary, source_workflow, metadata_version, created_at) VALUES (?, 'SUBMIT', 'DRAFT', 'SUBMITTED', ?, (SELECT date FROM attendance WHERE id = ?), ?, ?, 'ATTENDANCE_CORRECTION', 1, CURRENT_TIMESTAMP)", [value.id, user.username, value.attendance_id, value.reason_code, value.explanation.slice(0, 255)]); return requestPayload(context, row(context, "SELECT * FROM attendance_correction_requests WHERE id = ?", [value.id]) as Row); }, { params: t.Object({ request_id: t.Number({ minimum: 1 }) }) });
  app.post("/api/attendance-corrections/:request_id/reject", (ctx: Context) => { const user = actor(context, ctx, { capability: "reject_attendance_correction" }); if (!user) return { detail: "Insufficient permissions" }; const value = row(context, "SELECT * FROM attendance_correction_requests WHERE id = ?", [ctx.params.request_id]); if (!value || value.state !== "SUBMITTED") return fail(ctx.set, 409, "Correction request is not reviewable."); const reason = ctx.body.rejection_reason.trim(); context.database.client.run("UPDATE attendance_correction_requests SET state = 'REJECTED', active_key = NULL, approver = ?, decided_at = CURRENT_TIMESTAMP, rejection_reason = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [user.username, reason, value.id]); context.database.client.run("INSERT INTO attendance_correction_audit (request_id, action, prior_state, new_state, actor, effective_date, reason_code, explanation_summary, source_workflow, metadata_version, created_at) VALUES (?, 'REJECT', 'SUBMITTED', 'REJECTED', ?, (SELECT date FROM attendance WHERE id = ?), ?, ?, 'ATTENDANCE_CORRECTION', 1, CURRENT_TIMESTAMP)", [value.id, user.username, value.attendance_id, value.reason_code, reason.slice(0, 255)]); return requestPayload(context, row(context, "SELECT * FROM attendance_correction_requests WHERE id = ?", [value.id]) as Row); }, { params: t.Object({ request_id: t.Number({ minimum: 1 }) }), body: t.Object({ rejection_reason: t.String({ minLength: 5, maxLength: 1000 }) }) });
  app.post("/api/attendance-corrections/:request_id/cancel", (ctx: Context) => { const user = actor(context, ctx, { capability: "cancel_attendance_correction" }); if (!user) return { detail: "Insufficient permissions" }; const value = row(context, "SELECT * FROM attendance_correction_requests WHERE id = ?", [ctx.params.request_id]); if (!value || !["DRAFT", "SUBMITTED"].includes(value.state) || value.requester !== user.username && user.role !== "admin") return fail(ctx.set, 409, "Correction request cannot be cancelled."); context.database.client.run("UPDATE attendance_correction_requests SET state = 'CANCELLED', active_key = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [value.id]); context.database.client.run("INSERT INTO attendance_correction_audit (request_id, action, prior_state, new_state, actor, effective_date, reason_code, explanation_summary, source_workflow, metadata_version, created_at) VALUES (?, 'CANCEL', ?, 'CANCELLED', ?, (SELECT date FROM attendance WHERE id = ?), ?, ?, 'ATTENDANCE_CORRECTION', 1, CURRENT_TIMESTAMP)", [value.id, value.state, user.username, value.attendance_id, value.reason_code, value.explanation.slice(0, 255)]); return requestPayload(context, row(context, "SELECT * FROM attendance_correction_requests WHERE id = ?", [value.id]) as Row); }, { params: t.Object({ request_id: t.Number({ minimum: 1 }) }) });
  app.post("/api/attendance-corrections/periods/finalize", (ctx: Context) => { const user = actor(context, ctx, { capability: "finalize_attendance_period" }); if (!user) return { detail: "Insufficient permissions" }; if (ctx.body.confirmation !== "FINALIZE_ATTENDANCE_PERIOD") return fail(ctx.set, 400, "Finalization confirmation is required."); const existing = row(context, "SELECT * FROM attendance_periods WHERE attendance_date = ?", [ctx.body.attendance_date]); const client = context.database.client; inTransaction(client, () => { if (!existing) { const result = client.run("INSERT INTO attendance_periods (attendance_date, status, finalized_by, finalized_at, reason, version) VALUES (?, 'FINALIZED', ?, CURRENT_TIMESTAMP, ?, 2)", [ctx.body.attendance_date, user.username, ctx.body.reason.trim()]); const created = row(context, "SELECT * FROM attendance_periods WHERE id = ?", [Number(result.lastInsertRowid)]) as Row; client.run("INSERT INTO attendance_period_audit (period_id, action, prior_status, new_status, actor, reason, prior_version, new_version, created_at) VALUES (?, 'FINALIZE', 'OPEN', 'FINALIZED', ?, ?, 1, 2, CURRENT_TIMESTAMP)", [created.id, user.username, ctx.body.reason.trim()]); } else { client.run("UPDATE attendance_periods SET status = 'FINALIZED', finalized_by = ?, finalized_at = CURRENT_TIMESTAMP, reason = ?, version = version + 1 WHERE id = ?", [user.username, ctx.body.reason.trim(), existing.id]); client.run("INSERT INTO attendance_period_audit (period_id, action, prior_status, new_status, actor, reason, prior_version, new_version, created_at) VALUES (?, 'REFINALIZE', ?, 'FINALIZED', ?, ?, ?, ?, CURRENT_TIMESTAMP)", [existing.id, existing.status, user.username, ctx.body.reason.trim(), existing.version, existing.version + 1]); } }); const value = row(context, "SELECT * FROM attendance_periods WHERE attendance_date = ?", [ctx.body.attendance_date]) as Row; return { attendance_date: value.attendance_date, status: value.status, version: value.version, finalized_by: value.finalized_by }; }, { body: t.Object({ attendance_date: t.String(), reason: t.String({ minLength: 5, maxLength: 1000 }), confirmation: t.String() }) });
  app.post("/api/attendance-corrections/periods/reopen", (ctx: Context) => { const user = actor(context, ctx, { capability: "reopen_attendance_period" }); if (!user) return { detail: "Insufficient permissions" }; if (ctx.body.confirmation !== "REOPEN_ATTENDANCE_PERIOD") return fail(ctx.set, 400, "Reopening confirmation is required."); const value = row(context, "SELECT * FROM attendance_periods WHERE attendance_date = ?", [ctx.body.attendance_date]); if (!value || value.status !== "FINALIZED") return fail(ctx.set, 409, "Attendance period is not finalized."); if (value.version !== ctx.body.expected_version) return fail(ctx.set, 409, "Attendance period changed; refresh and retry."); const nextVersion = value.version + 1; context.database.client.run("UPDATE attendance_periods SET status = 'OPEN', reopened_by = ?, reopened_at = CURRENT_TIMESTAMP, version = ? WHERE id = ?", [user.username, nextVersion, value.id]); context.database.client.run("INSERT INTO attendance_period_audit (period_id, action, prior_status, new_status, actor, reason, prior_version, new_version, created_at) VALUES (?, 'REOPEN', 'FINALIZED', 'OPEN', ?, ?, ?, ?, CURRENT_TIMESTAMP)", [value.id, user.username, ctx.body.reason.trim(), value.version, nextVersion]); return { attendance_date: value.attendance_date, status: "OPEN", version: nextVersion, reopened_by: user.username }; }, { body: t.Object({ attendance_date: t.String(), reason: t.String({ minLength: 5, maxLength: 1000 }), confirmation: t.String(), expected_version: t.Number({ minimum: 1 }) }) });
  app.get("/api/attendance-corrections/periods/status", (ctx: Context) => { const user = actor(context, ctx, { capability: "view_attendance_corrections" }); if (!user) return { detail: "Insufficient permissions" }; const value = row(context, "SELECT * FROM attendance_periods WHERE attendance_date = ?", [ctx.query.attendance_date]); if (!value) return { attendance_date: ctx.query.attendance_date, status: "OPEN", version: 0, audit: [] }; return { attendance_date: value.attendance_date, status: value.status, version: value.version, finalized_by: value.finalized_by, reopened_by: value.reopened_by, audit: rows(context, "SELECT action, actor, prior_status, new_status, created_at FROM attendance_period_audit WHERE period_id = ? ORDER BY id", [value.id]) }; }, { query: t.Object({ attendance_date: t.String() }) });
  app.post("/api/attendance-corrections/:request_id/approve", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "approve_attendance_correction" }); if (!user) return { detail: "Insufficient permissions" }; const body = ctx.body; if (!body || typeof body !== "object") return validation(ctx.set, [{ type: "missing", loc: ["body"], msg: "Field required", input: null }]); if (typeof body.confirmation !== "string") return validation(ctx.set, [{ type: "missing", loc: ["body", "confirmation"], msg: "Field required", input: body }]); if (body.confirmation !== "APPROVE_ATTENDANCE_CORRECTION") return fail(ctx.set, 400, "Approval confirmation is required."); const value = row(context, "SELECT * FROM attendance_correction_requests WHERE id = ?", [ctx.params.request_id]); if (!value || value.state !== "SUBMITTED") return fail(ctx.set, 409, "Correction request is not reviewable."); if (value.requester === user.username) return fail(ctx.set, 403, { code: "ATTENDANCE_CORRECTION_SELF_APPROVAL_FORBIDDEN", message: "Requester cannot approve their own correction." }); const attendance = row(context, "SELECT * FROM attendance WHERE id = ?", [value.attendance_id]); if (!attendance || !periodOpen(context, attendance.date)) return fail(ctx.set, 409, "Attendance period is finalized and must be reopened."); const old = JSON.parse(value.original_snapshot); const current = snapshot({ ...attendance, ...(row(context, "SELECT override_status, override_check_in, override_check_out, id AS override_id, reviewed_at FROM attendance_overrides WHERE attendance_id = ?", [attendance.id]) ?? {}) }); if (fingerprint(current) !== value.original_fingerprint) { context.database.client.run("UPDATE attendance_correction_requests SET state = 'STALE', active_key = NULL, version = version + 1 WHERE id = ?", [value.id]); return fail(ctx.set, 409, "Attendance changed after the request was created."); } const client = context.database.client; let override: Row | null = null; inTransaction(client, () => { const existing = row(context, "SELECT * FROM attendance_overrides WHERE attendance_id = ?", [attendance.id]); if (existing) { client.run("UPDATE attendance_overrides SET override_status = ?, override_check_in = ?, override_check_out = ?, note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?", [value.proposed_status, value.proposed_check_in, value.proposed_check_out, value.explanation, user.username, existing.id]); override = row(context, "SELECT * FROM attendance_overrides WHERE id = ?", [existing.id]); client.run("INSERT INTO attendance_override_history (override_id, attendance_id, previous_status, new_status, previous_values, new_values, note, reviewed_by, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)", [existing.id, attendance.id, old.status, value.proposed_status, JSON.stringify(old), JSON.stringify({ status: value.proposed_status, check_in: value.proposed_check_in, check_out: value.proposed_check_out }), value.explanation, user.username]); } else { const result = client.run("INSERT INTO attendance_overrides (attendance_id, original_status, override_status, override_check_in, override_check_out, note, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)", [attendance.id, attendance.status, value.proposed_status, value.proposed_check_in, value.proposed_check_out, value.explanation, user.username]); override = row(context, "SELECT * FROM attendance_overrides WHERE id = ?", [Number(result.lastInsertRowid)]); client.run("INSERT INTO attendance_override_history (override_id, attendance_id, previous_status, new_status, previous_values, new_values, note, reviewed_by, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)", [override?.id, attendance.id, attendance.status, value.proposed_status, JSON.stringify(old), JSON.stringify({ status: value.proposed_status, check_in: value.proposed_check_in, check_out: value.proposed_check_out }), value.explanation, user.username]); } client.run("UPDATE attendance_correction_requests SET state = 'APPROVED', active_key = NULL, approver = ?, decided_at = CURRENT_TIMESTAMP, resulting_override_id = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [user.username, override?.id, value.id]); client.run("INSERT INTO attendance_correction_audit (request_id, action, prior_state, new_state, actor, effective_date, reason_code, explanation_summary, source_workflow, metadata_version, created_at) VALUES (?, 'APPROVE', 'SUBMITTED', 'APPROVED', ?, ?, ?, ?, 'ATTENDANCE_CORRECTION', 1, CURRENT_TIMESTAMP)", [value.id, user.username, attendance.date, value.reason_code, value.explanation.slice(0, 255)]); }); return requestPayload(context, row(context, "SELECT * FROM attendance_correction_requests WHERE id = ?", [value.id]) as Row); }, { params: t.Object({ request_id: t.Number({ minimum: 1 }) }), body: t.Any() });
}

function selfConfirmRoute(app: any, context: AuthContext): void {
  app.post("/api/attendance-corrections/:request_id/self-confirm", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "approve_attendance_correction" }); if (!user) return { detail: "Insufficient permissions" };
    const body = ctx.body as Row;
    if (!body || typeof body !== "object") return validation(ctx.set, [{ type: "missing", loc: ["body"], msg: "Field required", input: null }]);
    const details: Record<string, unknown>[] = [];
    for (const field of ["expected_version", "confirmation", "confirmation_note"]) if (!(field in body)) details.push({ type: "missing", loc: ["body", field], msg: "Field required", input: body });
    for (const field of Object.keys(body)) if (!["expected_version", "confirmation", "confirmation_note"].includes(field)) details.push({ type: "extra_forbidden", loc: ["body", field], msg: "Extra inputs are not permitted", input: body[field] });
    if (details.length) return validation(ctx.set, details);
    if (body.confirmation !== "CONFIRM_CORRECTION") return fail(ctx.set, 400, "Exact confirmation phrase is required.");
    const value = row(context, "SELECT * FROM attendance_correction_requests WHERE id = ?", [ctx.params.request_id]); if (!value || !["DRAFT", "SUBMITTED"].includes(value.state) || value.version !== body.expected_version) return fail(ctx.set, 409, "Correction request is not confirmable.");
    const attendance = row(context, "SELECT * FROM attendance WHERE id = ?", [value.attendance_id]); if (!attendance || !periodOpen(context, attendance.date)) return fail(ctx.set, 409, "Attendance period is finalized.");
    const note = `${value.explanation}\n\n[Self-Confirmed]: ${body.confirmation_note.trim()}`; const client = context.database.client;
    inTransaction(client, () => { const created = client.run("INSERT INTO attendance_overrides (attendance_id, original_status, override_status, override_check_in, override_check_out, note, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(attendance_id) DO UPDATE SET override_status = excluded.override_status, override_check_in = excluded.override_check_in, override_check_out = excluded.override_check_out, note = excluded.note, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at", [attendance.id, attendance.status, value.proposed_status, value.proposed_check_in, value.proposed_check_out, note, user.username]); const override = row(context, "SELECT id FROM attendance_overrides WHERE attendance_id = ?", [attendance.id]); client.run("INSERT INTO attendance_override_history (override_id, attendance_id, previous_status, new_status, note, reviewed_by, timestamp) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)", [override?.id ?? Number(created.lastInsertRowid), attendance.id, attendance.status, value.proposed_status, note, user.username]); client.run("UPDATE attendance_correction_requests SET state = 'APPROVED', active_key = NULL, approver = ?, decided_at = CURRENT_TIMESTAMP, resulting_override_id = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [user.username, override?.id ?? Number(created.lastInsertRowid), value.id]); client.run("INSERT INTO attendance_correction_audit (request_id, action, prior_state, new_state, actor, effective_date, reason_code, explanation_summary, source_workflow, metadata_version, created_at) VALUES (?, 'SELF_CONFIRM', ?, 'APPROVED', ?, ?, ?, ?, 'ATTENDANCE_CORRECTION', 1, CURRENT_TIMESTAMP)", [value.id, value.state, user.username, attendance.date, value.reason_code, note.slice(0, 255)]); });
    return requestPayload(context, row(context, "SELECT * FROM attendance_correction_requests WHERE id = ?", [value.id]) as Row);
  }, { params: t.Object({ request_id: t.Number({ minimum: 1 }) }), body: t.Any() });
}

export function attendanceRoutes(app: any, context: AuthContext): any { correctionReviewRoutes(app, context); reviewRoutes(app, context); scopedRoutes(app, context); correctionRoutes(app, context); selfConfirmRoute(app, context); earlyDepartureRoutes(app, context); return app; }
