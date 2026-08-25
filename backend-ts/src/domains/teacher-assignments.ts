import { t } from "elysia";
import { actor } from "./core";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;
const roles = ["HOMEROOM_TEACHER", "ATTENDANCE_TEACHER", "SUBJECT_TEACHER", "ASSISTANT_TEACHER"] as const;

function row(context: AuthContext, sql: string, params: any[] = []): Row | null {
  return (context.database.client.query(sql).get(...params) as Row | null) ?? null;
}

function rows(context: AuthContext, sql: string, params: any[] = []): Row[] {
  return context.database.client.query(sql).all(...params) as Row[];
}

function fail(set: any, status: number, code: string, message: string): { detail: { code: string; message: string } } {
  set.status = status;
  return { detail: { code, message } };
}

function validDateRange(from: string | null, to: string | null): boolean {
  return !from || !to || to >= from;
}

function overlaps(from: string | null, to: string | null, otherFrom: string | null, otherTo: string | null): boolean {
  return !(from && otherTo && from > otherTo) && !(to && otherFrom && to < otherFrom);
}

function serialize(context: AuthContext, value: Row): Row {
  const user = row(context, "SELECT username FROM users WHERE id = ?", [value.user_id]);
  const year = row(context, "SELECT label FROM academic_years WHERE id = ?", [value.academic_year_id]);
  const academicClass = row(context, "SELECT class_name FROM academic_classes WHERE id = ?", [value.academic_class_id]);
  const subject = value.subject_id == null ? null : row(context, "SELECT name FROM subjects WHERE id = ?", [value.subject_id]);
  return {
    id: Number(value.id), user_id: Number(value.user_id), username: user?.username ?? null,
    academic_year_id: Number(value.academic_year_id), academic_year_label: year?.label ?? null,
    academic_class_id: Number(value.academic_class_id), class_name: academicClass?.class_name ?? null,
    class_role: value.class_role, subject_id: value.subject_id == null ? null : Number(value.subject_id), subject_name: subject?.name ?? null,
    effective_from: value.effective_from ?? null, effective_to: value.effective_to ?? null,
    active: Boolean(Number(value.active)), assigned_by: value.assigned_by,
    created_at: value.created_at ?? null, updated_at: value.updated_at ?? null,
  };
}

function audit(context: AuthContext, action: string, actorUsername: string, value: Row, before: Row | null, after: Row | null): void {
  context.database.client.run(
    "INSERT INTO teacher_class_assignment_audit (assignment_id, user_id, academic_class_id, academic_year_id, action, actor, before_summary, after_summary, source_workflow, metadata_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'TEACHER_CLASS_ASSIGNMENT', 1)",
    [value.id, value.user_id, value.academic_class_id, value.academic_year_id, action, actorUsername, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null],
  );
}

function duplicate(context: AuthContext, value: Row): boolean {
  const existing = rows(context, "SELECT id, effective_from, effective_to FROM teacher_class_assignments WHERE user_id = ? AND academic_class_id = ? AND class_role = ? AND active = 1 AND (? IS NULL OR id != ?)", [value.user_id, value.academic_class_id, value.class_role, value.id ?? null, value.id ?? null]);
  return existing.some((item) => overlaps(value.effective_from, value.effective_to, item.effective_from ?? null, item.effective_to ?? null));
}

function validateCreate(context: AuthContext, set: any, body: Row): boolean {
  const user = row(context, "SELECT id FROM users WHERE id = ? AND is_active = 1", [body.user_id]);
  if (!user) { fail(set, 400, "USER_NOT_FOUND", "Target user was not found or is inactive."); return false; }
  const academicClass = row(context, "SELECT id, academic_year_id, active FROM academic_classes WHERE id = ?", [body.academic_class_id]);
  if (!academicClass || !Number(academicClass.active)) { fail(set, 400, "CLASS_NOT_ACTIVE", "Archived or inactive classes cannot receive new assignments."); return false; }
  const year = row(context, "SELECT id, status FROM academic_years WHERE id = ?", [body.academic_year_id]);
  if (!year || year.status === "closed") { fail(set, 400, "ACADEMIC_YEAR_CLOSED", "Closed academic years cannot receive active assignments."); return false; }
  if (Number(academicClass.academic_year_id) !== Number(body.academic_year_id)) { fail(set, 400, "TEACHER_CLASS_ASSIGNMENT_REQUIRED", "Academic class does not match specified academic year."); return false; }
  if (!roles.includes(body.class_role)) { fail(set, 400, "INVALID_CLASS_ROLE", `class_role must be one of ${roles.join(", ")}`); return false; }
  if (body.subject_id != null && !row(context, "SELECT id FROM subjects WHERE id = ?", [body.subject_id])) { fail(set, 400, "SUBJECT_NOT_FOUND", "Subject not found."); return false; }
  if (!validDateRange(body.effective_from ?? null, body.effective_to ?? null)) { fail(set, 400, "INVALID_DATE_RANGE", "effective_to cannot be earlier than effective_from."); return false; }
  if (duplicate(context, body)) { fail(set, 400, "TEACHER_CLASS_ASSIGNMENT_OVERLAP", "An overlapping active assignment exists for the specified teacher, class, and role."); return false; }
  return true;
}

export function teacherAssignmentRoutes(app: any, context: AuthContext): any {
  const query = t.Object({ user_id: t.Optional(t.String()), academic_year_id: t.Optional(t.String()), academic_class_id: t.Optional(t.String()), active_only: t.Optional(t.String()) });
  const body = t.Object({ user_id: t.Number({ minimum: 1 }), academic_year_id: t.Number({ minimum: 1 }), academic_class_id: t.Number({ minimum: 1 }), class_role: t.String(), subject_id: t.Optional(t.Nullable(t.Number({ minimum: 1 }))), effective_from: t.Optional(t.Nullable(t.String())), effective_to: t.Optional(t.Nullable(t.String())) });
  app.get("/api/teacher-class-assignments", (ctx: Context) => {
    const user = actor(context, ctx, {}); if (!user) return { detail: "Authentication required" };
    const requestedUser = ctx.query.user_id === undefined ? null : Number(ctx.query.user_id);
    if (user.role !== "admin" && requestedUser !== null && requestedUser !== user.id) return fail(ctx.set, 403, "ATTENDANCE_CLASS_SCOPE_FORBIDDEN", "Insufficient permissions to view other users' assignments.");
    const clauses: string[] = []; const params: any[] = [];
    const targetUser = user.role === "admin" ? requestedUser : user.id;
    if (targetUser !== null) { clauses.push("a.user_id = ?"); params.push(targetUser); }
    if (ctx.query.academic_year_id !== undefined) { clauses.push("a.academic_year_id = ?"); params.push(Number(ctx.query.academic_year_id)); }
    if (ctx.query.academic_class_id !== undefined) { clauses.push("a.academic_class_id = ?"); params.push(Number(ctx.query.academic_class_id)); }
    if (ctx.query.active_only !== "false") clauses.push("a.active = 1");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return rows(context, `SELECT a.* FROM teacher_class_assignments a ${where} ORDER BY a.id DESC`, params).map((value) => serialize(context, value));
  }, { query });
  app.post("/api/teacher-class-assignments", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "manage_teacher_class_assignments" }); if (!user) return { detail: "Insufficient permissions" };
    const value = { ...ctx.body, class_role: String(ctx.body.class_role).trim(), effective_from: ctx.body.effective_from ?? null, effective_to: ctx.body.effective_to ?? null };
    if (!validateCreate(context, ctx.set, value)) return { detail: "Invalid assignment" };
    const result = context.database.client.run("INSERT INTO teacher_class_assignments (user_id, academic_year_id, academic_class_id, class_role, subject_id, effective_from, effective_to, active, assigned_by) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)", [value.user_id, value.academic_year_id, value.academic_class_id, value.class_role, value.subject_id ?? null, value.effective_from, value.effective_to, user.username]);
    const created = row(context, "SELECT * FROM teacher_class_assignments WHERE id = ?", [Number(result.lastInsertRowid)]) as Row;
    const after = serialize(context, created); audit(context, "ASSIGNMENT_CREATED", user.username, created, null, after); return after;
  }, { body });
  app.patch("/api/teacher-class-assignments/:assignment_id", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "manage_teacher_class_assignments" }); if (!user) return { detail: "Insufficient permissions" };
    const current = row(context, "SELECT * FROM teacher_class_assignments WHERE id = ?", [ctx.params.assignment_id]); if (!current) return fail(ctx.set, 404, "TEACHER_CLASS_ASSIGNMENT_NOT_FOUND", "Assignment not found.");
    const value = { ...current, ...ctx.body, class_role: ctx.body.class_role === undefined || ctx.body.class_role === null ? current.class_role : String(ctx.body.class_role).trim(), effective_from: ctx.body.effective_from === undefined ? current.effective_from : ctx.body.effective_from, effective_to: ctx.body.effective_to === undefined ? current.effective_to : ctx.body.effective_to };
    if (!roles.includes(value.class_role)) return fail(ctx.set, 400, "INVALID_CLASS_ROLE", `class_role must be one of ${roles.join(", ")}`);
    if (!validDateRange(value.effective_from ?? null, value.effective_to ?? null)) return fail(ctx.set, 400, "INVALID_DATE_RANGE", "effective_to cannot be earlier than effective_from.");
    if (ctx.body.subject_id !== undefined && ctx.body.subject_id !== null && !row(context, "SELECT id FROM subjects WHERE id = ?", [ctx.body.subject_id])) return fail(ctx.set, 400, "SUBJECT_NOT_FOUND", "Subject not found.");
    if ((value.class_role !== current.class_role || value.effective_from !== current.effective_from || value.effective_to !== current.effective_to) && duplicate(context, { ...value, id: Number(current.id) })) return fail(ctx.set, 400, "TEACHER_CLASS_ASSIGNMENT_OVERLAP", "An overlapping active assignment exists for the specified teacher, class, and role.");
    context.database.client.run("UPDATE teacher_class_assignments SET class_role = ?, subject_id = ?, effective_from = ?, effective_to = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [value.class_role, ctx.body.subject_id === undefined ? current.subject_id : ctx.body.subject_id, value.effective_from ?? null, value.effective_to ?? null, ctx.body.active === undefined ? current.active : (ctx.body.active ? 1 : 0), current.id]);
    const updated = row(context, "SELECT * FROM teacher_class_assignments WHERE id = ?", [current.id]) as Row; const before = serialize(context, current); const after = serialize(context, updated); audit(context, "ASSIGNMENT_MODIFIED", user.username, updated, before, after); return after;
  }, { params: t.Object({ assignment_id: t.Number({ minimum: 1 }) }), body: t.Object({ class_role: t.Optional(t.Nullable(t.String())), subject_id: t.Optional(t.Nullable(t.Number({ minimum: 1 }))), effective_from: t.Optional(t.Nullable(t.String())), effective_to: t.Optional(t.Nullable(t.String())), active: t.Optional(t.Boolean()) }) });
  for (const [action, active, code, message] of [["deactivate", 0, "ASSIGNMENT_DEACTIVATED", "Assignment not found."] as const, ["reactivate", 1, "ASSIGNMENT_REACTIVATED", "Assignment not found."] as const]) {
    app.post(`/api/teacher-class-assignments/:assignment_id/${action}`, (ctx: Context) => {
      const user = actor(context, ctx, { capability: "manage_teacher_class_assignments" }); if (!user) return { detail: "Insufficient permissions" };
      const current = row(context, "SELECT * FROM teacher_class_assignments WHERE id = ?", [ctx.params.assignment_id]); if (!current) return fail(ctx.set, 404, "TEACHER_CLASS_ASSIGNMENT_NOT_FOUND", message);
      if (Number(current.active) === active) return serialize(context, current);
      if (active === 1) {
        const academicClass = row(context, "SELECT active FROM academic_classes WHERE id = ?", [current.academic_class_id]); const year = row(context, "SELECT status FROM academic_years WHERE id = ?", [current.academic_year_id]);
        if (!academicClass || !Number(academicClass.active)) return fail(ctx.set, 400, "CLASS_NOT_ACTIVE", "Cannot reactivate assignment for an archived class.");
        if (!year || year.status === "closed") return fail(ctx.set, 400, "ACADEMIC_YEAR_CLOSED", "Cannot reactivate assignment for a closed academic year.");
        if (duplicate(context, current)) return fail(ctx.set, 400, "TEACHER_CLASS_ASSIGNMENT_OVERLAP", "Cannot reactivate assignment because an overlapping active assignment exists.");
      }
      const before = serialize(context, current); context.database.client.run("UPDATE teacher_class_assignments SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [active, current.id]);
      const updated = row(context, "SELECT * FROM teacher_class_assignments WHERE id = ?", [current.id]) as Row; const after = serialize(context, updated); audit(context, code, user.username, updated, before, after); return after;
    }, { params: t.Object({ assignment_id: t.Number({ minimum: 1 }) }) });
  }
  return app;
}
