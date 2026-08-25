import { t } from "elysia";
import { authorize, readCookie, requestContext, SESSION_COOKIE_NAME, type AuthContext, type CurrentUser } from "../auth/service";
import { actor } from "./core";

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

function currentUser(context: AuthContext, ctx: Context): CurrentUser | null {
  const requestInfo = requestContext(ctx.request, ctx.server);
  const result = authorize(context, readCookie(ctx.request, SESSION_COOKIE_NAME), {}, {
    path: ctx.path, userAgent: requestInfo.userAgent, ipAddress: requestInfo.ipAddress,
  });
  if ("user" in result) return result.user;
  fail(ctx.set, result.status, result.message);
  return null;
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

  const termBody = t.Object({ academic_year_id: t.Number({ minimum: 1 }), term_number: t.Number({ minimum: 1, maximum: 4 }), label: t.String({ minLength: 1, maxLength: 80 }), start_date: t.String(), end_date: t.String() });
  app.get("/api/academic-config/terms", (ctx: Context) => { if (!currentUser(context, ctx)) return { detail: "Authentication required" }; const values = rows(context, `SELECT * FROM academic_term_configs ${ctx.query.academic_year_id ? "WHERE academic_year_id = ?" : ""} ORDER BY academic_year_id, term_number`, ctx.query.academic_year_id ? [Number(ctx.query.academic_year_id)] : []); return values; }, { query: t.Object({ academic_year_id: t.Optional(t.String()) }) });
  app.post("/api/academic-config/terms", (ctx: Context) => { const user = actor(context, ctx, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" }; if (ctx.body.end_date < ctx.body.start_date) return fail(ctx.set, 422, "start_date must be on or before end_date"); if (!row(context, "SELECT id FROM academic_years WHERE id = ?", [ctx.body.academic_year_id])) return fail(ctx.set, 404, "Academic year not found"); try { const result = context.database.client.run("INSERT INTO academic_term_configs (academic_year_id, term_number, label, start_date, end_date) VALUES (?, ?, ?, ?, ?)", [ctx.body.academic_year_id, ctx.body.term_number, ctx.body.label.trim(), ctx.body.start_date, ctx.body.end_date]); setStatus(ctx, 201); return row(context, "SELECT * FROM academic_term_configs WHERE id = ?", [Number(result.lastInsertRowid)]); } catch { return fail(ctx.set, 409, "Term config already exists for this academic year and term"); } }, { body: termBody });
  app.put("/api/academic-config/terms/:term_id", (ctx: Context) => { const user = actor(context, ctx, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" }; const before = row(context, "SELECT * FROM academic_term_configs WHERE id = ?", [ctx.params.term_id]); if (!before) return fail(ctx.set, 404, "Term config not found"); if (ctx.body.end_date < ctx.body.start_date) return fail(ctx.set, 422, "start_date must be on or before end_date"); try { context.database.client.run("UPDATE academic_term_configs SET academic_year_id = ?, term_number = ?, label = ?, start_date = ?, end_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [ctx.body.academic_year_id, ctx.body.term_number, ctx.body.label.trim(), ctx.body.start_date, ctx.body.end_date, ctx.params.term_id]); return row(context, "SELECT * FROM academic_term_configs WHERE id = ?", [ctx.params.term_id]); } catch { return fail(ctx.set, 409, "Term config conflict detected"); } }, { params: t.Object({ term_id: t.Number({ minimum: 1 }) }), body: termBody });
  app.delete("/api/academic-config/terms/:term_id", (ctx: Context) => { const user = actor(context, ctx, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" }; const result = context.database.client.run("DELETE FROM academic_term_configs WHERE id = ?", [ctx.params.term_id]); if (!result.changes) return fail(ctx.set, 404, "Term config not found"); ctx.set.status = 204; return undefined; }, { params: t.Object({ term_id: t.Number({ minimum: 1 }) }) });

  const kkmBody = t.Object({ academic_year_id: t.Number({ minimum: 1 }), jenjang_id: t.Optional(t.Number({ minimum: 1 })), subject_id: t.Optional(t.Number({ minimum: 1 })), assessment_type: t.Union([t.Literal("sumatif"), t.Literal("formatif"), t.Literal("overall")]), threshold: t.Number({ minimum: 0, maximum: 100 }) });
  app.get("/api/academic-config/kkm-thresholds", (ctx: Context) => { if (!currentUser(context, ctx)) return { detail: "Authentication required" }; const where: string[] = []; const params: any[] = []; for (const key of ["academic_year_id", "jenjang_id", "subject_id"]) if (ctx.query[key] !== undefined) { where.push(`${key} = ?`); params.push(Number(ctx.query[key])); } return rows(context, `SELECT * FROM kkm_thresholds ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY academic_year_id, jenjang_id, subject_id, assessment_type`, params); }, { query: t.Object({ academic_year_id: t.Optional(t.String()), jenjang_id: t.Optional(t.String()), subject_id: t.Optional(t.String()) }) });
  app.post("/api/academic-config/kkm-thresholds", (ctx: Context) => { const user = actor(context, ctx, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" }; try { const result = context.database.client.run("INSERT INTO kkm_thresholds (academic_year_id, jenjang_id, subject_id, assessment_type, threshold) VALUES (?, ?, ?, ?, ?)", [ctx.body.academic_year_id, ctx.body.jenjang_id ?? null, ctx.body.subject_id ?? null, ctx.body.assessment_type, ctx.body.threshold]); setStatus(ctx, 201); return row(context, "SELECT * FROM kkm_thresholds WHERE id = ?", [Number(result.lastInsertRowid)]); } catch { return fail(ctx.set, 409, "KKM threshold conflict detected"); } }, { body: kkmBody });

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

export function systemRoutes(app: any, config: { destructiveOperationsEnabled?: boolean } = {}): any {
  app.get("/api/system/health", () => ({ status: "ok", service: "System API", destructive_operations_enabled: config.destructiveOperationsEnabled ?? false }));
  return app;
}
