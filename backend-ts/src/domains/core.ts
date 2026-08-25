import { t } from "elysia";
import { randomUUID } from "node:crypto";
import { inTransaction } from "../db/connection";
import { authorize, readCookie, requestContext, SESSION_COOKIE_NAME, type AuthContext, type CurrentUser } from "../auth/service";

type Row = Record<string, any>;
type Context = any;

function rows(client: AuthContext["database"]["client"], sql: string, params: any[] = []): Row[] {
  return client.query(sql).all(...params) as Row[];
}

function row(client: AuthContext["database"]["client"], sql: string, params: any[] = []): Row | null {
  return (client.query(sql).get(...params) as Row | null) ?? null;
}

function error(set: any, status: number, message: string | Record<string, unknown>): { detail: string | Record<string, unknown> } {
  set.status = status;
  return { detail: message };
}

export function actor(context: AuthContext, ctx: Context, requirement: { role?: "admin" | "staff"; capability?: string }): CurrentUser | null {
  const requestInfo = requestContext(ctx.request, ctx.server);
  const result = authorize(context, readCookie(ctx.request, SESSION_COOKIE_NAME), requirement, {
    path: ctx.path, userAgent: requestInfo.userAgent, ipAddress: requestInfo.ipAddress,
  });
  if ("user" in result) return result.user;
  error(ctx.set, result.status, result.message);
  return null;
}

function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function mask(value: string | null): string | null {
  return value ? (value.length <= 4 ? "*".repeat(value.length) : `${"*".repeat(value.length - 4)}${value.slice(-4)}`) : null;
}

function audit(client: AuthContext["database"]["client"], entity: string, id: string | number, action: string, username: string, before: Row | null, after: Row | null): void {
  client.run("INSERT INTO academic_master_audit (entity_type, entity_id, action, actor, before_data, after_data) VALUES (?, ?, ?, ?, ?, ?)", [entity, String(id), action, username, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]);
}

function commitError(set: any, operation: () => void): boolean {
  try { operation(); return true; } catch { set.status = 409; return false; }
}

function academicYear(rowValue: Row): Row {
  return { ...rowValue, is_default: asBool(rowValue.is_default) };
}

function masterSummary(value: Row): Row {
  return {
    id: value.id, full_name: value.full_name, preferred_name: value.preferred_name,
    nipd_masked: mask(value.nipd), nisn_masked: mask(value.nisn), nik_masked: mask(value.nik),
    gender: value.gender, birth_date: value.birth_date, religion: value.religion,
    student_status: value.student_status, created_at: value.created_at, updated_at: value.updated_at,
  };
}

function registerAcademicMasters(app: any, context: AuthContext): void {
  const yearBody = t.Object({
    name: t.String({ minLength: 1, maxLength: 32 }), start_date: t.String(), end_date: t.String(),
    is_active: t.Optional(t.Boolean()), is_default: t.Optional(t.Boolean()),
  });
  const jenjangBody = t.Object({ code: t.String({ minLength: 1, maxLength: 32 }), name: t.String({ minLength: 1, maxLength: 255 }), level: t.String({ minLength: 1, maxLength: 64 }), active: t.Optional(t.Boolean()) });
  const programBody = t.Object({ jenjang_id: t.Number({ minimum: 1 }), name: t.String({ minLength: 1, maxLength: 255 }), active: t.Optional(t.Boolean()) });
  const gradeBody = t.Object({ jenjang_id: t.Number({ minimum: 1 }), program_id: t.Number({ minimum: 1 }), name: t.String({ minLength: 1, maxLength: 255 }), sequence_number: t.Number({ minimum: 1 }), active: t.Optional(t.Boolean()) });
  const classBody = t.Object({ academic_year_id: t.Number({ minimum: 1 }), grade_id: t.Number({ minimum: 1 }), class_name: t.String({ minLength: 1, maxLength: 255 }), section_code: t.Optional(t.String({ maxLength: 32 })), active: t.Optional(t.Boolean()) });

  app.get("/api/academic-masters/academic-years", ({ set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" };
    return rows(context.database.client, "SELECT * FROM academic_years ORDER BY start_date DESC, id").map(academicYear);
  });
  app.post("/api/academic-masters/academic-years", ({ body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" };
    if (body.end_date < body.start_date) return error(set, 422, "end_date must be on or after start_date");
    const client = context.database.client;
    try {
      let created: Row | null = null;
      inTransaction(client, () => {
        if (body.is_default) client.run("UPDATE academic_years SET is_default = 0 WHERE is_default = 1");
        const result = client.run("INSERT INTO academic_years (label, start_date, end_date, status, is_default) VALUES (?, ?, ?, ?, ?)", [body.name.trim(), body.start_date, body.end_date, body.is_active ? "active" : "upcoming", body.is_default ? 1 : 0]);
        created = row(client, "SELECT * FROM academic_years WHERE id = ?", [Number(result.lastInsertRowid)]);
        if (created) audit(client, "academic_year", created.id, "CREATE", user.username, null, created);
      });
      set.status = 201; return created ? academicYear(created) : error(set, 500, "Academic year could not be created");
    } catch { return error(set, 409, "Duplicate or referenced academic master"); }
  }, { body: yearBody });
  app.put("/api/academic-masters/academic-years/:row_id", ({ params, body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" };
    if (body.end_date < body.start_date) return error(set, 422, "end_date must be on or after start_date");
    const client = context.database.client; const before = row(client, "SELECT * FROM academic_years WHERE id = ?", [params.row_id]); if (!before) return error(set, 404, "Academic year not found");
    try { inTransaction(client, () => { if (body.is_default) client.run("UPDATE academic_years SET is_default = 0 WHERE id != ?", [params.row_id]); client.run("UPDATE academic_years SET label = ?, start_date = ?, end_date = ?, status = ?, is_default = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [body.name.trim(), body.start_date, body.end_date, body.is_active ? "active" : "upcoming", body.is_default ? 1 : 0, params.row_id]); const after = row(client, "SELECT * FROM academic_years WHERE id = ?", [params.row_id]); if (after) audit(client, "academic_year", params.row_id, "UPDATE", user.username, before, after); }); return academicYear(row(client, "SELECT * FROM academic_years WHERE id = ?", [params.row_id]) as Row); } catch { return error(set, 409, "Duplicate or referenced academic master"); }
  }, { params: t.Object({ row_id: t.Number({ minimum: 1 }) }), body: yearBody });
  app.delete("/api/academic-masters/academic-years/:row_id", ({ params, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" };
    const client = context.database.client; const before = row(client, "SELECT * FROM academic_years WHERE id = ?", [params.row_id]); if (!before) return error(set, 404, "Academic year not found");
    if (row(client, "SELECT id FROM academic_classes WHERE academic_year_id = ? UNION SELECT id FROM student_enrollments WHERE academic_year_id = ? LIMIT 1", [params.row_id, params.row_id])) return error(set, 409, "Academic year is referenced; deactivate it instead");
    try { inTransaction(client, () => { client.run("DELETE FROM academic_years WHERE id = ?", [params.row_id]); audit(client, "academic_year", params.row_id, "DELETE", user.username, before, null); }); set.status = 204; return undefined; } catch { return error(set, 409, "Academic year is referenced; deactivate it instead"); }
  }, { params: t.Object({ row_id: t.Number({ minimum: 1 }) }) });

  const simple = [
    { name: "jenjangs", table: "jenjangs", fields: ["code", "name", "level", "active"], body: jenjangBody, parent: null },
    { name: "programs", table: "academic_programs", fields: ["jenjang_id", "name", "active"], body: programBody, parent: "jenjang_id" },
    { name: "grades", table: "academic_grades", fields: ["jenjang_id", "program_id", "name", "sequence_number", "active"], body: gradeBody, parent: "program_id" },
    { name: "classes", table: "academic_classes", fields: ["academic_year_id", "grade_id", "class_name", "section_code", "active"], body: classBody, parent: "grade_id" },
  ] as const;
  for (const definition of simple) {
    app.get(`/api/academic-masters/${definition.name}`, ({ set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" }; return rows(context.database.client, `SELECT * FROM ${definition.table} ORDER BY id`).map((value) => ({ ...value, active: asBool(value.active) })); });
    app.post(`/api/academic-masters/${definition.name}`, ({ body, set, ...ctx }: Context) => {
      const user = actor(context, { set, ...ctx }, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" }; const client = context.database.client;
      try { let created: Row | null = null; inTransaction(client, () => { const values = definition.fields.map((field) => field === "section_code" ? (body[field] ?? "") : field === "active" ? (body[field] === false ? 0 : 1) : body[field]); const result = client.run(`INSERT INTO ${definition.table} (${definition.fields.join(", ")}) VALUES (${definition.fields.map(() => "?").join(", ")})`, values); created = row(client, `SELECT * FROM ${definition.table} WHERE id = ?`, [Number(result.lastInsertRowid)]); if (created) audit(client, definition.name.slice(0, -1), created.id, "CREATE", user.username, null, created); }); const result = created as unknown as Row; set.status = 201; return { ...result, active: asBool(result.active) }; } catch { return error(set, 409, "Duplicate or referenced academic master"); }
    }, { body: definition.body });
    app.put(`/api/academic-masters/${definition.name}/:row_id`, ({ params, body, set, ...ctx }: Context) => {
      const user = actor(context, { set, ...ctx }, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" }; const client = context.database.client; const before = row(client, `SELECT * FROM ${definition.table} WHERE id = ?`, [params.row_id]); if (!before) return error(set, 404, `${definition.name.slice(0, -1)} not found`);
      try { inTransaction(client, () => { const assignments = definition.fields.map((field) => `${field} = ?`).join(", "); const values = definition.fields.map((field) => field === "section_code" ? (body[field] ?? "") : field === "active" ? (body[field] === false ? 0 : 1) : body[field]); client.run(`UPDATE ${definition.table} SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...values, params.row_id]); const after = row(client, `SELECT * FROM ${definition.table} WHERE id = ?`, [params.row_id]); if (after) audit(client, definition.name.slice(0, -1), params.row_id, "UPDATE", user.username, before, after); }); const result = row(client, `SELECT * FROM ${definition.table} WHERE id = ?`, [params.row_id]) as Row; return { ...result, active: asBool(result.active) }; } catch { return error(set, 409, "Duplicate or referenced academic master"); }
    }, { params: t.Object({ row_id: t.Number({ minimum: 1 }) }), body: definition.body });
    app.delete(`/api/academic-masters/${definition.name}/:row_id`, ({ params, set, ...ctx }: Context) => {
      const user = actor(context, { set, ...ctx }, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" }; const client = context.database.client; const before = row(client, `SELECT * FROM ${definition.table} WHERE id = ?`, [params.row_id]); if (!before) return error(set, 404, `${definition.name.slice(0, -1)} not found`);
      try { inTransaction(client, () => { client.run(`DELETE FROM ${definition.table} WHERE id = ?`, [params.row_id]); audit(client, definition.name.slice(0, -1), params.row_id, "DELETE", user.username, before, null); }); set.status = 204; return undefined; } catch { return error(set, 409, `${definition.name.slice(0, -1)} is referenced; deactivate it instead`); }
    }, { params: t.Object({ row_id: t.Number({ minimum: 1 }) }) });
  }
}

function registerStudents(app: any, context: AuthContext, prefix: string): void {
  const list = ({ query, set }: Context) => {
    const page = Math.max(1, Number(query.page ?? 1)); const pageSize = Math.min(200, Math.max(1, Number(query.page_size ?? 50))); const where: string[] = []; const params: any[] = [];
    if (query.search?.trim()) { where.push("lower(name) LIKE ?"); params.push(`%${query.search.trim().toLowerCase()}%`); }
    if (query.jenjang?.trim()) { where.push("jenjang = ?"); params.push(query.jenjang.trim()); }
    if (query.class_name?.trim()) { where.push(query.class_name.trim() === "unassigned" ? "class_name IS NULL" : "class_name = ?"); if (query.class_name.trim() !== "unassigned") params.push(query.class_name.trim()); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : ""; const client = context.database.client; const total = Number((row(client, `SELECT COUNT(*) AS count FROM students ${clause}`, params) as Row).count); const result = rows(client, `SELECT id, name, jenjang, class_name FROM students ${clause} ORDER BY name LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
    if (Number(query.page ?? 1) < 1 || Number(query.page_size ?? 50) < 1 || Number(query.page_size ?? 50) > 200) return error(set, 400, "Invalid pagination");
    return { students: result, total, page, page_size: pageSize, total_pages: total ? Math.ceil(total / pageSize) : 0 };
  };
  const querySchema = { query: t.Object({ search: t.Optional(t.String()), jenjang: t.Optional(t.String()), class_name: t.Optional(t.String()), page: t.Optional(t.String()), page_size: t.Optional(t.String()) }) };
  app.get(`${prefix}`, list, querySchema);
  app.get(`${prefix}/classes`, () => rows(context.database.client, "SELECT DISTINCT class_name FROM students WHERE class_name IS NOT NULL AND trim(class_name) <> '' ORDER BY class_name").map((value) => value.class_name));
  app.get(`${prefix}/all`, () => rows(context.database.client, "SELECT * FROM students ORDER BY id"));
  app.post(`${prefix}/set-class`, ({ body, set }: Context) => { const student = row(context.database.client, "SELECT * FROM students WHERE id = ?", [body.student_id]); if (!student) return error(set, 404, "Student not found"); context.database.client.run("UPDATE students SET class_name = ?, jenjang = ? WHERE id = ?", [body.class_name.trim(), body.jenjang.trim(), body.student_id]); return { message: `Student ${student.name} moved to ${body.jenjang.trim()} - ${body.class_name.trim()}` }; }, { body: t.Object({ student_id: t.Number({ minimum: 1 }), class_name: t.String(), jenjang: t.String() }) });
  app.patch(`${prefix}/assign-class`, ({ body, set }: Context) => { if (!body.student_ids.length) return error(set, 400, "student_ids must be a non-empty list"); if (!body.class_name.trim() || !body.jenjang.trim()) return error(set, 400, "class_name and jenjang must be non-empty strings"); const placeholders = body.student_ids.map(() => "?").join(","); const result = context.database.client.run(`UPDATE students SET class_name = ?, jenjang = ? WHERE id IN (${placeholders})`, [body.class_name.trim(), body.jenjang.trim(), ...body.student_ids]); return { updated: result.changes, class_name: body.class_name.trim(), jenjang: body.jenjang.trim() }; }, { body: t.Object({ student_ids: t.Array(t.Number({ minimum: 1 })), class_name: t.String(), jenjang: t.String() }) });
}

function registerStudentMasters(app: any, context: AuthContext): void {
  const identityBody = t.Object({ full_name: t.String({ minLength: 1, maxLength: 255 }), preferred_name: t.Optional(t.String()), nipd: t.Optional(t.String()), nisn: t.Optional(t.String()), nik: t.Optional(t.String()), birth_place: t.Optional(t.String()), birth_date: t.Optional(t.String()), gender: t.Optional(t.String()), religion: t.Optional(t.String()), citizenship: t.Optional(t.String()), blood_type: t.Optional(t.String()), student_status: t.Optional(t.String()), admission_date: t.Optional(t.String()), admission_type: t.Optional(t.String()), previous_school: t.Optional(t.String()) });
  app.post("/api/student-masters", ({ body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "create_student" }); if (!user) return { detail: "Insufficient permissions" };
    const fullName = body.identity.full_name.replace(/\s+/g, " ").trim(); if (!fullName) return error(set, 422, "Full name is required");
    const duplicate = row(context.database.client, "SELECT id FROM student_masters WHERE normalized_name = ? LIMIT 1", [fullName.toLowerCase()]); if (duplicate && !body.duplicate_override_reason) return error(set, 409, "Potential duplicate student found.");
    const id = randomUUID(); const value = body.identity; const client = context.database.client;
    try { inTransaction(client, () => { client.run("INSERT INTO student_masters (id, full_name, normalized_name, preferred_name, nipd, nisn, nik, birth_place, birth_date, gender, religion, citizenship, blood_type, student_status, admission_date, admission_type, previous_school, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, fullName, fullName.toLowerCase(), value.preferred_name?.trim() || null, value.nipd?.trim() || null, value.nisn?.trim() || null, value.nik?.trim() || null, value.birth_place?.trim() || null, value.birth_date ?? null, value.gender?.trim() || null, value.religion?.trim() || null, value.citizenship?.trim() || null, value.blood_type?.trim() || null, value.student_status ?? "active", value.admission_date ?? null, value.admission_type?.trim() || null, value.previous_school?.trim() || null, user.username, user.username]); client.run("INSERT INTO student_master_change_history (student_master_id, action, field_name, new_value, source, changed_by) VALUES (?, 'student_created', NULL, ?, 'manual_create', ?)", [id, fullName, user.username]); }); set.status = 201; return masterSummary(row(client, "SELECT * FROM student_masters WHERE id = ?", [id]) as Row); } catch { return error(set, 409, "Student could not be created."); }
  }, { body: t.Object({ identity: identityBody, duplicate_override_reason: t.Optional(t.String()) }) });
  app.get("/api/student-masters", ({ query, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "view_student" }); if (!user) return { detail: "Insufficient permissions" }; const page = Math.max(1, Number(query.page ?? 1)); const pageSize = Math.min(200, Math.max(1, Number(query.page_size ?? 50))); const params: any[] = []; const where = query.search?.trim() ? "WHERE lower(full_name) LIKE ?" : ""; if (where) params.push(`%${query.search.trim().toLowerCase()}%`); const client = context.database.client; const total = Number((row(client, `SELECT COUNT(*) AS count FROM student_masters ${where}`, params) as Row).count); const items = rows(client, `SELECT * FROM student_masters ${where} ORDER BY full_name, id LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]).map(masterSummary); return { items, total, page, page_size: pageSize };
  }, { query: t.Object({ search: t.Optional(t.String()), page: t.Optional(t.String()), page_size: t.Optional(t.String()) }) });
  app.get("/api/student-masters/data-quality-summary", ({ set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "view_student" }); if (!user) return { detail: "Insufficient permissions" }; const client = context.database.client; const total = Number((row(client, "SELECT COUNT(*) AS count FROM student_masters") as Row).count); const count = (field: string) => Number((row(client, `SELECT COUNT(*) AS count FROM student_masters WHERE ${field} IS NULL OR ${field} = ''`) as Row).count); const activeDevices = Number((row(client, "SELECT COUNT(DISTINCT student_master_id) AS count FROM student_device_identities WHERE is_active = 1") as Row).count); const enrolled = Number((row(client, "SELECT COUNT(DISTINCT student_master_id) AS count FROM student_enrollments WHERE student_master_id IS NOT NULL AND effective_to IS NULL") as Row).count); return { total, missing_nisn: count("nisn"), missing_nik: count("nik"), missing_birth_date: count("birth_date"), missing_gender: count("gender"), missing_religion: count("religion"), no_active_device: total - activeDevices, no_current_enrollment: total - enrolled }; });
  app.get("/api/student-masters/:student_master_id", ({ params, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "view_student" }); if (!user) return { detail: "Insufficient permissions" }; const value = row(context.database.client, "SELECT * FROM student_masters WHERE id = ?", [params.student_master_id]); return value ? masterSummary(value) : error(set, 404, "Student master not found"); }, { params: t.Object({ student_master_id: t.String() }) });
  app.get("/api/student-masters/:student_master_id/profile", ({ params, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "view_student" }); if (!user) return { detail: "Insufficient permissions" }; const value = row(context.database.client, "SELECT * FROM student_masters WHERE id = ?", [params.student_master_id]); if (!value) return error(set, 404, "Student master not found"); const client = context.database.client; return { ...masterSummary(value), address: row(client, "SELECT * FROM student_addresses WHERE student_master_id = ?", [params.student_master_id]), contact: row(client, "SELECT * FROM student_contacts WHERE student_master_id = ?", [params.student_master_id]), health: row(client, "SELECT * FROM student_health_profiles WHERE student_master_id = ?", [params.student_master_id]), document_status: row(client, "SELECT * FROM student_document_statuses WHERE student_master_id = ?", [params.student_master_id]), guardians: rows(client, "SELECT * FROM student_parent_guardians WHERE student_master_id = ? ORDER BY id", [params.student_master_id]), device_identities: rows(client, "SELECT id, device_identifier, device_source, effective_from, effective_to, is_active FROM student_device_identities WHERE student_master_id = ? ORDER BY id DESC", [params.student_master_id]) }; }, { params: t.Object({ student_master_id: t.String() }) });
  app.patch("/api/student-masters/:student_master_id/profile", ({ params, body, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "edit_student" }); if (!user) return { detail: "Insufficient permissions" }; const client = context.database.client; const before = row(client, "SELECT * FROM student_masters WHERE id = ?", [params.student_master_id]); if (!before) return error(set, 404, "Student master not found"); const allowed = ["full_name", "preferred_name", "nipd", "nisn", "nik", "birth_place", "birth_date", "gender", "religion", "citizenship", "blood_type", "student_status", "admission_date", "admission_type", "previous_school"]; const value = body.identity; if ((value.nipd !== undefined || value.nisn !== undefined || value.nik !== undefined) && user.role !== "admin") return error(set, 403, "Insufficient permissions"); try { inTransaction(client, () => { const updates = allowed.filter((field) => value[field] !== undefined); if (updates.length) { const assignments = updates.map((field) => `${field} = ?`).join(", "); const values = updates.map((field) => field === "full_name" ? String(value[field]).replace(/\s+/g, " ").trim() : value[field]); client.run(`UPDATE student_masters SET ${assignments}, normalized_name = lower(full_name), updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...values, user.username, params.student_master_id]); for (const field of updates) client.run("INSERT INTO student_master_change_history (student_master_id, action, field_name, old_value, new_value, source, changed_by) VALUES (?, 'profile_updated', ?, ?, ?, 'manual_edit', ?)", [params.student_master_id, field, before[field], value[field], user.username]); } }); return row(client, "SELECT * FROM student_masters WHERE id = ?", [params.student_master_id]); } catch { return error(set, 409, "Student profile could not be updated."); } }, { params: t.Object({ student_master_id: t.String() }), body: t.Object({ record_version: t.Optional(t.String()), identity: identityBody, reason: t.Optional(t.String()) }) });
}

function registerStaff(app: any, context: AuthContext): void {
  app.get("/api/staff", ({ query, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "view_staff" }); if (!user) return { detail: "Insufficient permissions" }; const status = query.employment_status ?? query.status ?? "ACTIVE"; const page = Math.max(1, Number(query.page ?? 1)); const pageSize = Math.min(200, Math.max(1, Number(query.page_size ?? 50))); const where: string[] = []; const params: any[] = []; if (status !== "ALL") { where.push("employment_status = ?"); params.push(status); } if (query.search?.trim()) { where.push("(lower(full_name) LIKE ? OR lower(coalesce(source_staff_id, '')) LIKE ?)"); params.push(`%${query.search.trim().toLowerCase()}%`, `%${query.search.trim().toLowerCase()}%`); } const clause = where.length ? `WHERE ${where.join(" AND ")}` : ""; const client = context.database.client; const total = Number((row(client, `SELECT COUNT(*) AS count FROM staff_members ${clause}`, params) as Row).count); const values = rows(client, `SELECT id, source_staff_id, full_name, employment_status, job_title_normalized, job_title_raw, employment_start_date, employment_end_date, dapodik_status_normalized FROM staff_members ${clause} ORDER BY full_name, id LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]); const counts = rows(client, "SELECT employment_status, COUNT(*) AS count FROM staff_members GROUP BY employment_status"); const countMap = Object.fromEntries(counts.map((item) => [item.employment_status, Number(item.count)])); return { items: values.map((item) => ({ id: item.id, source_staff_id: item.source_staff_id, full_name: item.full_name, employment_status: item.employment_status, job_title: item.job_title_normalized ?? item.job_title_raw, employment_start_date: item.employment_start_date, employment_end_date: item.employment_end_date, dapodik_status: item.dapodik_status_normalized, nip: null, nuptk: null, jenjangs: [], age_years: null, service_years: null, service_months: null, highest_education_level: null, highest_education_institution: null })), total, page, page_size: pageSize, total_pages: Math.ceil(total / pageSize), counts: { ACTIVE: countMap.ACTIVE ?? 0, FORMER: countMap.FORMER ?? 0, ALL: counts.reduce((sum, item) => sum + Number(item.count), 0) } };
  }, { query: t.Object({ search: t.Optional(t.String()), status: t.Optional(t.String()), employment_status: t.Optional(t.String()), page: t.Optional(t.String()), page_size: t.Optional(t.String()) }) });
  app.get("/api/staff/:staff_id", ({ params, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "view_staff" }); if (!user) return { detail: "Insufficient permissions" };
    const client = context.database.client; const value = row(client, "SELECT * FROM staff_members WHERE id = ?", [params.staff_id]); if (!value) return error(set, 404, "Staff member not found");
    const education = rows(client, "SELECT id, education_level, institution_name, major, graduation_year, notes, created_at, updated_at FROM staff_education WHERE staff_member_id = ? ORDER BY graduation_year DESC, id DESC", [params.staff_id]);
    const levelOrder = ["S3", "S2", "S1", "D4", "D3", "D2", "D1", "SMA", "SMK", "SMP", "SD"]; const highest = education.slice().sort((a, b) => levelOrder.indexOf(a.education_level) - levelOrder.indexOf(b.education_level))[0] ?? null;
    return { id: value.id, source_staff_id: value.source_staff_id, full_name: value.full_name, employment_status: value.employment_status, job_title: value.job_title_normalized ?? value.job_title_raw, employment_start_date: value.employment_start_date, employment_end_date: value.employment_end_date, dapodik_status: value.dapodik_status_normalized, birth_place: value.birth_place, birth_date: value.birth_date, identifiers: rows(client, "SELECT identifier_type, normalized_value, verification_status FROM staff_identifiers WHERE staff_member_id = ?", [params.staff_id]), jenjangs: rows(client, "SELECT j.id, j.name, j.code, j.level, j.active FROM staff_jenjang_assignments a JOIN jenjangs j ON j.id = a.jenjang_id WHERE a.staff_member_id = ? ORDER BY j.code, j.id", [params.staff_id]), education_history: education, highest_education_level: highest?.education_level ?? null, highest_education_institution: highest?.institution_name ?? null };
  }, { params: t.Object({ staff_id: t.String({ minLength: 1 }) }) });
  app.get("/api/staff/:staff_id/education", ({ params, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "view_staff" }); if (!user) return { detail: "Insufficient permissions" };
    const client = context.database.client; if (!row(client, "SELECT id FROM staff_members WHERE id = ?", [params.staff_id])) return error(set, 404, "Staff member not found");
    return rows(client, "SELECT id, education_level, institution_name, major, graduation_year, notes, created_at, updated_at FROM staff_education WHERE staff_member_id = ? ORDER BY graduation_year DESC, id DESC", [params.staff_id]);
  }, { params: t.Object({ staff_id: t.String({ minLength: 1 }) }) });
}

function registerEnrollments(app: any, context: AuthContext): void {
  app.get("/api/student-enrollments/student/:student_master_id", ({ params, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "view_student" }); if (!user) return { detail: "Insufficient permissions" }; if (!row(context.database.client, "SELECT id FROM student_masters WHERE id = ?", [params.student_master_id])) return error(set, 404, "Student master not found"); return rows(context.database.client, "SELECT id, academic_year_id, jenjang_id, academic_class_id, class_name, effective_from, effective_to, lifecycle_state, lifecycle_effective_date, student_id FROM student_enrollments WHERE student_master_id = ? ORDER BY academic_year_id DESC, id DESC", [params.student_master_id]).map((item) => ({ ...item, active: item.lifecycle_state === "ACTIVE", device_linked: item.student_id !== null })); }, { params: t.Object({ student_master_id: t.String() }) });
  app.post("/api/student-enrollments/student/:student_master_id", ({ params, body, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "manage_enrollment" }); if (!user) return { detail: "Insufficient permissions" }; const client = context.database.client; if (!row(client, "SELECT id FROM student_masters WHERE id = ?", [params.student_master_id])) return error(set, 404, "Student master not found"); try { let created: Row | null = null; inTransaction(client, () => { const hierarchy = row(client, "SELECT c.id, c.class_name, g.jenjang_id FROM academic_classes c JOIN academic_grades g ON g.id = c.grade_id WHERE c.id = ? AND c.academic_year_id = ?", [body.academic_class_id, body.academic_year_id]); if (!hierarchy) throw new Error("class"); const result = client.run("INSERT INTO student_enrollments (student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state, lifecycle_effective_date, lifecycle_reason_code) VALUES (?, ?, ?, ?, ?, 1, ?, 'ACTIVE', ?, 'ENROLLMENT_CREATED')", [params.student_master_id, body.academic_year_id, hierarchy.jenjang_id, hierarchy.id, hierarchy.class_name, body.effective_from, body.effective_from]); created = row(client, "SELECT * FROM student_enrollments WHERE id = ?", [Number(result.lastInsertRowid)]); }); const result = created as unknown as Row; set.status = 201; return { ...result, active: true, device_linked: result.student_id !== null }; } catch { return error(set, 409, "Student already has an enrollment for this academic year or the class is invalid"); } }, { params: t.Object({ student_master_id: t.String() }), body: t.Object({ academic_year_id: t.Number({ minimum: 1 }), academic_class_id: t.Number({ minimum: 1 }), effective_from: t.String() }) });
  app.post("/api/student-enrollments/:enrollment_id/end", ({ params, body, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "end_enrollment" }); if (!user) return { detail: "Insufficient permissions" }; if (body.confirmation !== "END_STUDENT_ENROLLMENT") return error(set, 400, "Invalid confirmation token"); const client = context.database.client; const existing = row(client, "SELECT * FROM student_enrollments WHERE id = ?", [params.enrollment_id]); if (!existing) return error(set, 404, "Enrollment not found"); if (existing.effective_from && body.effective_date < existing.effective_from) return error(set, 400, "End date predates enrollment"); try { inTransaction(client, () => { client.run("UPDATE student_enrollments SET effective_to = ?, lifecycle_state = 'ENDED', lifecycle_effective_date = ?, lifecycle_reason_code = 'ORDINARY_END', lifecycle_reason = ?, class_assigned = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [body.effective_date, body.effective_date, body.reason, params.enrollment_id]); client.run("INSERT INTO student_enrollment_lifecycle_audit (enrollment_id, prior_state, new_state, effective_date, actor, reason_code, source_workflow) VALUES (?, ?, 'ENDED', ?, ?, 'ORDINARY_END', 'manual_end')", [params.enrollment_id, existing.lifecycle_state, body.effective_date, user.username]); client.run("UPDATE student_enrollment_class_history SET effective_to = ? WHERE enrollment_id = ? AND effective_to IS NULL", [body.effective_date, params.enrollment_id]); }); const updated = row(client, "SELECT * FROM student_enrollments WHERE id = ?", [params.enrollment_id]) as Row; return { id: updated.id, effective_to: updated.effective_to, active: false, lifecycle_state: updated.lifecycle_state }; } catch { return error(set, 409, "Enrollment lifecycle transition failed"); } }, { params: t.Object({ enrollment_id: t.Number({ minimum: 1 }) }), body: t.Object({ effective_date: t.String(), reason: t.String({ minLength: 3 }), confirmation: t.String() }) });
}

export function coreRoutes(app: any, context: AuthContext): any {
  registerAcademicMasters(app, context);
  registerStudents(app, context, "/api/students");
  registerStudents(app, context, "/students");
  registerStudentMasters(app, context);
  registerStaff(app, context);
  registerEnrollments(app, context);
  return app;
}
