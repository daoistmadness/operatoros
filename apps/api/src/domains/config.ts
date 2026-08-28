import { t } from "elysia";
import { authorize, readCookie, requestContext, SESSION_COOKIE_NAME, type AuthContext, type CurrentUser } from "../auth/service";
import { actor } from "./core";
import { inTransaction } from "@operatoros/db";

type Row = Record<string, any>;
type Context = any;

function rows(context: AuthContext, sql: string, params: any[] = []): Row[] {
  return context.database.client.query(sql).all(...params) as Row[];
}

function row(context: AuthContext, sql: string, params: any[] = []): Row | null {
  return (context.database.client.query(sql).get(...params) as Row | null) ?? null;
}

function fail(set: any, status: number, detail: string): { detail: string } {
  set.status = status;
  return { detail };
}

let clearDataBusy = false;

function currentUser(context: AuthContext, ctx: Context): CurrentUser | null {
  const requestInfo = requestContext(ctx.request, ctx.server);
  const result = authorize(context, readCookie(ctx.request, SESSION_COOKIE_NAME), {}, {
    path: ctx.path, userAgent: requestInfo.userAgent, ipAddress: requestInfo.ipAddress,
  });
  if ("user" in result) return result.user;
  fail(ctx.set, result.status, result.message);
  return null;
}

function serializeKkm(context: AuthContext, value: Row): Row {
  const year = row(context, "SELECT label FROM academic_years WHERE id = ?", [value.academic_year_id]);
  const jenjang = value.jenjang_id === null ? null : row(context, "SELECT name FROM jenjangs WHERE id = ?", [value.jenjang_id]);
  const subject = value.subject_id === null ? null : row(context, "SELECT name FROM subjects WHERE id = ?", [value.subject_id]);
  return { id: value.id, academic_year_id: value.academic_year_id, academic_year_label: year?.label ?? null, jenjang_id: value.jenjang_id, jenjang_name: jenjang?.name ?? null, subject_id: value.subject_id, subject_name: subject?.name ?? null, assessment_type: value.assessment_type, threshold: Number(value.threshold) };
}

function validateKkmReferences(context: AuthContext, academicYearId: number, jenjangId: number | null, subjectId: number | null, set: any): boolean {
  if (!row(context, "SELECT id FROM academic_years WHERE id = ?", [academicYearId])) { fail(set, 404, "Academic year not found"); return false; }
  if (jenjangId !== null && !row(context, "SELECT id FROM jenjangs WHERE id = ?", [jenjangId])) { fail(set, 404, "Jenjang not found"); return false; }
  if (subjectId !== null) {
    const subject = row(context, "SELECT jenjang_id FROM subjects WHERE id = ?", [subjectId]);
    if (!subject) { fail(set, 404, "Subject not found"); return false; }
    if (jenjangId !== null && Number(subject.jenjang_id) !== jenjangId) { fail(set, 400, "Subject does not belong to selected jenjang"); return false; }
  }
  return true;
}

function duplicateKkm(context: AuthContext, values: { academic_year_id: number; jenjang_id: number | null; subject_id: number | null; assessment_type: string }, excludeId?: number): Row | null {
  const sql = "SELECT id FROM kkm_thresholds WHERE academic_year_id = ? AND assessment_type = ? AND " +
    (values.jenjang_id === null ? "jenjang_id IS NULL" : "jenjang_id = ?") + " AND " +
    (values.subject_id === null ? "subject_id IS NULL" : "subject_id = ?") +
    (excludeId === undefined ? "" : " AND id != ?");
  const params = [values.academic_year_id, values.assessment_type, ...(values.jenjang_id === null ? [] : [values.jenjang_id]), ...(values.subject_id === null ? [] : [values.subject_id]), ...(excludeId === undefined ? [] : [excludeId])];
  return row(context, sql, params);
}

function defaultTermRange(year: Row, number: number): [string, string] {
  const startYear = Number(String(year.start_date).slice(0, 4));
  const endYear = Number(String(year.end_date).slice(0, 4));
  const ranges: [string, string][] = [[`${startYear}-07-01`, `${startYear}-09-30`], [`${startYear}-10-01`, `${startYear}-12-31`], [`${endYear}-01-01`, `${endYear}-03-31`], [`${endYear}-04-01`, `${endYear}-06-30`]];
  const selected = ranges[number - 1] ?? ["", ""];
  const [start, end] = selected;
  return [start < year.start_date ? year.start_date : start, end > year.end_date ? year.end_date : end];
}

function validateTerm(context: AuthContext, values: { academic_year_id: number; term_number: number; start_date: string; end_date: string }, set: any, excludeId?: number): boolean {
  const year = row(context, "SELECT * FROM academic_years WHERE id = ?", [values.academic_year_id]);
  if (!year) { fail(set, 404, "Academic year not found"); return false; }
  if (values.term_number < 1 || values.term_number > 4) { fail(set, 400, "term_number must be between 1 and 4"); return false; }
  if (values.start_date > values.end_date) { fail(set, 400, "start_date must be on or before end_date"); return false; }
  if (values.start_date < year.start_date || values.end_date > year.end_date) { fail(set, 400, "Term date range must stay within the academic year"); return false; }
  for (let number = 1; number <= 4; number++) {
    if (number === values.term_number) continue;
    const custom = row(context, "SELECT start_date, end_date FROM academic_term_configs WHERE academic_year_id = ? AND term_number = ? AND id != COALESCE(?, 0)", [values.academic_year_id, number, excludeId ?? 0]);
    const [start, end] = custom ? [custom.start_date, custom.end_date] : defaultTermRange(year, number);
    if (values.start_date <= end && values.end_date >= start) { fail(set, 400, "Term date range overlaps another term in this academic year"); return false; }
  }
  return true;
}

const cutoffBody = t.Object({ cutoff_time: t.String() });

export function configRoutes(app: any, context: AuthContext, config: { deploymentMode?: string } = {}): any {
  app.get("/api/config/jenjang", (ctx: Context) => {
    if (!currentUser(context, ctx)) return { detail: "Authentication required" };
    const available = rows(context, "SELECT DISTINCT trim(jenjang) AS jenjang FROM students WHERE jenjang IS NOT NULL AND trim(jenjang) <> '' ORDER BY jenjang").map((item) => item.jenjang);
    const configured = rows(context, "SELECT jenjang, cutoff_time, updated_at FROM jenjang_config ORDER BY jenjang").filter((item) => available.includes(item.jenjang));
    const names = new Set(configured.map((item) => item.jenjang));
    return { configured, unconfigured: available.filter((item) => !names.has(item)) };
  });
  app.get("/api/config/jenjang/available", (ctx: Context) => {
    if (!currentUser(context, ctx)) return { detail: "Authentication required" };
    return { jenjang_list: rows(context, "SELECT DISTINCT trim(jenjang) AS jenjang FROM students WHERE jenjang IS NOT NULL AND trim(jenjang) <> '' ORDER BY jenjang").map((item) => item.jenjang) };
  });
  app.put("/api/config/jenjang/:jenjang", (ctx: Context) => {
    const user = actor(context, ctx, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" };
    const key = ctx.params.jenjang.trim(); const cutoff = ctx.body.cutoff_time.trim();
    if (!key) return fail(ctx.set, 400, "jenjang must be a non-empty string");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff)) return fail(ctx.set, 400, "cutoff_time must be in HH:MM format");
    if (!row(context, "SELECT 1 FROM students WHERE trim(jenjang) = ? LIMIT 1", [key])) return fail(ctx.set, 400, "jenjang must exist in students data");
    context.database.client.run("INSERT INTO jenjang_config (jenjang, cutoff_time, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(jenjang) DO UPDATE SET cutoff_time = excluded.cutoff_time, updated_at = CURRENT_TIMESTAMP", [key, cutoff]);
    return row(context, "SELECT jenjang, cutoff_time, updated_at FROM jenjang_config WHERE jenjang = ?", [key]);
  }, { params: t.Object({ jenjang: t.String({ minLength: 1 }) }), body: cutoffBody });
  app.delete("/api/config/jenjang/:jenjang", (ctx: Context) => {
    if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" };
    const key = ctx.params.jenjang.trim(); const result = context.database.client.run("DELETE FROM jenjang_config WHERE jenjang = ?", [key]);
    if (!result.changes) return fail(ctx.set, 404, "Jenjang config not found");
    return { deleted: key };
  }, { params: t.Object({ jenjang: t.String({ minLength: 1 }) }) });

  app.get("/api/config/heb", (ctx: Context) => {
    if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" };
    const where: string[] = []; const params: any[] = [];
    if (ctx.query.month !== undefined) { const month = Number(ctx.query.month); if (month < 1 || month > 12) return fail(ctx.set, 400, "month must be between 1 and 12"); where.push("month = ?"); params.push(month); }
    if (ctx.query.year !== undefined) { const year = Number(ctx.query.year); if (year < 2020) return fail(ctx.set, 400, "year must be greater than or equal to 2020"); where.push("year = ?"); params.push(year); }
    if (ctx.query.jenjang?.trim()) { where.push("jenjang = ?"); params.push(ctx.query.jenjang.trim()); }
    return rows(context, `SELECT id, jenjang, month, year, heb_value, note, 'manual' AS source, set_by, set_at FROM heb_overrides ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY year DESC, month DESC, jenjang`, params);
  }, { query: t.Object({ month: t.Optional(t.String()), year: t.Optional(t.String()), jenjang: t.Optional(t.String()) }) });
  app.put("/api/config/heb/:jenjang/:year/:month", (ctx: Context) => {
    if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" };
    const jenjang = ctx.params.jenjang.trim(); const year = Number(ctx.params.year); const month = Number(ctx.params.month); const value = Number(ctx.body.heb_value); const setBy = ctx.body.set_by.trim();
    if (!jenjang) return fail(ctx.set, 400, "jenjang must be a non-empty string");
    if (month < 1 || month > 12 || year < 2020) return fail(ctx.set, 400, "Invalid reporting period");
    if (value < 1 || value > 31 || !Number.isInteger(value)) return fail(ctx.set, 400, "heb_value must be an integer between 1 and 31");
    if (!setBy) return fail(ctx.set, 400, "set_by must not be empty");
    context.database.client.run("INSERT INTO heb_overrides (jenjang, month, year, heb_value, note, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(jenjang, month, year) DO UPDATE SET heb_value = excluded.heb_value, note = excluded.note, set_by = excluded.set_by, set_at = CURRENT_TIMESTAMP", [jenjang, month, year, value, ctx.body.note?.trim() || null, setBy]);
    return row(context, "SELECT id, jenjang, month, year, heb_value, note, 'manual' AS source, set_by, set_at FROM heb_overrides WHERE jenjang = ? AND year = ? AND month = ?", [jenjang, year, month]);
  }, { params: t.Object({ jenjang: t.String({ minLength: 1 }), year: t.String(), month: t.String() }), body: t.Object({ heb_value: t.Number(), note: t.Optional(t.String()), set_by: t.String() }) });
  app.delete("/api/config/heb/:jenjang/:year/:month", (ctx: Context) => {
    if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" };
    const result = context.database.client.run("DELETE FROM heb_overrides WHERE jenjang = ? AND year = ? AND month = ?", [ctx.params.jenjang.trim(), Number(ctx.params.year), Number(ctx.params.month)]);
    if (!result.changes) return fail(ctx.set, 404, "HEB override not found");
    return { deleted: true, jenjang: ctx.params.jenjang.trim(), year: Number(ctx.params.year), month: Number(ctx.params.month), message: "HEB override removed. Will revert to auto-calculation." };
  }, { params: t.Object({ jenjang: t.String({ minLength: 1 }), year: t.String(), month: t.String() }) });

  app.get("/api/config/absence-reasons", (ctx: Context) => { const user = actor(context, ctx, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" }; const month = Number(ctx.query.month); const year = Number(ctx.query.year); if (month < 1 || month > 12) return fail(ctx.set, 400, "month must be between 1 and 12"); if (year < 2020) return fail(ctx.set, 400, "year must be greater than or equal to 2020"); const className = ctx.query.class_name?.trim(); const client = context.database.client; const availableClasses = rows(context, "SELECT class_name, max(jenjang) AS jenjang FROM students WHERE class_name IS NOT NULL GROUP BY class_name ORDER BY class_name"); if (className) { const classRow = row(context, "SELECT * FROM absence_reason_class_entries WHERE class_name = ? AND month = ? AND year = ?", [className, month, year]); if (classRow) return [{ student_id: 0, student_name: "Rekap Kelas", class_name: className, jenjang: availableClasses.find((v) => v.class_name === className)?.jenjang ?? (className.split(/\d/)[0] || "Unassigned"), month, year, sakit: Number(classRow.sakit), izin: Number(classRow.izin), alfa: Number(classRow.alfa), total: Number(classRow.sakit) + Number(classRow.izin) + Number(classRow.alfa), note: classRow.note ?? "", entered_by: classRow.entered_by, has_data: true, entry_mode: "class", id: classRow.id, entered_at: classRow.entered_at, updated_at: classRow.updated_at }]; return rows(context, "SELECT s.id AS student_id, s.name AS student_name, s.class_name, coalesce(s.jenjang, 'Unassigned') AS jenjang, a.id, coalesce(a.sakit, 0) AS sakit, coalesce(a.izin, 0) AS izin, coalesce(a.alfa, 0) AS alfa, coalesce(a.note, '') AS note, a.entered_by, a.entered_at, a.updated_at FROM students s LEFT JOIN absence_reasons a ON a.student_id = s.id AND a.month = ? AND a.year = ? WHERE (? = 'Unassigned' AND s.class_name IS NULL) OR s.class_name = ? ORDER BY s.name", [month, year, className, className]).map((v) => ({ ...v, month, year, total: Number(v.sakit) + Number(v.izin) + Number(v.alfa), has_data: v.id !== null, entry_mode: "student" })); } return availableClasses.map((classRow) => { const classEntry = row(context, "SELECT * FROM absence_reason_class_entries WHERE class_name = ? AND month = ? AND year = ?", [classRow.class_name, month, year]); const totals = row(context, "SELECT coalesce(sum(sakit),0) AS sakit, coalesce(sum(izin),0) AS izin, coalesce(sum(alfa),0) AS alfa FROM absence_reasons WHERE class_name = ? AND month = ? AND year = ?", [classRow.class_name, month, year]); const sakit = Number(classEntry?.sakit ?? totals?.sakit ?? 0); const izin = Number(classEntry?.izin ?? totals?.izin ?? 0); const alfa = Number(classEntry?.alfa ?? totals?.alfa ?? 0); return { student_id: 0, student_name: classRow.class_name, class_name: classRow.class_name, jenjang: classRow.jenjang ?? "Unassigned", month, year, sakit, izin, alfa, total: sakit + izin + alfa, note: classEntry?.note ?? "", entered_by: classEntry?.entered_by ?? null, has_data: Boolean(classEntry || Number(totals?.sakit) || Number(totals?.izin) || Number(totals?.alfa)), entry_mode: "class", id: classEntry?.id ?? null, entered_at: classEntry?.entered_at ?? null, updated_at: classEntry?.updated_at ?? null }; }); }, { query: t.Object({ month: t.String(), year: t.String(), class_name: t.Optional(t.String()) }) });
    app.post("/api/config/absence-reasons/bulk", (ctx: Context) => { const user = actor(context, ctx, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" }; const body = ctx.body as Row; const client = context.database.client; const month = Number(body.month); const year = Number(body.year); if (month < 1 || month > 12) return fail(ctx.set, 400, "month must be between 1 and 12"); if (year < 2020) return fail(ctx.set, 400, "year must be greater than or equal to 2020"); try { if (Array.isArray(body.updates)) { const enteredBy = String(body.entered_by ?? "").trim(); if (!enteredBy) return fail(ctx.set, 400, "entered_by must not be empty"); for (const update of body.updates) { if ([update.sakit, update.izin, update.alfa].some((value) => Number(value ?? 0) < 0)) return fail(ctx.set, 400, "Counts must be >= 0"); const student = row(context, "SELECT id, name, class_name FROM students WHERE id = ?", [update.student_id]); if (!student) return fail(ctx.set, 404, `Student ${update.student_id} not found`); const existing = row(context, "SELECT id FROM absence_reasons WHERE student_id = ? AND month = ? AND year = ?", [student.id, month, year]); const values = [student.id, student.class_name ?? "Unassigned", month, year, Number(update.sakit ?? 0), Number(update.izin ?? 0), Number(update.alfa ?? 0), update.note?.trim() || null, enteredBy]; if (existing) client.run("UPDATE absence_reasons SET class_name = ?, sakit = ?, izin = ?, alfa = ?, note = ?, entered_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [values[1], values[4], values[5], values[6], values[7], values[8], existing.id]); else client.run("INSERT INTO absence_reasons (student_id, class_name, month, year, sakit, izin, alfa, note, entered_by, entered_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", values); } return { message: `Successfully updated ${body.updates.length} records`, total: body.updates.length }; } if (Array.isArray(body.entries)) { let inserted = 0; let updated = 0; let propagated = 0; for (const entry of body.entries) { const className = String(entry.class_name ?? "").trim(); const entryMonth = Number(entry.month ?? month); const entryYear = Number(entry.year ?? year); const enteredBy = String(entry.entered_by ?? body.entered_by ?? "").trim(); if (!className || entryMonth < 1 || entryMonth > 12 || entryYear < 2020 || !enteredBy || [entry.sakit, entry.izin, entry.alfa].some((value) => Number(value ?? 0) < 0)) return fail(ctx.set, 422, "Invalid absence reason class entry"); const existing = row(context, "SELECT id FROM absence_reason_class_entries WHERE class_name = ? AND month = ? AND year = ?", [className, entryMonth, entryYear]); if (existing) { client.run("UPDATE absence_reason_class_entries SET sakit = ?, izin = ?, alfa = ?, note = ?, entered_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [Number(entry.sakit ?? 0), Number(entry.izin ?? 0), Number(entry.alfa ?? 0), entry.note?.trim() || null, enteredBy, existing.id]); updated++; } else { client.run("INSERT INTO absence_reason_class_entries (class_name, month, year, sakit, izin, alfa, note, entered_by, entered_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", [className, entryMonth, entryYear, Number(entry.sakit ?? 0), Number(entry.izin ?? 0), Number(entry.alfa ?? 0), entry.note?.trim() || null, enteredBy]); inserted++; } for (const student of rows(context, "SELECT id FROM students WHERE class_name = ?", [className])) { const studentEntry = row(context, "SELECT id FROM absence_reasons WHERE student_id = ? AND month = ? AND year = ?", [student.id, entryMonth, entryYear]); const values = [student.id, className, entryMonth, entryYear, Number(entry.sakit ?? 0), Number(entry.izin ?? 0), Number(entry.alfa ?? 0), entry.note?.trim() || null, enteredBy]; if (studentEntry) client.run("UPDATE absence_reasons SET class_name = ?, sakit = ?, izin = ?, alfa = ?, note = ?, entered_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [values[1], values[4], values[5], values[6], values[7], values[8], studentEntry.id]); else client.run("INSERT INTO absence_reasons (student_id, class_name, month, year, sakit, izin, alfa, note, entered_by, entered_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", values); propagated++; } } return { inserted, updated, total: body.entries.length, propagated_students: propagated }; } return fail(ctx.set, 422, "updates or entries are required"); } catch { return fail(ctx.set, 409, "The records could not be saved. Retry or contact the system administrator."); } }, { body: t.Any() });
  app.get("/api/config/absence-reasons/summary", (ctx: Context) => { const user = actor(context, ctx, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" }; const month = Number(ctx.query.month); const year = Number(ctx.query.year); const classes = rows(context, "SELECT class_name, max(jenjang) AS jenjang FROM students WHERE class_name IS NOT NULL GROUP BY class_name ORDER BY class_name"); return classes.reduce((result: Row[], classRow) => { const classEntry = row(context, "SELECT * FROM absence_reason_class_entries WHERE class_name = ? AND month = ? AND year = ?", [classRow.class_name, month, year]); const totals = row(context, "SELECT coalesce(sum(sakit),0) AS sakit, coalesce(sum(izin),0) AS izin, coalesce(sum(alfa),0) AS alfa FROM absence_reasons WHERE class_name = ? AND month = ? AND year = ?", [classRow.class_name, month, year]); result.push({ jenjang: classRow.jenjang ?? "Unassigned", month, year, total_sakit: Number(classEntry?.sakit ?? totals?.sakit ?? 0), total_izin: Number(classEntry?.izin ?? totals?.izin ?? 0), total_alfa: Number(classEntry?.alfa ?? totals?.alfa ?? 0), classes_entered: classEntry ? 1 : 0, classes_total: 1 }); return result; }, []); }, { query: t.Object({ month: t.String(), year: t.String() }) });

  const termBody = t.Object({ academic_year_id: t.Number({ minimum: 1 }), term_number: t.Number({ minimum: 1, maximum: 4 }), label: t.String({ minLength: 1, maxLength: 80 }), start_date: t.String(), end_date: t.String() });
  const termUpdateBody = t.Object({ academic_year_id: t.Optional(t.Number({ minimum: 1 })), term_number: t.Optional(t.Number({ minimum: 1, maximum: 4 })), label: t.Optional(t.String({ minLength: 1, maxLength: 80 })), start_date: t.Optional(t.String()), end_date: t.Optional(t.String()) });
  app.get("/api/academic-config/terms", (ctx: Context) => { if (!currentUser(context, ctx)) return { detail: "Authentication required" }; const values = rows(context, `SELECT * FROM academic_term_configs ${ctx.query.academic_year_id ? "WHERE academic_year_id = ?" : ""} ORDER BY academic_year_id, term_number`, ctx.query.academic_year_id ? [Number(ctx.query.academic_year_id)] : []); return values.map((value) => ({ ...value, value: `term_${value.term_number}`, source: "custom" })); }, { query: t.Object({ academic_year_id: t.Optional(t.String()) }) });
  app.post("/api/academic-config/terms", (ctx: Context) => { const user = actor(context, ctx, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" }; if (!validateTerm(context, ctx.body, ctx.set)) return { detail: "Invalid term configuration" }; try { const result = context.database.client.run("INSERT INTO academic_term_configs (academic_year_id, term_number, label, start_date, end_date) VALUES (?, ?, ?, ?, ?)", [ctx.body.academic_year_id, ctx.body.term_number, ctx.body.label.trim(), ctx.body.start_date, ctx.body.end_date]); return { ...row(context, "SELECT * FROM academic_term_configs WHERE id = ?", [Number(result.lastInsertRowid)]), value: `term_${ctx.body.term_number}`, source: "custom" }; } catch { return fail(ctx.set, 409, "Term config already exists for this academic year and term"); } }, { body: termBody });
  app.put("/api/academic-config/terms/:term_id", (ctx: Context) => { const user = actor(context, ctx, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" }; const before = row(context, "SELECT * FROM academic_term_configs WHERE id = ?", [ctx.params.term_id]); if (!before) return fail(ctx.set, 404, "Term config not found"); const values = { academic_year_id: ctx.body.academic_year_id ?? Number(before.academic_year_id), term_number: ctx.body.term_number ?? Number(before.term_number), start_date: ctx.body.start_date ?? before.start_date, end_date: ctx.body.end_date ?? before.end_date }; if (!validateTerm(context, values, ctx.set, Number(ctx.params.term_id))) return { detail: "Invalid term configuration" }; const label = ctx.body.label === undefined ? before.label : ctx.body.label.trim(); try { context.database.client.run("UPDATE academic_term_configs SET academic_year_id = ?, term_number = ?, label = ?, start_date = ?, end_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [values.academic_year_id, values.term_number, label, values.start_date, values.end_date, ctx.params.term_id]); return { ...row(context, "SELECT * FROM academic_term_configs WHERE id = ?", [ctx.params.term_id]), value: `term_${values.term_number}`, source: "custom" }; } catch { return fail(ctx.set, 409, "Term config conflict detected"); } }, { params: t.Object({ term_id: t.Number({ minimum: 1 }) }), body: termUpdateBody });
  app.delete("/api/academic-config/terms/:term_id", (ctx: Context) => { const user = actor(context, ctx, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" }; const result = context.database.client.run("DELETE FROM academic_term_configs WHERE id = ?", [ctx.params.term_id]); if (!result.changes) return fail(ctx.set, 404, "Term config not found"); return { status: "success", deleted: 1, id: ctx.params.term_id }; }, { params: t.Object({ term_id: t.Number({ minimum: 1 }) }) });

  const kkmBody = t.Object({ academic_year_id: t.Number({ minimum: 1 }), jenjang_id: t.Optional(t.Union([t.Number({ minimum: 1 }), t.Null()])), subject_id: t.Optional(t.Union([t.Number({ minimum: 1 }), t.Null()])), assessment_type: t.Union([t.Literal("sumatif"), t.Literal("formatif"), t.Literal("overall")]), threshold: t.Number({ minimum: 0, maximum: 100 }) });
  const kkmUpdateBody = t.Object({ academic_year_id: t.Optional(t.Number({ minimum: 1 })), jenjang_id: t.Optional(t.Union([t.Number({ minimum: 1 }), t.Null()])), subject_id: t.Optional(t.Union([t.Number({ minimum: 1 }), t.Null()])), assessment_type: t.Optional(t.Union([t.Literal("sumatif"), t.Literal("formatif"), t.Literal("overall")])), threshold: t.Optional(t.Number({ minimum: 0, maximum: 100 })) });
  app.get("/api/academic-config/kkm-thresholds", (ctx: Context) => { if (!currentUser(context, ctx)) return { detail: "Authentication required" }; const where: string[] = []; const params: any[] = []; for (const key of ["academic_year_id", "jenjang_id", "subject_id"]) if (ctx.query[key] !== undefined) { where.push(`${key} = ?`); params.push(Number(ctx.query[key])); } return rows(context, `SELECT * FROM kkm_thresholds ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY academic_year_id, jenjang_id, subject_id, assessment_type`, params).map((value) => serializeKkm(context, value)); }, { query: t.Object({ academic_year_id: t.Optional(t.String()), jenjang_id: t.Optional(t.String()), subject_id: t.Optional(t.String()) }) });
  app.post("/api/academic-config/kkm-thresholds", (ctx: Context) => { const user = actor(context, ctx, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" }; const values = { academic_year_id: ctx.body.academic_year_id, jenjang_id: ctx.body.jenjang_id ?? null, subject_id: ctx.body.subject_id ?? null, assessment_type: ctx.body.assessment_type }; if (!validateKkmReferences(context, values.academic_year_id, values.jenjang_id, values.subject_id, ctx.set)) return { detail: "Invalid KKM references" }; if (duplicateKkm(context, values)) return fail(ctx.set, 409, "KKM threshold already exists for this context"); try { const result = context.database.client.run("INSERT INTO kkm_thresholds (academic_year_id, jenjang_id, subject_id, assessment_type, threshold) VALUES (?, ?, ?, ?, ?)", [values.academic_year_id, values.jenjang_id, values.subject_id, values.assessment_type, ctx.body.threshold]); return serializeKkm(context, row(context, "SELECT * FROM kkm_thresholds WHERE id = ?", [Number(result.lastInsertRowid)]) as Row); } catch { return fail(ctx.set, 409, "KKM threshold conflict detected"); } }, { body: kkmBody });
  app.put("/api/academic-config/kkm-thresholds/:threshold_id", (ctx: Context) => { const user = actor(context, ctx, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" }; const client = context.database.client; const before = row(context, "SELECT * FROM kkm_thresholds WHERE id = ?", [ctx.params.threshold_id]); if (!before) return fail(ctx.set, 404, "KKM threshold not found"); const values = { academic_year_id: ctx.body.academic_year_id ?? Number(before.academic_year_id), jenjang_id: ctx.body.jenjang_id ?? before.jenjang_id ?? null, subject_id: ctx.body.subject_id ?? before.subject_id ?? null, assessment_type: ctx.body.assessment_type ?? before.assessment_type, threshold: ctx.body.threshold ?? Number(before.threshold) }; if (!validateKkmReferences(context, values.academic_year_id, values.jenjang_id, values.subject_id, ctx.set)) return { detail: "Invalid KKM references" }; if (duplicateKkm(context, values, Number(before.id))) return fail(ctx.set, 409, "KKM threshold already exists for this context"); try { client.run("UPDATE kkm_thresholds SET academic_year_id = ?, jenjang_id = ?, subject_id = ?, assessment_type = ?, threshold = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [values.academic_year_id, values.jenjang_id, values.subject_id, values.assessment_type, values.threshold, before.id]); return serializeKkm(context, row(context, "SELECT * FROM kkm_thresholds WHERE id = ?", [before.id]) as Row); } catch { return fail(ctx.set, 409, "KKM threshold conflict detected"); } }, { params: t.Object({ threshold_id: t.Number({ minimum: 1 }) }), body: kkmUpdateBody });
  app.delete("/api/academic-config/kkm-thresholds/:threshold_id", (ctx: Context) => { const user = actor(context, ctx, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" }; const result = context.database.client.run("DELETE FROM kkm_thresholds WHERE id = ?", [ctx.params.threshold_id]); if (!result.changes) return fail(ctx.set, 404, "KKM threshold not found"); return { status: "success", deleted: 1, id: ctx.params.threshold_id }; }, { params: t.Object({ threshold_id: t.Number({ minimum: 1 }) }) });
  app.get("/api/academic-config/kkm-effective", (ctx: Context) => { if (!currentUser(context, ctx)) return { detail: "Authentication required" }; const year = row(context, "SELECT id FROM academic_years WHERE id = ?", [Number(ctx.query.academic_year_id)]); if (!year) return fail(ctx.set, 404, "Academic year not found"); const yearId = Number(ctx.query.academic_year_id); const jenjangId = ctx.query.jenjang_id === undefined ? null : Number(ctx.query.jenjang_id); const subjectId = ctx.query.subject_id === undefined ? null : Number(ctx.query.subject_id); const kind = ctx.query.assessment_type; const candidates = [[jenjangId, subjectId, kind, "subject-specific"], [jenjangId, subjectId, "overall", "subject-overall"], [jenjangId, null, kind, "jenjang-level"], [jenjangId, null, "overall", "jenjang-overall"], [null, null, kind, "academic-year-level"], [null, null, "overall", "academic-year-overall"]] as const; let effective: Row | null = null; let source = "legacy-fallback"; for (const [j, subject, assessment, candidateSource] of candidates) { const value = row(context, `SELECT * FROM kkm_thresholds WHERE academic_year_id = ? AND assessment_type = ? AND ${j === null ? "jenjang_id IS NULL" : "jenjang_id = ?"} AND ${subject === null ? "subject_id IS NULL" : "subject_id = ?"} LIMIT 1`, j === null && subject === null ? [yearId, assessment] : j === null ? [yearId, assessment, subject] : subject === null ? [yearId, assessment, j] : [yearId, assessment, j, subject]); if (value) { effective = value; source = candidateSource; break; } } return { academic_year_id: yearId, jenjang_id: jenjangId, subject_id: subjectId, assessment_type: kind, threshold: effective ? Number(effective.threshold) : 85, threshold_source: source, threshold_id: effective?.id ?? null }; }, { query: t.Object({ academic_year_id: t.String(), jenjang_id: t.Optional(t.String()), subject_id: t.Optional(t.String()), assessment_type: t.Union([t.Literal("sumatif"), t.Literal("formatif"), t.Literal("overall")]) }) });

  app.get("/api/academic-config/terms/effective", (ctx: Context) => { if (!currentUser(context, ctx)) return { detail: "Authentication required" }; const year = row(context, "SELECT * FROM academic_years WHERE id = ?", [Number(ctx.query.academic_year_id)]); if (!year) return fail(ctx.set, 404, "Academic year not found"); const startYear = Number(String(year.start_date).slice(0, 4)); const endYear = Number(String(year.end_date).slice(0, 4)); const ranges: [string, string][] = [[`${startYear}-07-01`, `${startYear}-09-30`], [`${startYear}-10-01`, `${startYear}-12-31`], [`${endYear}-01-01`, `${endYear}-03-31`], [`${endYear}-04-01`, `${endYear}-06-30`]]; return ranges.map(([start, end], index) => { const custom = row(context, "SELECT * FROM academic_term_configs WHERE academic_year_id = ? AND term_number = ?", [year.id, index + 1]); const lower = start > year.start_date ? start : year.start_date; const upper = end < year.end_date ? end : year.end_date; return { id: custom?.id ?? null, academic_year_id: year.id, term_number: index + 1, value: `term_${index + 1}`, label: custom?.label ?? `Term ${index + 1}`, start_date: custom?.start_date ?? lower, end_date: custom?.end_date ?? upper, source: custom ? "custom" : "default" }; }); }, { query: t.Object({ academic_year_id: t.String() }) });

  app.get("/api/config/deployment-mode", (ctx: Context) => {
    if (!currentUser(context, ctx)) return { detail: "Authentication required" };
    return { deployment_mode: config.deploymentMode ?? "LOCAL" };
  });
  return app;
}

function setStatus(ctx: Context, status: number): void { ctx.set.status = status; }

export function readinessRoutes(app: any, context: AuthContext): any {
  app.get("/api/readiness", (ctx: Context) => {
    const user = currentUser(context, ctx); if (!user) return { detail: "Authentication required" };
    const year = row(context, "SELECT id FROM academic_years WHERE start_date <= end_date AND (is_default = 1 OR status = 'active') ORDER BY is_default DESC, start_date DESC LIMIT 1");
    const has = (sql: string, params: any[] = []) => Boolean(row(context, sql, params));
    const required = [
      { code: "academic_year", name: "Configure an academic year", complete: Boolean(year), requirement: "REQUIRED", reason: "A valid active or default academic year anchors enrollment, grades, and reports.", destination: user.role === "admin" ? "/academic-management" : null },
      { code: "students", name: "Add or import students", complete: has("SELECT id FROM student_masters UNION SELECT id FROM students LIMIT 1"), requirement: "REQUIRED", reason: "Student records are required before class placement and attendance workflows can begin.", destination: user.role === "admin" ? "/upload" : null },
      { code: "enrollment", name: "Assign students to active classes", complete: Boolean(year && has("SELECT id FROM student_enrollments WHERE academic_year_id = ? AND lifecycle_state = 'ACTIVE' AND class_assigned = 1 AND (academic_class_id IS NOT NULL OR trim(coalesce(class_name, '')) <> '') LIMIT 1", [year.id])), requirement: "REQUIRED", reason: "At least one class-assigned enrollment in the usable academic year is required for current workflows.", destination: user.role === "admin" ? "/enrollment" : null },
    ];
    const optional = [
      { code: "device_link", name: "Link attendance devices", complete: has("SELECT id FROM student_device_identities WHERE is_active = 1 UNION SELECT id FROM attendance LIMIT 1"), requirement: "RECOMMENDED", reason: "Academic enrollment is ready without biometrics; a device link is only required for attendance-machine matching.", destination: user.role === "admin" ? "/students" : null },
      { code: "academic_terms", name: "Configure academic periods", complete: Boolean(year && has("SELECT id FROM academic_term_configs WHERE academic_year_id = ? AND start_date <= end_date LIMIT 1", [year.id])), requirement: "WORKFLOW", reason: "Academic periods are required for term-based grade and academic reporting workflows.", destination: user.role === "admin" ? "/academic-management" : null },
      { code: "attendance", name: "Record or import attendance", complete: has("SELECT id FROM attendance LIMIT 1"), requirement: "RECOMMENDED", reason: "Attendance data enables daily review, dashboards, reports, and Management Analytics.", destination: user.role === "admin" ? "/upload" : "/attendance-review" },
    ];
    const requiredComplete = required.filter((item) => item.complete).length;
    const overall = user.role !== "admin" && requiredComplete < required.length ? "READ_ONLY_GUIDANCE" : requiredComplete === 0 ? "FIRST_RUN" : requiredComplete < required.length ? "SETUP_PARTIAL" : optional.some((item) => !item.complete) ? "READY_WITH_RECOMMENDATIONS" : "OPERATIONALLY_READY";
    const responsibility = user.role === "admin" ? null : "An administrator can complete this step.";
    return { overall_status: overall, steps: [...required, ...optional].map((item) => ({ code: item.code, name: item.name, status: item.complete ? "COMPLETE" : item.requirement === "RECOMMENDED" ? "OPTIONAL" : "NOT_STARTED", requirement: item.requirement, reason: item.reason, destination: item.destination, can_manage: user.role === "admin", responsibility })) };
  });
  return app;
}

export function systemRoutes(app: any, context: AuthContext | null = null, config: { destructiveOperationsEnabled?: boolean } = {}): any {
  app.get("/api/system/health", () => ({ status: "ok", service: "System API", destructive_operations_enabled: config.destructiveOperationsEnabled ?? false }));
  if (context) app.post("/api/system/clear-data", (ctx: Context) => {
    const user = actor(context, ctx, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" };
    if (!config.destructiveOperationsEnabled) return fail(ctx.set, 403, "Destructive operations are disabled.");
    const mode = ctx.body?.mode ?? "attendance"; const confirmation = String(ctx.body?.confirmation ?? "").trim();
    if (!["attendance", "attendance_keep_exceptions", "full"].includes(mode)) return fail(ctx.set, 422, "Invalid clear-data mode");
    if (confirmation !== "CLEAR_ALL_ATTENDANCE_DATA") return fail(ctx.set, 400, "Invalid confirmation token. Use CLEAR_ALL_ATTENDANCE_DATA.");
    if (clearDataBusy) return fail(ctx.set, 409, "Another destructive operation is already active.");
    clearDataBusy = true;
    const client = context.database.client; let triggersDropped = false;
    try {
      const deleted: Row = {};
      inTransaction(client, () => {
        for (const name of ["trg_attendance_override_history_no_delete", "trg_attendance_override_history_no_update", "trg_history_no_delete", "trg_history_no_update"]) client.run(`DROP TRIGGER IF EXISTS ${name}`);
        triggersDropped = true;
        if (mode === "attendance_keep_exceptions") {
          deleted.attendance_override_history = Number(client.run("DELETE FROM attendance_override_history WHERE override_id NOT IN (SELECT id FROM attendance_overrides WHERE override_status IN ('sakit','izin','alfa'))").changes);
          deleted.attendance_overrides = Number(client.run("DELETE FROM attendance_overrides WHERE override_status NOT IN ('sakit','izin','alfa')").changes);
          deleted.attendance = Number(client.run("DELETE FROM attendance WHERE id NOT IN (SELECT id FROM attendance WHERE status IN ('sakit','izin','alfa') UNION SELECT attendance_id FROM attendance_overrides WHERE override_status IN ('sakit','izin','alfa'))").changes);
          deleted.upload_logs = Number(client.run("DELETE FROM upload_logs").changes); deleted.absence_reasons = 0; deleted.absence_reason_class_entries = 0;
        } else {
          for (const [key, table] of [["attendance_override_history", "attendance_override_history"], ["attendance_overrides", "attendance_overrides"], ["attendance", "attendance"], ["upload_logs", "upload_logs"], ["absence_reasons", "absence_reasons"], ["absence_reason_class_entries", "absence_reason_class_entries"]] as const) deleted[key] = Number(client.run(`DELETE FROM ${table}`).changes);
        }
        if (mode === "full") deleted.students = Number(client.run("DELETE FROM students").changes);
        client.run("CREATE TRIGGER trg_attendance_override_history_no_update BEFORE UPDATE ON attendance_override_history BEGIN SELECT RAISE(FAIL, 'attendance_override_history is append-only'); END");
        client.run("CREATE TRIGGER trg_attendance_override_history_no_delete BEFORE DELETE ON attendance_override_history BEGIN SELECT RAISE(FAIL, 'attendance_override_history is append-only'); END");
        triggersDropped = false;
      });
      return { status: "success", message: `Data cleared successfully (${mode} mode).`, deleted_counts: deleted };
    } catch {
      if (triggersDropped) { try { client.run("CREATE TRIGGER IF NOT EXISTS trg_attendance_override_history_no_update BEFORE UPDATE ON attendance_override_history BEGIN SELECT RAISE(FAIL, 'attendance_override_history is append-only'); END"); client.run("CREATE TRIGGER IF NOT EXISTS trg_attendance_override_history_no_delete BEFORE DELETE ON attendance_override_history BEGIN SELECT RAISE(FAIL, 'attendance_override_history is append-only'); END"); } catch { /* preserve the original failure */ } }
      return fail(ctx.set, 500, "Failed to reset database.");
    } finally { clearDataBusy = false; }
  }, { body: t.Object({ mode: t.Optional(t.Union([t.Literal("attendance"), t.Literal("attendance_keep_exceptions"), t.Literal("full")])), confirmation: t.Optional(t.String()) }) });
  return app;
}
