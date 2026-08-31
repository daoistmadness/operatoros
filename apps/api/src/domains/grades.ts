import { t } from "elysia";
import { AcademicAssessmentSessionSchema, CreateAcademicAssessmentSessionSchema, GradeGridSaveRequestSchema } from "@operatoros/contracts/grades";
import { inTransaction } from "@operatoros/db";
import type { AuthContext } from "../auth/service";
import { actor } from "./core";
import { validateAssessmentDate } from "./academic-timeline";

type Row = Record<string, any>;
type Context = any;

function rows(context: AuthContext, sql: string, params: any[] = []): Row[] {
  return context.database.client.query(sql).all(...params) as Row[];
}

function row(context: AuthContext, sql: string, params: any[] = []): Row | null {
  return (context.database.client.query(sql).get(...params) as Row | null) ?? null;
}

function fail(set: any, status: number, detail: string | Record<string, unknown>) {
  set.status = status;
  return { detail };
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

const enrollmentBody = t.Object({
  academic_year_id: t.Number({ minimum: 1 }),
  academic_class_id: t.Number({ minimum: 1 }),
  student_master_ids: t.Array(t.String({ minLength: 1 }), { minItems: 1 }),
});

const yearBody = t.Object({
  label: t.String({ minLength: 1, maxLength: 32 }),
  start_date: t.String(),
  end_date: t.String(),
  status: t.Optional(t.Union([t.Literal("upcoming"), t.Literal("active"), t.Literal("closed")])),
  is_default: t.Optional(t.Boolean()),
});

const subjectBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
  jenjang_id: t.Number({ minimum: 1 }),
  supports_sumatif: t.Optional(t.Boolean()),
  supports_formatif: t.Optional(t.Boolean()),
});

function requireContext(context: AuthContext, ctx: Context, academicYearId: number, jenjangId: number): Row | { error: true } {
  const year = row(context, "SELECT id FROM academic_years WHERE id = ?", [academicYearId]);
  if (!year) { fail(ctx.set, 404, "Academic year not found"); return { error: true }; }
  const jenjang = row(context, "SELECT id FROM jenjangs WHERE id = ?", [jenjangId]);
  if (!jenjang) { fail(ctx.set, 404, "Jenjang not found"); return { error: true }; }
  return year;
}

function serializeEnrollment(context: AuthContext, value: Row): Row {
  const history = rows(context, "SELECT id, class_name, effective_from, effective_to, source FROM student_enrollment_class_history WHERE enrollment_id = ? ORDER BY effective_from, id", [value.id]);
  const deletionChecks: [string, string, any[]][] = [
    ["CLASS_HISTORY", "SELECT id FROM student_enrollment_class_history WHERE enrollment_id = ? LIMIT 1", [value.id]],
    ["GRADES", "SELECT id FROM student_subject_grades WHERE enrollment_id = ? LIMIT 1", [value.id]],
    ["INTERVENTIONS", "SELECT id FROM academic_interventions WHERE enrollment_id = ? LIMIT 1", [value.id]],
    ["LIFECYCLE_AUDIT", "SELECT id FROM student_enrollment_lifecycle_audit WHERE enrollment_id = ? LIMIT 1", [value.id]],
    ["IMPORT_HISTORY", "SELECT id FROM student_import_applied_actions WHERE entity_type = 'STUDENT_ENROLLMENT' AND entity_id = ? LIMIT 1", [String(value.id)]],
    ["ATTENDANCE", "SELECT id FROM attendance WHERE student_id = ? LIMIT 1", [value.student_id]],
  ];
  const deletionDependencies = deletionChecks.filter(([, sql, params]) => row(context, sql, params)).map(([name]) => name);
  return {
    enrollment_id: value.id,
    student_id: value.student_id ?? null,
    student_name: value.student_name ?? "Unlinked student",
    jenjang: value.jenjang ?? null,
    student_class_name: value.student_class_name ?? null,
    academic_year_id: value.academic_year_id,
    jenjang_id: value.jenjang_id,
    class_name: value.class_name,
    class_assigned: bool(value.class_assigned),
    student_master_id: value.student_master_id ?? null,
    lifecycle_state: value.lifecycle_state,
    device_linked: value.student_id !== null && value.student_id !== undefined,
    effective_from: value.effective_from ?? null,
    effective_to: value.effective_to ?? null,
    deletion: {
      can_hard_delete: value.lifecycle_state === "DRAFT" && !bool(value.class_assigned) && !deletionDependencies.length,
      code: value.lifecycle_state === "DRAFT" && !bool(value.class_assigned) && !deletionDependencies.length ? "HARD_DELETE_ALLOWED" : "ENROLLMENT_HAS_HISTORY",
      message: value.lifecycle_state === "DRAFT" && !bool(value.class_assigned) && !deletionDependencies.length ? "Unused draft enrollment may be deleted." : "Enrollment history must be preserved; use an explicit lifecycle action.",
      dependencies: deletionDependencies,
    },
    class_history: history,
  };
}

export function gradeRoutes(app: any, context: AuthContext): any {
  app.get("/api/grades/assessment-sessions", (ctx: Context) => {
    if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" };
    const yearId = Number(ctx.query.academic_year_id);
    if (!row(context, "SELECT id FROM academic_years WHERE id = ?", [yearId])) return fail(ctx.set, 404, "Academic year not found");
    return rows(context, `SELECT id, academic_year_id, term_number, label, assessment_date
      FROM academic_assessment_sessions WHERE academic_year_id = ? ORDER BY term_number, assessment_date IS NULL, assessment_date, id`, [yearId]);
  }, { query: t.Object({ academic_year_id: t.String() }), response: t.Array(AcademicAssessmentSessionSchema) });

  app.post("/api/grades/assessment-sessions", (ctx: Context) => {
    const user = actor(context, ctx, { role: "admin" });
    if (!user) return { detail: "Insufficient permissions" };
    const year = row(context, "SELECT id, start_date, end_date, status FROM academic_years WHERE id = ?", [ctx.body.academic_year_id]);
    if (!year) return fail(ctx.set, 404, "Academic year not found");
    if (year.status === "closed") return fail(ctx.set, 409, "Closed academic years cannot receive new assessment sessions");
    const label = ctx.body.label.trim();
    if (!label) return fail(ctx.set, 400, "Assessment session label is required");
    const assessmentDate = ctx.body.assessment_date ?? null;
    const dateError = validateAssessmentDate(context, Number(ctx.body.academic_year_id), Number(ctx.body.term_number), assessmentDate);
    if (dateError) return fail(ctx.set, 400, dateError);
    try {
      const result = context.database.client.run(
        "INSERT INTO academic_assessment_sessions (academic_year_id, term_number, label, assessment_date) VALUES (?, ?, ?, ?)",
        [ctx.body.academic_year_id, ctx.body.term_number, label, assessmentDate],
      );
      return row(context, "SELECT id, academic_year_id, term_number, label, assessment_date FROM academic_assessment_sessions WHERE id = ?", [Number(result.lastInsertRowid)]);
    } catch {
      return fail(ctx.set, 409, "Assessment session could not be created");
    }
  }, { body: CreateAcademicAssessmentSessionSchema, response: AcademicAssessmentSessionSchema });

  app.get("/api/grades/ledger", (ctx: Context) => {
    if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" };
    const yearId = Number(ctx.query.academic_year_id);
    const jenjangClause = ctx.query.jenjang_id === undefined ? "" : " AND e.jenjang_id = ?";
    const params = ctx.query.jenjang_id === undefined ? [yearId] : [yearId, Number(ctx.query.jenjang_id)];
    const sessionId = ctx.query.assessment_session_id === undefined ? null : Number(ctx.query.assessment_session_id);
    if (sessionId !== null && !row(context, "SELECT id FROM academic_assessment_sessions WHERE id = ? AND academic_year_id = ?", [sessionId, yearId])) return fail(ctx.set, 404, "Assessment session not found in the academic year");
    const values = rows(context, `SELECT e.id AS enrollment_id, e.student_id, s.name AS student_name, e.academic_year_id, e.jenjang_id, j.name AS jenjang, e.class_name, e.class_assigned FROM student_enrollments e JOIN students s ON s.id = e.student_id JOIN jenjangs j ON j.id = e.jenjang_id WHERE e.academic_year_id = ?${jenjangClause} ORDER BY s.name`, params);
    const byEnrollment = new Map<number, Row[]>();
    const gradeFilter = sessionId === null ? "" : " AND assessment_session_id = ?";
    const gradeParams = sessionId === null ? [yearId] : [yearId, sessionId];
    for (const grade of rows(context, `SELECT id, enrollment_id, subject_id, component_id, assessment_session_id, score FROM student_subject_grades WHERE enrollment_id IN (SELECT id FROM student_enrollments WHERE academic_year_id = ?)${gradeFilter} ORDER BY id`, gradeParams)) {
      const list = byEnrollment.get(Number(grade.enrollment_id)) ?? [];
      list.push(grade);
      byEnrollment.set(Number(grade.enrollment_id), list);
    }
    return values.map((value) => ({ ...value, class_assigned: bool(value.class_assigned), grades: byEnrollment.get(Number(value.enrollment_id)) ?? [] }));
  }, { query: t.Object({ academic_year_id: t.String(), jenjang_id: t.Optional(t.String()), assessment_session_id: t.Optional(t.String()) }) });

  app.get("/api/grades/enrollment/candidates", (ctx: Context) => {
    if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" };
    if (requireContext(context, ctx, Number(ctx.query.academic_year_id), Number(ctx.query.jenjang_id)).error) return { detail: "Invalid academic context" };
    const sourceFilter = ctx.query.source_class ? " AND s.class_name = ?" : "";
    const params = ctx.query.source_class ? [Number(ctx.query.academic_year_id), ctx.query.source_class] : [Number(ctx.query.academic_year_id)];
    return rows(context, `SELECT m.id, d.legacy_student_id AS student_id, m.full_name AS name, s.jenjang, s.class_name, d.id AS device_id FROM student_masters m LEFT JOIN student_device_identities d ON d.id = (SELECT MIN(d2.id) FROM student_device_identities d2 WHERE d2.student_master_id = m.id AND d2.is_active = 1) LEFT JOIN students s ON s.id = d.legacy_student_id WHERE NOT EXISTS (SELECT 1 FROM student_enrollments e WHERE e.student_master_id = m.id AND e.academic_year_id = ?)${sourceFilter} ORDER BY m.full_name, m.id`, params).map((value) => ({ id: value.id, student_id: value.student_id ?? null, name: value.name, jenjang: value.jenjang ?? null, class_name: value.class_name ?? null, device_linked: value.device_id !== null }));
  }, { query: t.Object({ academic_year_id: t.String(), jenjang_id: t.String(), source_class: t.Optional(t.String()) }) });

  app.get("/api/grades/enrollment/source-classes", (ctx: Context) => {
    if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" };
    if (requireContext(context, ctx, Number(ctx.query.academic_year_id), Number(ctx.query.jenjang_id)).error) return { detail: "Invalid academic context" };
    return rows(context, "SELECT DISTINCT s.class_name FROM students s JOIN student_device_identities d ON d.legacy_student_id = s.id AND d.is_active = 1 WHERE s.class_name IS NOT NULL AND s.class_name <> '' AND NOT EXISTS (SELECT 1 FROM student_enrollments e WHERE e.student_master_id = d.student_master_id AND e.academic_year_id = ?) ORDER BY s.class_name", [Number(ctx.query.academic_year_id)]).map((value) => value.class_name);
  }, { query: t.Object({ academic_year_id: t.String(), jenjang_id: t.String() }) });

  app.get("/api/grades/enrollment", (ctx: Context) => {
    if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" };
    if (requireContext(context, ctx, Number(ctx.query.academic_year_id), Number(ctx.query.jenjang_id)).error) return { detail: "Invalid academic context" };
    const classClause = ctx.query.class_name ? " AND COALESCE(c.class_name, e.class_name) = ?" : "";
    const params = ctx.query.class_name ? [Number(ctx.query.academic_year_id), Number(ctx.query.jenjang_id), ctx.query.class_name] : [Number(ctx.query.academic_year_id), Number(ctx.query.jenjang_id)];
    return rows(context, `SELECT e.*, s.id AS legacy_student_id, s.name AS legacy_student_name, s.jenjang AS legacy_jenjang, s.class_name AS legacy_class_name, m.full_name AS master_name, COALESCE(c.class_name, e.class_name) AS resolved_class_name FROM student_enrollments e LEFT JOIN students s ON s.id = e.student_id LEFT JOIN student_masters m ON m.id = e.student_master_id LEFT JOIN academic_classes c ON c.id = e.academic_class_id WHERE e.academic_year_id = ? AND e.jenjang_id = ?${classClause} ORDER BY e.class_name, m.full_name, s.name`, params).map((value) => serializeEnrollment(context, { ...value, student_id: value.legacy_student_id, student_name: value.master_name ?? value.legacy_student_name, jenjang: value.legacy_jenjang, student_class_name: value.legacy_class_name, class_name: value.resolved_class_name }));
  }, { query: t.Object({ academic_year_id: t.String(), jenjang_id: t.String(), class_name: t.Optional(t.String()) }) });

  app.post("/api/grades/enrollment/bulk", (ctx: Context) => {
    const user = actor(context, ctx, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" };
    const client = context.database.client;
    const academicClass = row(context, "SELECT c.*, g.jenjang_id FROM academic_classes c JOIN academic_grades g ON g.id = c.grade_id WHERE c.id = ?", [ctx.body.academic_class_id]);
    if (!academicClass) return fail(ctx.set, 404, "Academic class not found");
    if (!bool(academicClass.active)) return fail(ctx.set, 400, "Academic class is not active");
    if (Number(academicClass.academic_year_id) !== Number(ctx.body.academic_year_id)) return fail(ctx.set, 400, "Academic class does not belong to the selected academic year");
    const year = row(context, "SELECT * FROM academic_years WHERE id = ?", [ctx.body.academic_year_id]);
    if (!year) return fail(ctx.set, 404, "Academic year not found");
    if (year.status === "closed") return fail(ctx.set, 409, { code: "ACADEMIC_YEAR_CLOSED", message: "Closed academic years cannot receive new enrollments." });
    const masterIds = [...new Set(ctx.body.student_master_ids as string[])];
    const placeholders = masterIds.map(() => "?").join(",");
    const masters = rows(context, `SELECT id FROM student_masters WHERE id IN (${placeholders})`, masterIds);
    const found = new Set(masters.map((value) => String(value.id)));
    const missing = masterIds.filter((id) => !found.has(id));
    if (missing.length) return fail(ctx.set, 404, `Student master not found for id(s): ${missing.join(", ")}`);
    const existing = new Set(rows(context, `SELECT student_master_id FROM student_enrollments WHERE academic_year_id = ? AND student_master_id IN (${placeholders})`, [ctx.body.academic_year_id, ...masterIds]).map((value) => String(value.student_master_id)));
    const deviceRows = rows(context, `SELECT student_master_id, legacy_student_id FROM student_device_identities WHERE is_active = 1 AND student_master_id IN (${placeholders})`, masterIds);
    const legacyByMaster = new Map(deviceRows.map((value) => [String(value.student_master_id), value.legacy_student_id]));
    const created: number[] = [];
    try {
      inTransaction(client, () => {
        for (const masterId of masterIds) {
          if (existing.has(masterId)) continue;
          const result = client.run("INSERT INTO student_enrollments (student_id, student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state, lifecycle_effective_date, lifecycle_reason_code) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'ACTIVE', ?, 'BULK_ENROLLMENT_CREATED')", [legacyByMaster.get(masterId) ?? null, masterId, ctx.body.academic_year_id, academicClass.jenjang_id, academicClass.id, academicClass.class_name, year.start_date, year.start_date]);
          const id = Number(result.lastInsertRowid); created.push(id);
          client.run("INSERT INTO student_enrollment_class_history (enrollment_id, class_name, effective_from, changed_by, source) VALUES (?, ?, ?, ?, 'grade_enrollment_bulk')", [id, academicClass.class_name, year.start_date, user.username]);
          client.run("INSERT INTO student_enrollment_lifecycle_audit (enrollment_id, prior_state, new_state, effective_date, actor, reason_code, source_workflow) VALUES (?, 'DRAFT', 'ACTIVE', ?, ?, 'BULK_ENROLLMENT_CREATED', 'grade_enrollment_bulk')", [id, year.start_date, user.username]);
        }
      });
      const enrollments = rows(context, `SELECT e.*, s.id AS legacy_student_id, s.name AS legacy_student_name, s.jenjang AS legacy_jenjang, s.class_name AS legacy_class_name, m.full_name AS master_name, COALESCE(c.class_name, e.class_name) AS resolved_class_name FROM student_enrollments e LEFT JOIN students s ON s.id = e.student_id LEFT JOIN student_masters m ON m.id = e.student_master_id LEFT JOIN academic_classes c ON c.id = e.academic_class_id WHERE e.academic_year_id = ? AND e.jenjang_id = ? AND COALESCE(c.class_name, e.class_name) = ? ORDER BY e.class_name, m.full_name, s.name`, [ctx.body.academic_year_id, academicClass.jenjang_id, academicClass.class_name]).map((value) => serializeEnrollment(context, { ...value, student_id: value.legacy_student_id, student_name: value.master_name ?? value.legacy_student_name, jenjang: value.legacy_jenjang, student_class_name: value.legacy_class_name, class_name: value.resolved_class_name }));
      return { status: "success", created: created.length, skipped_existing: masterIds.length - created.length, enrollment_ids: created, enrollments };
    } catch { return fail(ctx.set, 409, "Enrollment conflict detected"); }
  }, { body: enrollmentBody });

  app.delete("/api/grades/enrollment/:enrollment_id", (ctx: Context) => {
    if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" };
    const value = row(context, "SELECT * FROM student_enrollments WHERE id = ?", [ctx.params.enrollment_id]);
    if (!value) return fail(ctx.set, 404, "Enrollment not found");
    const status = serializeEnrollment(context, value).deletion;
    if (ctx.body?.confirmation !== "DELETE_UNUSED_DRAFT_ENROLLMENT") return fail(ctx.set, 400, { code: "CONFIRMATION_REQUIRED", message: "The hard-delete confirmation token is invalid." });
    if (!status.can_hard_delete) return fail(ctx.set, 409, status);
    try { context.database.client.run("DELETE FROM student_enrollments WHERE id = ?", [ctx.params.enrollment_id]); return { status: "success", deleted: 1, enrollment_id: Number(ctx.params.enrollment_id) }; } catch { return fail(ctx.set, 409, { code: "ENROLLMENT_DEPENDENCY_CONFLICT", message: "Enrollment is referenced and cannot be deleted." }); }
  }, { params: t.Object({ enrollment_id: t.Number({ minimum: 1 }) }), body: t.Optional(t.Object({ confirmation: t.String() })) });

  app.post("/api/grades/save", (ctx: Context) => {
    if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" };
    const client = context.database.client;
    const enrollment = row(context, "SELECT * FROM student_enrollments WHERE id = ?", [ctx.body.enrollment_id]);
    if (!enrollment) return fail(ctx.set, 404, "Enrollment not found");
    if (enrollment.lifecycle_state !== "ACTIVE") return fail(ctx.set, 409, { code: "ENROLLMENT_NOT_ACTIVE", message: "Grades may only be recorded for an active enrollment." });
    const assessmentSessionId = ctx.body.assessment_session_id;
    if (assessmentSessionId !== null) {
      const session = row(context, "SELECT id, academic_year_id FROM academic_assessment_sessions WHERE id = ?", [assessmentSessionId]);
      if (!session) return fail(ctx.set, 404, "Assessment session not found");
      if (Number(session.academic_year_id) !== Number(enrollment.academic_year_id)) return fail(ctx.set, 400, "Assessment session does not belong to the enrollment academic year");
    }
    const keys = new Set<string>();
    const subjectIds: number[] = [...new Set<number>(ctx.body.grades.map((value: Row) => Number(value.subject_id)))];
    const componentIds: number[] = [...new Set<number>(ctx.body.grades.map((value: Row) => Number(value.component_id)))];
    const subjects = new Set(rows(context, `SELECT id FROM subjects WHERE id IN (${subjectIds.map(() => "?").join(",")})`, subjectIds).map((value) => Number(value.id)));
    const missingSubjects = subjectIds.filter((id) => !subjects.has(id));
    if (missingSubjects.length) return fail(ctx.set, 404, `Subject not found for id(s): ${missingSubjects.join(", ")}`);
    const components = new Map(rows(context, `SELECT id, subject_id FROM assessment_components WHERE id IN (${componentIds.map(() => "?").join(",")})`, componentIds).map((value) => [Number(value.id), value]));
    const missingComponents = componentIds.filter((id) => !components.has(id));
    if (missingComponents.length) return fail(ctx.set, 404, `Assessment component not found for id(s): ${missingComponents.join(", ")}`);
    for (const item of ctx.body.grades as Row[]) {
      const key = `${item.subject_id}:${item.component_id}`;
      if (keys.has(key)) return fail(ctx.set, 400, "Duplicate subject_id and component_id pair in payload");
      keys.add(key);
      const component = components.get(Number(item.component_id));
      if (component && component.subject_id !== null && Number(component.subject_id) !== Number(item.subject_id)) return fail(ctx.set, 400, `Component ${item.component_id} is scoped to subject ${component.subject_id}, not subject ${item.subject_id}`);
    }
    let inserted = 0; let updated = 0; const saved: Row[] = [];
    try {
      inTransaction(client, () => {
        for (const item of ctx.body.grades as Row[]) {
          const existing = assessmentSessionId === null
            ? row(context, "SELECT id FROM student_subject_grades WHERE enrollment_id = ? AND subject_id = ? AND component_id = ? AND assessment_session_id IS NULL", [ctx.body.enrollment_id, item.subject_id, item.component_id])
            : row(context, "SELECT id FROM student_subject_grades WHERE enrollment_id = ? AND subject_id = ? AND component_id = ? AND assessment_session_id = ?", [ctx.body.enrollment_id, item.subject_id, item.component_id, assessmentSessionId]);
          if (existing) { client.run("UPDATE student_subject_grades SET score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [item.score ?? null, existing.id]); updated++; saved.push({ id: existing.id, enrollment_id: ctx.body.enrollment_id, subject_id: item.subject_id, component_id: item.component_id, assessment_session_id: assessmentSessionId, score: item.score ?? null }); }
          else if (assessmentSessionId === null) throw new Error("LEGACY_INSERT_REQUIRES_TEMPORAL_CONTEXT");
          else { const result = client.run("INSERT INTO student_subject_grades (enrollment_id, subject_id, component_id, assessment_session_id, score) VALUES (?, ?, ?, ?, ?)", [ctx.body.enrollment_id, item.subject_id, item.component_id, assessmentSessionId, item.score ?? null]); inserted++; saved.push({ id: Number(result.lastInsertRowid), enrollment_id: ctx.body.enrollment_id, subject_id: item.subject_id, component_id: item.component_id, assessment_session_id: assessmentSessionId, score: item.score ?? null }); }
        }
      });
      return { status: "success", inserted, updated, saved: inserted + updated, grades: saved };
    } catch { return fail(ctx.set, 409, "The grade record could not be saved. Retry or contact the system administrator."); }
  }, { body: GradeGridSaveRequestSchema });

  app.get("/api/grades/analytics", (ctx: Context) => {
    if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" };
    const year = row(context, "SELECT id, label FROM academic_years WHERE id = ?", [Number(ctx.query.academic_year_id)]);
    if (!year) return fail(ctx.set, 404, "Academic year not found");
    const filter = ctx.query.jenjang_id === undefined ? "" : " AND e.jenjang_id = ?";
    const params = ctx.query.jenjang_id === undefined ? [year.id] : [year.id, Number(ctx.query.jenjang_id)];
    const summary = row(context, `SELECT COUNT(g.id) AS grade_count, AVG(g.score) AS average_score FROM student_enrollments e JOIN student_subject_grades g ON g.enrollment_id = e.id WHERE e.academic_year_id = ?${filter}`, params) ?? { grade_count: 0, average_score: null };
    const cohorts = rows(context, `SELECT j.id AS jenjang_id, j.name AS jenjang, COUNT(g.id) AS grade_count, AVG(g.score) AS average_score FROM student_enrollments e JOIN jenjangs j ON j.id = e.jenjang_id JOIN student_subject_grades g ON g.enrollment_id = e.id WHERE e.academic_year_id = ?${filter} GROUP BY j.id, j.name ORDER BY j.name`, params).map((value) => ({ jenjang_id: value.jenjang_id, jenjang: value.jenjang, grade_count: Number(value.grade_count), average_score: value.average_score === null ? null : Math.round(Number(value.average_score) * 100) / 100 }));
    return { academic_year_id: year.id, academic_year: year.label, jenjang_id: ctx.query.jenjang_id === undefined ? null : Number(ctx.query.jenjang_id), grade_count: Number(summary.grade_count ?? 0), average_score: summary.average_score === null ? null : Math.round(Number(summary.average_score) * 100) / 100, cohorts };
  }, { query: t.Object({ academic_year_id: t.String(), jenjang_id: t.Optional(t.String()) }) });

  app.get("/api/grades/academic-years", (ctx: Context) => {
    if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" };
    return rows(context, "SELECT id, label, start_date, end_date, status, is_default FROM academic_years ORDER BY start_date, id").map((value) => ({ ...value, is_default: bool(value.is_default) }));
  });
  app.post("/api/grades/academic-years", (ctx: Context) => {
    const user = actor(context, ctx, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" };
    const label = ctx.body.label.trim(); if (!label) return fail(ctx.set, 400, "Academic year label is required");
    if (ctx.body.end_date < ctx.body.start_date) return fail(ctx.set, 400, "Academic year end_date must be on or after start_date");
    if (row(context, "SELECT id FROM academic_years WHERE label = ?", [label])) return fail(ctx.set, 409, "Academic year label already exists");
    try {
      let created: Row | null = null;
      inTransaction(context.database.client, () => { if (ctx.body.is_default) context.database.client.run("UPDATE academic_years SET is_default = 0 WHERE is_default = 1"); const result = context.database.client.run("INSERT INTO academic_years (label, start_date, end_date, status, is_default) VALUES (?, ?, ?, ?, ?)", [label, ctx.body.start_date, ctx.body.end_date, ctx.body.status ?? "active", ctx.body.is_default ? 1 : 0]); created = row(context, "SELECT id, label, start_date, end_date, status, is_default FROM academic_years WHERE id = ?", [Number(result.lastInsertRowid)]); });
      const createdRow = created as Row | null;
      if (!createdRow) return fail(ctx.set, 500, "The academic year could not be created.");
      return { ...createdRow, is_default: bool(createdRow.is_default) };
    } catch { return fail(ctx.set, 409, "Academic year conflict detected"); }
  }, { body: yearBody });
  app.get("/api/grades/subjects", (ctx: Context) => { if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" }; return rows(context, "SELECT id, name, jenjang_id, supports_sumatif, supports_formatif FROM subjects WHERE jenjang_id = ? ORDER BY name, id", [Number(ctx.query.jenjang_id)]).map((value) => ({ ...value, supports_sumatif: bool(value.supports_sumatif), supports_formatif: bool(value.supports_formatif) })); }, { query: t.Object({ jenjang_id: t.String() }) });
  app.post("/api/grades/subjects", (ctx: Context) => { const user = actor(context, ctx, { role: "admin" }); if (!user) return { detail: "Insufficient permissions" }; const name = ctx.body.name.trim(); if (!name) return fail(ctx.set, 400, "Subject name is required"); if (!row(context, "SELECT id FROM jenjangs WHERE id = ?", [ctx.body.jenjang_id])) return fail(ctx.set, 404, "Jenjang not found"); if (row(context, "SELECT id FROM subjects WHERE name = ? AND jenjang_id = ?", [name, ctx.body.jenjang_id])) return fail(ctx.set, 409, "Subject already exists for this jenjang"); try { const result = context.database.client.run("INSERT INTO subjects (name, jenjang_id, supports_sumatif, supports_formatif) VALUES (?, ?, ?, ?)", [name, ctx.body.jenjang_id, ctx.body.supports_sumatif === false ? 0 : 1, ctx.body.supports_formatif === false ? 0 : 1]); return { id: Number(result.lastInsertRowid), name, jenjang_id: ctx.body.jenjang_id, supports_sumatif: ctx.body.supports_sumatif !== false, supports_formatif: ctx.body.supports_formatif !== false }; } catch { return fail(ctx.set, 409, "Subject conflict detected"); } }, { body: subjectBody });
  app.get("/api/grades/jenjangs", (ctx: Context) => { if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" }; return rows(context, "SELECT id, name FROM jenjangs ORDER BY name, id"); });
  app.get("/api/grades/components", (ctx: Context) => { if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" }; return rows(context, "SELECT id, name, assessment_type, subject_id FROM assessment_components ORDER BY name, id"); });
}
