import { t } from "elysia";
import { inTransaction } from "../db/connection";
import { actor } from "./core";
import { deriveDepartureStatus, parseClockMinutes } from "./attendance-rules";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;

function rows(context: AuthContext, sql: string, params: any[] = []): Row[] { return context.database.client.query(sql).all(...params) as Row[]; }
function row(context: AuthContext, sql: string, params: any[] = []): Row | null { return (context.database.client.query(sql).get(...params) as Row | null) ?? null; }
function fail(set: any, status: number, detail: string | Record<string, unknown>): { detail: string | Record<string, unknown> } { set.status = status; return { detail }; }
function dateValue(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function weekday(value: string): number { return (new Date(`${value}T00:00:00Z`).getUTCDay() + 6) % 7; }
function clock(value: string): string | null { return parseClockMinutes(value) === null ? null : value; }
function iso(value: unknown): string | null { return value ? String(value) : null; }
function policyPayload(value: Row): Row {
  return {
    id: value.id, jenjang_id: value.jenjang_id, jenjang: value.jenjang, weekday: value.weekday,
    dismissal_time: String(value.dismissal_time).slice(0, 5), grace_period_minutes: value.grace_period_minutes,
    effective_from: value.effective_from, effective_to: value.effective_to, is_active: Boolean(value.is_active),
    change_reason: value.change_reason, created_by: value.created_by, created_at: iso(value.created_at),
  };
}
function excusePayload(value: Row): Row {
  return {
    id: value.id, attendance_id: value.attendance_id, reason_code: value.reason_code,
    explanation: value.explanation, state: value.state, recorded_by: value.recorded_by,
    recorded_at: iso(value.recorded_at), revoked_by: value.revoked_by, revoked_at: iso(value.revoked_at),
    revocation_reason: value.revocation_reason,
  };
}
function hasClassAccess(context: AuthContext, userId: number, className: string, date: string): boolean {
  return Boolean(row(context, "SELECT a.id FROM teacher_class_assignments a JOIN academic_classes c ON c.id = a.academic_class_id WHERE a.user_id = ? AND c.class_name = ? AND a.active = 1 AND c.active = 1 AND (a.effective_from IS NULL OR a.effective_from <= ?) AND (a.effective_to IS NULL OR a.effective_to >= ?)", [userId, className, date, date]));
}
function isAdmin(user: { role: string }): boolean { return user.role === "admin"; }
function canManageAll(user: { role: string }): boolean { return isAdmin(user); }
function policyFor(context: AuthContext, jenjang: string, date: string): Row | null {
  return row(context, "SELECT * FROM dismissal_policies WHERE is_active = 1 AND weekday = ? AND lower(trim(jenjang)) = lower(trim(?)) AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) ORDER BY effective_from DESC, id DESC LIMIT 1", [weekday(date), jenjang, date, date]);
}
function periodOpen(context: AuthContext, date: string): boolean { return !row(context, "SELECT id FROM attendance_periods WHERE attendance_date = ? AND status = 'FINALIZED'", [date]); }
function departurePayload(attendance: Row, override: Row | null, policy: Row | null, excuse: Row | null, pending: boolean, finalized: boolean): Row {
  const checkIn = (override?.override_check_in ?? attendance.check_in) ? String(override?.override_check_in ?? attendance.check_in).slice(0, 5) : null;
  const checkOut = (override?.override_check_out ?? attendance.check_out) ? String(override?.override_check_out ?? attendance.check_out).slice(0, 5) : null;
  const result = deriveDepartureStatus({ checkIn, checkOut, status: String(attendance.status ?? ""), dismissal: policy ? String(policy.dismissal_time).slice(0, 5) : null, graceMinutes: Number(policy?.grace_period_minutes ?? 0), excused: excuse?.state === "ACTIVE" });
  return {
    attendance_id: attendance.id, date: attendance.date, student_id: attendance.student_id,
    classification: result.classification, effective_check_in: checkIn ? String(checkIn).slice(0, 5) : null,
    effective_check_out: checkOut ? String(checkOut).slice(0, 5) : null,
    raw_check_out: attendance.check_out ? String(attendance.check_out).slice(0, 5) : null,
    has_override: Boolean(override?.override_check_in || override?.override_check_out),
    scheduled_dismissal: policy ? String(policy.dismissal_time).slice(0, 5) : null,
    grace_period_minutes: Number(policy?.grace_period_minutes ?? 0), minutes_early: result.minutesEarly,
    policy_id: policy?.id ?? null, policy_version: policy ? `policy_${policy.id}` : null,
    excuse: excuse?.state === "ACTIVE" ? { id: excuse.id, reason_code: excuse.reason_code, explanation: excuse.explanation, recorded_by: excuse.recorded_by, recorded_at: iso(excuse.recorded_at), state: excuse.state } : null,
    has_pending_correction: pending, is_period_finalized: finalized,
  };
}

export function earlyDepartureRoutes(app: any, context: AuthContext): void {
  const policyBody = t.Object({
    jenjang: t.String({ minLength: 1 }), weekday: t.Number({ minimum: 0, maximum: 6 }), dismissal_time: t.String(),
    grace_period_minutes: t.Optional(t.Number({ minimum: 0 })), effective_from: t.String(), effective_to: t.Optional(t.String()),
    change_reason: t.Optional(t.String()), jenjang_id: t.Optional(t.Number({ minimum: 1 })),
  });
  app.get("/api/attendance/departure-policies", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_early_departure" }); if (!user) return { detail: "Insufficient permissions" };
    const values = rows(context, `SELECT * FROM dismissal_policies ${ctx.query.jenjang ? "WHERE trim(jenjang) = trim(?)" : ""} ${ctx.query.active_only ? (ctx.query.jenjang ? "AND" : "WHERE") + " is_active = 1" : ""} ORDER BY jenjang, weekday, effective_from DESC`, ctx.query.jenjang ? [ctx.query.jenjang] : []);
    return values.map(policyPayload);
  }, { query: t.Object({ jenjang: t.Optional(t.String()), active_only: t.Optional(t.Boolean()) }) });

  app.post("/api/attendance/departure-policies", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "manage_early_departure_policy" }); if (!user) return { detail: "Insufficient permissions" };
    const body = ctx.body;
    if (body.weekday < 0 || body.weekday > 6 || !dateValue(body.effective_from) || body.effective_to && !dateValue(body.effective_to) || body.effective_to && body.effective_to < body.effective_from) return fail(ctx.set, 400, { code: "VALIDATION_ERROR", message: "Invalid weekday or effective date range" });
    if (!clock(body.dismissal_time) || !/^\d{2}:\d{2}$/.test(body.dismissal_time)) return fail(ctx.set, 400, "Invalid time format. Expected HH:MM");
    const jenjang = body.jenjang.trim();
    const existing = rows(context, "SELECT effective_from, effective_to FROM dismissal_policies WHERE is_active = 1 AND weekday = ? AND lower(trim(jenjang)) = lower(trim(?))", [body.weekday, jenjang]);
    const newEnd = body.effective_to ?? "9999-12-31";
    if (existing.some((value) => Math.max(Date.parse(value.effective_from), Date.parse(body.effective_from)) <= Math.min(Date.parse(value.effective_to ?? "9999-12-31"), Date.parse(newEnd)))) return fail(ctx.set, 400, { code: "DISMISSAL_POLICY_OVERLAP", message: "An active dismissal policy already exists for this jenjang and weekday with overlapping dates" });
    const client = context.database.client;
    try {
      let id = 0;
      inTransaction(client, () => {
        const created = client.run("INSERT INTO dismissal_policies (jenjang_id, jenjang, weekday, dismissal_time, grace_period_minutes, effective_from, effective_to, is_active, change_reason, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", [body.jenjang_id ?? null, jenjang, body.weekday, body.dismissal_time, body.grace_period_minutes ?? 0, body.effective_from, body.effective_to ?? null, body.change_reason ?? null, user.username]);
        id = Number(created.lastInsertRowid);
        const snapshot = JSON.stringify({ id, jenjang, weekday: body.weekday, dismissal_time: body.dismissal_time, grace_period_minutes: body.grace_period_minutes ?? 0, effective_from: body.effective_from, effective_to: body.effective_to ?? null, is_active: true });
        client.run("INSERT INTO dismissal_policy_audits (policy_id, action, change_reason, actor, timestamp, policy_snapshot) VALUES (?, 'CREATED', ?, ?, CURRENT_TIMESTAMP, ?)", [id, body.change_reason ?? null, user.username, snapshot]);
      });
      ctx.set.status = 201;
      return policyPayload(row(context, "SELECT * FROM dismissal_policies WHERE id = ?", [id]) as Row);
    } catch { return fail(ctx.set, 409, "Dismissal policy could not be saved."); }
  }, { body: policyBody });

  app.post("/api/attendance/departure-policies/:policy_id/deactivate", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "manage_early_departure_policy" }); if (!user) return { detail: "Insufficient permissions" };
    const value = row(context, "SELECT * FROM dismissal_policies WHERE id = ?", [ctx.params.policy_id]);
    if (!value || !value.is_active) return fail(ctx.set, 404, { code: "DISMISSAL_POLICY_NOT_FOUND", message: "Dismissal policy was not found or is inactive" });
    try {
      inTransaction(context.database.client, () => {
        context.database.client.run("UPDATE dismissal_policies SET is_active = 0, change_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [ctx.body.change_reason ?? null, value.id]);
        context.database.client.run("INSERT INTO dismissal_policy_audits (policy_id, action, change_reason, actor, timestamp, policy_snapshot) VALUES (?, 'DEACTIVATED', ?, ?, CURRENT_TIMESTAMP, ?)", [value.id, ctx.body.change_reason ?? null, user.username, JSON.stringify({ id: value.id, is_active: false, change_reason: ctx.body.change_reason ?? null })]);
      });
      return { id: value.id, is_active: false, status: "DEACTIVATED" };
    } catch { return fail(ctx.set, 409, "Dismissal policy could not be deactivated."); }
  }, { params: t.Object({ policy_id: t.Number({ minimum: 1 }) }), body: t.Object({ change_reason: t.Optional(t.String()) }) });

  app.get("/api/attendance/classes/:class_id/dates/:date_val/departures", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_early_departure" }); if (!user) return { detail: "Insufficient permissions" };
    const date = ctx.params.date_val;
    if (!dateValue(date)) return fail(ctx.set, 400, "Invalid date");
    const classValue = row(context, "SELECT id, class_name FROM academic_classes WHERE id = ?", [ctx.params.class_id]);
    const className = classValue?.class_name ?? String(ctx.params.class_id);
    if (!canManageAll(user) && !hasClassAccess(context, user.id, className, date)) return fail(ctx.set, 403, { code: "EARLY_DEPARTURE_CLASS_SCOPE_FORBIDDEN", message: "Access to unassigned class early departure is forbidden" });
    const students = rows(context, "SELECT id, name, class_name, jenjang FROM students WHERE class_name = ? ORDER BY name", [className]);
    const finalized = Boolean(row(context, "SELECT id FROM attendance_periods WHERE attendance_date = ? AND status = 'FINALIZED'", [date]));
    const departures = students.map((student) => {
      const attendance = row(context, "SELECT * FROM attendance WHERE student_id = ? AND date = ?", [student.id, date]);
      if (!attendance) return { student_id: student.id, student_name: student.name, class_name: student.class_name, attendance_id: null, date, classification: "MISSING_CHECKOUT", effective_check_in: null, effective_check_out: null, raw_check_out: null, has_override: false, scheduled_dismissal: null, grace_period_minutes: 0, minutes_early: 0, policy_id: null, excuse: null, has_pending_correction: false, is_period_finalized: finalized };
      const override = row(context, "SELECT * FROM attendance_overrides WHERE attendance_id = ?", [attendance.id]);
      const excuse = row(context, "SELECT * FROM early_departure_excuses WHERE attendance_id = ? AND state = 'ACTIVE'", [attendance.id]);
      const pending = Boolean(row(context, "SELECT id FROM attendance_correction_requests WHERE attendance_id = ? AND state = 'SUBMITTED'", [attendance.id]));
      return { student_name: student.name, class_name: student.class_name, ...departurePayload(attendance, override, policyFor(context, student.jenjang ?? "Primary", date), excuse, pending, finalized) };
    });
    return { class_id: ctx.params.class_id, date, departures };
  }, { params: t.Object({ class_id: t.String(), date_val: t.String() }) });

  app.post("/api/attendance/:attendance_id/departure-excuses", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "record_early_departure_excuse" }); if (!user) return { detail: "Insufficient permissions" };
    const attendance = row(context, "SELECT a.*, s.class_name FROM attendance a LEFT JOIN students s ON s.id = a.student_id WHERE a.id = ?", [ctx.params.attendance_id]);
    if (!attendance) return fail(ctx.set, 404, "Attendance record not found");
    const admin = isAdmin(user);
    if (!admin && !hasClassAccess(context, user.id, attendance.class_name ?? "", attendance.date)) return fail(ctx.set, 403, { code: "EARLY_DEPARTURE_CLASS_SCOPE_FORBIDDEN", message: "Cannot record excuse for unassigned class" });
    if (!periodOpen(context, attendance.date) && !admin) return fail(ctx.set, 400, { code: "ATTENDANCE_PERIOD_FINALIZED", message: "Operation rejected: ATTENDANCE_PERIOD_FINALIZED" });
    if (row(context, "SELECT id FROM early_departure_excuses WHERE attendance_id = ? AND state = 'ACTIVE'", [attendance.id])) return fail(ctx.set, 400, { code: "EARLY_DEPARTURE_EXCUSE_ALREADY_ACTIVE", message: "Operation rejected: EARLY_DEPARTURE_EXCUSE_ALREADY_ACTIVE" });
    const client = context.database.client; let id = 0;
    try {
      inTransaction(client, () => {
        const created = client.run("INSERT INTO early_departure_excuses (attendance_id, reason_code, explanation, state, recorded_by, recorded_at) VALUES (?, ?, ?, 'ACTIVE', ?, CURRENT_TIMESTAMP)", [attendance.id, ctx.body.reason_code.trim(), ctx.body.explanation?.trim() ?? null, user.username]);
        id = Number(created.lastInsertRowid);
        client.run("INSERT INTO early_departure_excuse_audits (excuse_id, action, actor, timestamp, reason_code) VALUES (?, 'RECORDED', ?, CURRENT_TIMESTAMP, ?)", [id, user.username, ctx.body.reason_code.trim()]);
      });
      ctx.set.status = 201;
      return excusePayload(row(context, "SELECT * FROM early_departure_excuses WHERE id = ?", [id]) as Row);
    } catch { return fail(ctx.set, 409, "Early departure excuse could not be saved."); }
  }, { params: t.Object({ attendance_id: t.Number({ minimum: 1 }) }), body: t.Object({ reason_code: t.String({ minLength: 1 }), explanation: t.Optional(t.String()) }) });

  app.post("/api/attendance/:attendance_id/departure-excuses/:excuse_id/revoke", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "revoke_early_departure_excuse" }); if (!user) return { detail: "Insufficient permissions" };
    const value = row(context, "SELECT e.*, a.date, s.class_name FROM early_departure_excuses e JOIN attendance a ON a.id = e.attendance_id LEFT JOIN students s ON s.id = a.student_id WHERE e.id = ?", [ctx.params.excuse_id]);
    if (!value || value.state !== "ACTIVE") return fail(ctx.set, 400, { code: "EARLY_DEPARTURE_EXCUSE_NOT_ACTIVE", message: "Operation rejected: EARLY_DEPARTURE_EXCUSE_NOT_ACTIVE" });
    const admin = isAdmin(user);
    if (!admin && !hasClassAccess(context, user.id, value.class_name ?? "", value.date)) return fail(ctx.set, 403, { code: "EARLY_DEPARTURE_CLASS_SCOPE_FORBIDDEN", message: "Cannot revoke excuse for unassigned class" });
    if (!periodOpen(context, value.date) && !admin) return fail(ctx.set, 400, { code: "ATTENDANCE_PERIOD_FINALIZED", message: "Operation rejected: ATTENDANCE_PERIOD_FINALIZED" });
    inTransaction(context.database.client, () => {
      context.database.client.run("UPDATE early_departure_excuses SET state = 'REVOKED', revoked_by = ?, revoked_at = CURRENT_TIMESTAMP, revocation_reason = ? WHERE id = ?", [user.username, ctx.body.revocation_reason.trim(), value.id]);
      context.database.client.run("INSERT INTO early_departure_excuse_audits (excuse_id, action, actor, timestamp, reason_code, revocation_reason) VALUES (?, 'REVOKED', ?, CURRENT_TIMESTAMP, ?, ?)", [value.id, user.username, value.reason_code, ctx.body.revocation_reason.trim()]);
    });
    return excusePayload(row(context, "SELECT * FROM early_departure_excuses WHERE id = ?", [value.id]) as Row);
  }, { params: t.Object({ attendance_id: t.Number({ minimum: 1 }), excuse_id: t.Number({ minimum: 1 }) }), body: t.Object({ revocation_reason: t.String({ minLength: 1 }) }) });

  app.get("/api/attendance/:attendance_id/departure-history", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_early_departure" }); if (!user) return { detail: "Insufficient permissions" };
    if (!row(context, "SELECT id FROM attendance WHERE id = ?", [ctx.params.attendance_id])) return fail(ctx.set, 404, "Attendance record not found");
    const excuses = rows(context, "SELECT * FROM early_departure_excuses WHERE attendance_id = ? ORDER BY recorded_at DESC", [ctx.params.attendance_id]);
    const ids = excuses.map((value) => value.id);
    return {
      attendance_id: Number(ctx.params.attendance_id), excuses: excuses.map(excusePayload),
      audit_trail: ids.length ? rows(context, `SELECT id, excuse_id, action, actor, timestamp, reason_code, revocation_reason FROM early_departure_excuse_audits WHERE excuse_id IN (${ids.map(() => "?").join(",")}) ORDER BY timestamp DESC, id DESC`, ids) : [],
      overrides: rows(context, "SELECT id, override_check_in, override_check_out, reviewed_by AS actor, reviewed_at AS timestamp FROM attendance_overrides WHERE attendance_id = ?", [ctx.params.attendance_id]).map((value) => ({ ...value, override_check_in: value.override_check_in ? String(value.override_check_in).slice(0, 5) : null, override_check_out: value.override_check_out ? String(value.override_check_out).slice(0, 5) : null })),
    };
  }, { params: t.Object({ attendance_id: t.Number({ minimum: 1 }) }) });
}
