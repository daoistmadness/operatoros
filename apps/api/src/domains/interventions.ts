import { t } from "elysia";
import type { AuthContext } from "../auth/service";
import { actor } from "./core";

type Row = Record<string, any>;
type Context = any;

function rows(context: AuthContext, sql: string, params: any[] = []): Row[] { return context.database.client.query(sql).all(...params) as Row[]; }
function row(context: AuthContext, sql: string, params: any[] = []): Row | null { return (context.database.client.query(sql).get(...params) as Row | null) ?? null; }
function fail(set: any, status: number, detail: string | Record<string, unknown>) { set.status = status; return { detail }; }

const assessment = t.Optional(t.Union([t.Literal("sumatif"), t.Literal("formatif"), t.Literal("overall")]));
const createBody = t.Object({
  student_id: t.Number({ minimum: 1 }), enrollment_id: t.Optional(t.Number({ minimum: 1 })), academic_year_id: t.Number({ minimum: 1 }),
  jenjang_id: t.Optional(t.Number({ minimum: 1 })), subject_id: t.Number({ minimum: 1 }), assessment_type: assessment,
  term: t.Optional(t.String({ maxLength: 40 })), class_name: t.Optional(t.String({ maxLength: 80 })), student_name: t.String({ minLength: 1, maxLength: 255 }), subject_name: t.String({ minLength: 1, maxLength: 255 }),
  effective_threshold: t.Number({ minimum: 0, maximum: 100 }), threshold_source: t.String({ minLength: 1, maxLength: 80 }), current_average: t.Optional(t.Union([t.Number({ minimum: 0, maximum: 100 }), t.Null()])),
  status: t.Optional(t.Union([t.Literal("open"), t.Literal("in_progress"), t.Literal("monitoring"), t.Literal("resolved"), t.Literal("closed")])), priority: t.Optional(t.Union([t.Literal("low"), t.Literal("medium"), t.Literal("high"), t.Literal("urgent")])),
  owner_name: t.Optional(t.String({ maxLength: 120 })), planned_action: t.Optional(t.String()), notes: t.Optional(t.String()), follow_up_date: t.Optional(t.String()), outcome: t.Optional(t.String()),
});
const updateBody = t.Object({ status: t.Optional(t.Union([t.Literal("open"), t.Literal("in_progress"), t.Literal("monitoring"), t.Literal("resolved"), t.Literal("closed")])), priority: t.Optional(t.Union([t.Literal("low"), t.Literal("medium"), t.Literal("high"), t.Literal("urgent")])), owner_name: t.Optional(t.String({ maxLength: 120 })), planned_action: t.Optional(t.String()), notes: t.Optional(t.String()), follow_up_date: t.Optional(t.String()), outcome: t.Optional(t.String()) });

function serialize(value: Row): Row {
  return { ...value, effective_threshold: Number(value.effective_threshold), current_average: value.current_average === null ? null : Number(value.current_average) };
}

function validDate(value: string | null | undefined): boolean { return value === undefined || value === null || value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value); }

function references(context: AuthContext, body: Row, set: any): boolean {
  if (!row(context, "SELECT id FROM students WHERE id = ?", [body.student_id])) { fail(set, 404, "Student not found"); return false; }
  if (!row(context, "SELECT id FROM academic_years WHERE id = ?", [body.academic_year_id])) { fail(set, 404, "Academic year not found"); return false; }
  if (!row(context, "SELECT id FROM subjects WHERE id = ?", [body.subject_id])) { fail(set, 404, "Subject not found"); return false; }
  if (body.jenjang_id !== undefined && body.jenjang_id !== null && !row(context, "SELECT id FROM jenjangs WHERE id = ?", [body.jenjang_id])) { fail(set, 404, "Jenjang not found"); return false; }
  if (body.enrollment_id !== undefined && body.enrollment_id !== null) {
    const enrollment = row(context, "SELECT student_id, academic_year_id FROM student_enrollments WHERE id = ?", [body.enrollment_id]);
    if (!enrollment) { fail(set, 404, "Student enrollment not found"); return false; }
    if (Number(enrollment.student_id) !== Number(body.student_id) || Number(enrollment.academic_year_id) !== Number(body.academic_year_id)) { fail(set, 400, "Enrollment does not match student and academic year"); return false; }
  }
  return true;
}

function duplicate(context: AuthContext, body: Row, excludeId?: number): Row | null {
  const clauses = ["student_id = ?", "academic_year_id = ?", "subject_id = ?", body.assessment_type == null ? "assessment_type IS NULL" : "assessment_type = ?", body.term == null ? "term IS NULL" : "term = ?", "status IN ('open', 'in_progress', 'monitoring')"];
  const params = [body.student_id, body.academic_year_id, body.subject_id, ...(body.assessment_type == null ? [] : [body.assessment_type]), ...(body.term == null ? [] : [body.term]), ...(excludeId === undefined ? [] : [excludeId])];
  if (excludeId !== undefined) clauses.push("id != ?");
  return row(context, `SELECT id FROM academic_interventions WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT 1`, params);
}

function save(context: AuthContext, ctx: Context): Row | { detail: unknown } {
  const body = ctx.body as Row;
  if (!validDate(body.follow_up_date)) return fail(ctx.set, 422, "follow_up_date must use YYYY-MM-DD format");
  if (!references(context, body, ctx.set)) return { detail: "Invalid intervention references" };
  const status = body.status ?? "open";
  if (duplicate(context, body) && ["open", "in_progress", "monitoring"].includes(status)) return fail(ctx.set, 409, "Active intervention already exists for this context");
  try {
    const result = context.database.client.run("INSERT INTO academic_interventions (student_id, enrollment_id, academic_year_id, jenjang_id, subject_id, assessment_type, term, class_name, student_name, subject_name, effective_threshold, threshold_source, current_average, status, priority, owner_name, planned_action, notes, follow_up_date, outcome, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [body.student_id, body.enrollment_id ?? null, body.academic_year_id, body.jenjang_id ?? null, body.subject_id, body.assessment_type ?? null, body.term ?? null, body.class_name ?? null, body.student_name, body.subject_name, body.effective_threshold, body.threshold_source, body.current_average ?? null, status, body.priority ?? "medium", body.owner_name ?? null, body.planned_action ?? null, body.notes ?? null, body.follow_up_date || null, body.outcome ?? null, ["resolved", "closed"].includes(status) ? new Date().toISOString().replace("T", " ").replace("Z", "") : null]);
    return serialize(row(context, "SELECT * FROM academic_interventions WHERE id = ?", [Number(result.lastInsertRowid)]) as Row);
  } catch { return fail(ctx.set, 409, "The intervention record could not be saved. Retry or contact the system administrator."); }
}

export function interventionRoutes(app: any, context: AuthContext): any {
  const query = t.Object({ academic_year_id: t.Optional(t.String()), jenjang_id: t.Optional(t.String()), class_name: t.Optional(t.String()), student_id: t.Optional(t.String()), subject_id: t.Optional(t.String()), term: t.Optional(t.String()), status: t.Optional(t.String()), priority: t.Optional(t.String()) });
  app.get("/api/academic-interventions", (ctx: Context) => { if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" }; const clauses: string[] = []; const params: any[] = []; for (const key of ["academic_year_id", "jenjang_id", "student_id", "subject_id"]) if (ctx.query[key] !== undefined) { clauses.push(`${key} = ?`); params.push(Number(ctx.query[key])); } for (const key of ["class_name", "term", "status", "priority"]) if (ctx.query[key] !== undefined) { clauses.push(`${key} = ?`); params.push(ctx.query[key]); } return rows(context, `SELECT * FROM academic_interventions ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC, id DESC`, params).map(serialize); }, { query });
  app.post("/api/academic-interventions", (ctx: Context) => { if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" }; return save(context, ctx); }, { body: createBody });
  app.post("/api/academic-interventions/from-alert", (ctx: Context) => { if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" }; return save(context, ctx); }, { body: createBody });
  app.get("/api/academic-interventions/:intervention_id", (ctx: Context) => { if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" }; const value = row(context, "SELECT * FROM academic_interventions WHERE id = ?", [ctx.params.intervention_id]); return value ? serialize(value) : fail(ctx.set, 404, "Academic intervention not found"); }, { params: t.Object({ intervention_id: t.Number({ minimum: 1 }) }) });
  app.patch("/api/academic-interventions/:intervention_id", (ctx: Context) => { if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" }; const before = row(context, "SELECT * FROM academic_interventions WHERE id = ?", [ctx.params.intervention_id]); if (!before) return fail(ctx.set, 404, "Academic intervention not found"); if (!validDate(ctx.body.follow_up_date)) return fail(ctx.set, 422, "follow_up_date must use YYYY-MM-DD format"); const updates = ctx.body as Row; const fields = ["status", "priority", "owner_name", "planned_action", "notes", "follow_up_date", "outcome"].filter((key) => updates[key] !== undefined); try { if (fields.length) { const values = fields.map((key) => updates[key] ?? null); if (updates.status && ["resolved", "closed"].includes(updates.status) && !before.resolved_at) { fields.push("resolved_at"); values.push(new Date().toISOString().replace("T", " ").replace("Z", "")); } context.database.client.run(`UPDATE academic_interventions SET ${fields.map((key) => `${key} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...values, ctx.params.intervention_id]); } return serialize(row(context, "SELECT * FROM academic_interventions WHERE id = ?", [ctx.params.intervention_id]) as Row); } catch { return fail(ctx.set, 409, "The intervention record could not be updated. Retry or contact the system administrator."); } }, { params: t.Object({ intervention_id: t.Number({ minimum: 1 }) }), body: updateBody });
  app.delete("/api/academic-interventions/:intervention_id", (ctx: Context) => { if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" }; const value = row(context, "SELECT id, resolved_at FROM academic_interventions WHERE id = ?", [ctx.params.intervention_id]); if (!value) return fail(ctx.set, 404, "Academic intervention not found"); try { context.database.client.run("UPDATE academic_interventions SET status = 'closed', resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?", [ctx.params.intervention_id]); return { status: "success", closed: 1, id: ctx.params.intervention_id }; } catch { return fail(ctx.set, 409, "The intervention record could not be closed. Retry or contact the system administrator."); } }, { params: t.Object({ intervention_id: t.Number({ minimum: 1 }) }) });
}
