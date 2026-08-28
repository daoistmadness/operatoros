import { randomUUID } from "node:crypto";
import { t } from "elysia";
import { inTransaction } from "@operatoros/db";
import { actor } from "./core";
import type { AuthContext, CurrentUser } from "../auth/service";

type Row = Record<string, any>;
type Context = any;

const ACTIVE = new Set(["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "MONITORING", "REOPENED"]);
const TERMINAL = new Set(["RESOLVED", "DISMISSED"]);
const TRANSITIONS: Record<string, Set<string>> = {
  OPEN: new Set(["ACKNOWLEDGED", "IN_PROGRESS", "DISMISSED"]),
  ACKNOWLEDGED: new Set(["IN_PROGRESS", "MONITORING", "DISMISSED"]),
  IN_PROGRESS: new Set(["MONITORING", "RESOLVED", "DISMISSED"]),
  MONITORING: new Set(["IN_PROGRESS", "RESOLVED", "DISMISSED"]),
  RESOLVED: new Set(["REOPENED"]),
  DISMISSED: new Set(["REOPENED"]),
  REOPENED: new Set(["ACKNOWLEDGED", "IN_PROGRESS", "DISMISSED"]),
};

function rows(context: AuthContext, sql: string, params: any[] = []): Row[] { return context.database.client.query(sql).all(...params) as Row[]; }
function row(context: AuthContext, sql: string, params: any[] = []): Row | null { return (context.database.client.query(sql).get(...params) as Row | null) ?? null; }
function json(value: unknown): any { if (value == null || value === "") return null; if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return null; } }
function iso(value: unknown): string | null { return value == null || value === "" ? null : String(value).replace(" ", "T"); }
function fail(set: any, status: number, code: string, message: string): Row { set.status = status; return { detail: { code, message } }; }
function now(): string { return new Date().toISOString().replace("T", " ").replace("Z", ""); }
function dateValue(value: unknown): string | null { return value == null || value === "" ? null : String(value).slice(0, 10); }
function idValue(value: unknown): string | null { return value == null ? null : String(value); }

function caseQuery(context: AuthContext): Row[] {
  return rows(context, `SELECT f.*, m.full_name AS student_name, c.class_name, ay.label AS academic_year_label,
    assigned.username AS assigned_to_username, created.username AS created_by_username,
    acknowledged.username AS acknowledged_by_username, resolved.username AS resolved_by_username
    FROM attendance_follow_ups f
    LEFT JOIN student_masters m ON m.id = f.student_master_id
    LEFT JOIN academic_classes c ON c.id = f.academic_class_id
    LEFT JOIN academic_years ay ON ay.id = f.academic_year_id
    LEFT JOIN users assigned ON assigned.id = f.assigned_to_user_id
    LEFT JOIN users created ON created.id = f.created_by_user_id
    LEFT JOIN users acknowledged ON acknowledged.id = f.acknowledged_by_user_id
    LEFT JOIN users resolved ON resolved.id = f.resolved_by_user_id`);
}

function assignedClassIds(context: AuthContext, user: CurrentUser, date?: string | null): number[] | null {
  if (user.role === "admin") return null;
  const where = ["user_id = ?", "active = 1"];
  const params: any[] = [user.id];
  if (date) { where.push("(effective_from IS NULL OR effective_from <= ?)", "(effective_to IS NULL OR effective_to >= ?)"); params.push(date, date); }
  return rows(context, `SELECT academic_class_id FROM teacher_class_assignments WHERE ${where.join(" AND ")}`, params).map((value) => Number(value.academic_class_id));
}

function visible(context: AuthContext, user: CurrentUser, value: Row): boolean {
  const ids = assignedClassIds(context, user, dateValue(value.exception_date));
  return ids !== null && ids.length === 0 ? false : ids === null || value.academic_class_id == null || ids.includes(Number(value.academic_class_id));
}

function serialize(context: AuthContext, value: Row, includeNotes = true): Row {
  const notes = includeNotes ? rows(context, "SELECT n.*, u.username AS created_by_username FROM attendance_follow_up_notes n LEFT JOIN users u ON u.id = n.created_by_user_id WHERE n.follow_up_id = ? ORDER BY n.created_at ASC, n.id ASC", [value.id]).map((note) => ({ id: note.id, note_type: note.note_type, body: note.body, created_by_user_id: note.created_by_user_id, created_by_username: note.created_by_username ?? null, created_at: iso(note.created_at) })) : [];
  const due = value.due_at ? Date.parse(String(value.due_at).replace(" ", "T") + (String(value.due_at).includes("Z") ? "" : "Z")) : NaN;
  return {
    id: Number(value.id), exception_key: value.exception_key, exception_kind: value.exception_kind,
    student_master_id: idValue(value.student_master_id), student_name: value.student_name ?? null,
    student_enrollment_id: value.student_enrollment_id ?? null, attendance_id: value.attendance_id ?? null,
    attendance_correction_request_id: value.attendance_correction_request_id ?? null, early_departure_excuse_id: value.early_departure_excuse_id ?? null,
    academic_class_id: value.academic_class_id ?? null, class_name: value.class_name ?? null, academic_year_id: value.academic_year_id ?? null,
    exception_date: dateValue(value.exception_date), period_start: dateValue(value.period_start), period_end: dateValue(value.period_end),
    source_snapshot: json(value.source_snapshot), status: value.status, priority: value.priority,
    assigned_to_user_id: value.assigned_to_user_id ?? null, assigned_to_username: value.assigned_to_username ?? null,
    created_by_user_id: value.created_by_user_id ?? null, acknowledged_by_user_id: value.acknowledged_by_user_id ?? null,
    acknowledged_at: iso(value.acknowledged_at), resolved_by_user_id: value.resolved_by_user_id ?? null, resolved_at: iso(value.resolved_at),
    resolution_code: value.resolution_code ?? null, resolution_note: value.resolution_note ?? null, due_at: iso(value.due_at),
    is_overdue: Boolean(due && !Number.isNaN(due) && ACTIVE.has(String(value.status)) && due < Date.now()), version: Number(value.version),
    created_at: iso(value.created_at), updated_at: iso(value.updated_at), notes,
  };
}

function filteredCases(context: AuthContext, user: CurrentUser, query: Row): Row[] {
  let values = caseQuery(context).filter((value) => visible(context, user, value));
  if (query.status) values = values.filter((value) => value.status === String(query.status).toUpperCase());
  if (query.priority) values = values.filter((value) => value.priority === String(query.priority).toUpperCase());
  if (query.exception_kind) values = values.filter((value) => value.exception_kind === String(query.exception_kind).toUpperCase());
  if (query.academic_class_id) values = values.filter((value) => Number(value.academic_class_id) === Number(query.academic_class_id));
  if (query.unassigned_only === "true") values = values.filter((value) => value.assigned_to_user_id == null);
  else if (query.my_cases_only === "true") values = values.filter((value) => Number(value.assigned_to_user_id) === user.id);
  else if (query.assigned_to_user_id) values = values.filter((value) => Number(value.assigned_to_user_id) === Number(query.assigned_to_user_id));
  if (query.is_overdue === "true") values = values.filter((value) => serialize(context, value, false).is_overdue);
  if (query.is_overdue === "false") values = values.filter((value) => !serialize(context, value, false).is_overdue || TERMINAL.has(String(value.status)));
  return values.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")) || Number(b.id) - Number(a.id));
}

function audit(context: AuthContext, user: CurrentUser, action: string, followUpId: number | null, before: Row | null, after: Row | null, metadata: Row = {}): void {
  context.database.client.run("INSERT INTO attendance_follow_up_audit (follow_up_id, actor, action, before_summary, after_summary, metadata_payload, timestamp, schema_version) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1)", [followUpId, user.username, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, JSON.stringify(metadata)]);
}

function findCase(context: AuthContext, user: CurrentUser, id: number, set: any): Row | null {
  const value = caseQuery(context).find((item) => Number(item.id) === id);
  if (!value || !visible(context, user, value)) { fail(set, 404, "ATTENDANCE_FOLLOWUP_NOT_FOUND", `Follow-up case #${id} not found.`); return null; }
  return value;
}

function activeCase(context: AuthContext, key: string): Row | null {
  return row(context, "SELECT * FROM attendance_follow_ups WHERE exception_key = ? AND status IN ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'MONITORING', 'REOPENED') LIMIT 1", [key]);
}

function candidate(context: AuthContext, kind: string, studentMasterId: string | null, studentName: string, classId: number | null, className: string | null, date: string | null, sourceId: number, severity: string, evidence: string): Row {
  const key = `${kind}:${studentMasterId ?? "0"}:${date ?? "no_date"}:${sourceId}`;
  const existing = activeCase(context, key);
  return { exception_key: key, exception_kind: kind, student_master_id: studentMasterId, student_name: studentName, academic_class_id: classId, class_name: className, exception_date: date, severity, evidence_summary: evidence, source_entity: "attendance", source_id: sourceId, materialized_case: existing ? serialize(context, existing, false) : null };
}

function discoverCandidates(context: AuthContext, user: CurrentUser, query: Row): Row[] {
  const where = ["1 = 1"]; const params: any[] = [];
  if (query.class_id) { where.push("e.academic_class_id = ?"); params.push(Number(query.class_id)); }
  if (query.date_from) { where.push("a.date >= ?"); params.push(query.date_from); }
  if (query.date_to) { where.push("a.date <= ?"); params.push(query.date_to); }
  const assigned = assignedClassIds(context, user);
  if (assigned !== null) { if (!assigned.length && !query.class_id) return []; if (assigned.length && !query.class_id) { where.push(`e.academic_class_id IN (${assigned.map(() => "?").join(",")})`); params.push(...assigned); } }
  const values = rows(context, `SELECT a.id, a.date, a.status, a.check_in, a.check_out, a.is_absent, a.late_source, s.name AS student_name, COALESCE(e.student_master_id, CAST(s.id AS TEXT)) AS student_master_id, e.academic_class_id, c.class_name AS class_name FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.lifecycle_state = 'ACTIVE' LEFT JOIN academic_classes c ON c.id = e.academic_class_id WHERE ${where.join(" AND ")} ORDER BY a.date DESC, a.id DESC`, params);
  const result: Row[] = [];
  for (const value of values) {
    const status = String(value.status ?? "").toLowerCase();
    const date = dateValue(value.date); const master = idValue(value.student_master_id); const classId = value.academic_class_id == null ? null : Number(value.academic_class_id);
    if (status === "alfa" || status === "absent" || Number(value.is_absent) === 1 && !["sakit", "izin"].includes(status)) result.push(candidate(context, "UNEXPLAINED_ABSENCE", master, value.student_name, classId, value.class_name ?? null, date, Number(value.id), "HIGH", `Unexplained absence recorded on ${date}`));
    else if (status === "late" || value.late_source && value.late_source !== "none") result.push(candidate(context, "LATE_ARRIVAL", master, value.student_name, classId, value.class_name ?? null, date, Number(value.id), "MEDIUM", `Late arrival recorded at ${value.check_in ? String(value.check_in).slice(0, 5) : "N/A"} on ${date}`));
    if (value.check_in && !value.check_out) result.push(candidate(context, "MISSING_CHECKOUT", master, value.student_name, classId, value.class_name ?? null, date, Number(value.id), "MEDIUM", `Check-in present but missing checkout on ${date}`));
  }
  for (const value of rows(context, "SELECT id, device_identifier FROM student_device_identities WHERE is_active = 1 AND (student_master_id IS NULL OR legacy_student_id IS NULL)")) result.push(candidate(context, "UNMATCHED_DEVICE_IDENTITY", null, "Unmatched Device", null, null, null, Number(value.id), "HIGH", `Unmatched card identity #${value.device_identifier} requires student mapping`));
  return result;
}

function createCase(context: AuthContext, user: CurrentUser, body: Row, set: any): Row {
  const assigned = assignedClassIds(context, user, body.exception_date);
  if (assigned !== null && body.academic_class_id && !assigned.includes(Number(body.academic_class_id))) return fail(set, 403, "ATTENDANCE_FOLLOWUP_SCOPE_FORBIDDEN", "You are not assigned to manage follow-ups for this class.");
  if (activeCase(context, body.exception_key)) return fail(set, 400, "ATTENDANCE_FOLLOWUP_DUPLICATE_OPEN_CASE", `An active follow-up case already exists for exception key '${body.exception_key}'.`);
  if (body.assigned_to_user_id && !row(context, "SELECT id FROM users WHERE id = ? AND is_active = 1", [Number(body.assigned_to_user_id)])) return fail(set, 400, "ATTENDANCE_FOLLOWUP_ASSIGNEE_FORBIDDEN", "Target assignee user was not found or is inactive.");
  try {
    const result = context.database.client.run("INSERT INTO attendance_follow_ups (exception_key, exception_kind, student_master_id, student_enrollment_id, attendance_id, attendance_correction_request_id, early_departure_excuse_id, academic_class_id, academic_year_id, exception_date, period_start, period_end, source_snapshot, status, priority, assigned_to_user_id, created_by_user_id, due_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", [body.exception_key.trim(), body.exception_kind.trim().toUpperCase(), idValue(body.student_master_id), body.student_enrollment_id ?? null, body.attendance_id ?? null, body.attendance_correction_request_id ?? null, body.early_departure_excuse_id ?? null, body.academic_class_id ?? null, body.academic_year_id ?? null, body.exception_date ?? null, body.period_start ?? null, body.period_end ?? null, body.source_snapshot ? JSON.stringify(body.source_snapshot) : null, String(body.priority ?? "MEDIUM").toUpperCase(), body.assigned_to_user_id ?? null, user.id, body.due_at ?? null]);
    const created = row(context, "SELECT * FROM attendance_follow_ups WHERE id = ?", [Number(result.lastInsertRowid)]) as Row;
    audit(context, user, "CREATE", Number(result.lastInsertRowid), null, serialize(context, { ...created, student_name: null }, false));
    return serialize(context, caseQuery(context).find((value) => Number(value.id) === Number(result.lastInsertRowid)) as Row);
  } catch { return fail(set, 409, "ATTENDANCE_FOLLOWUP_CREATE_FAILED", "The follow-up case could not be created."); }
}

function updateCase(context: AuthContext, user: CurrentUser, id: number, target: string, body: Row, set: any): Row {
  const current = findCase(context, user, id, set); if (!current) return { detail: "Follow-up case not found" };
  if (body.version != null && Number(body.version) !== Number(current.version)) return fail(set, 409, "ATTENDANCE_FOLLOWUP_STALE_VERSION", `Stale version conflict on case #${id}. Refresh and retry.`);
  const status = String(target).toUpperCase();
  if (status !== current.status && !TRANSITIONS[String(current.status)]?.has(status)) return fail(set, 400, "ATTENDANCE_FOLLOWUP_INVALID_TRANSITION", `Cannot transition case #${id} from '${current.status}' to '${status}'.`);
  if (status === "RESOLVED" && !String(body.resolution_code ?? "").trim()) return fail(set, 400, "ATTENDANCE_FOLLOWUP_RESOLUTION_REQUIRED", "resolution_code is required to resolve a case.");
  if (status === "DISMISSED" && !String(body.resolution_note ?? body.explanation ?? "").trim()) return fail(set, 400, "ATTENDANCE_FOLLOWUP_RESOLUTION_REQUIRED", "Explanation is required to dismiss a case.");
  if (status === "REOPENED" && !String(body.resolution_note ?? body.reason ?? "").trim()) return fail(set, 400, "ATTENDANCE_FOLLOWUP_REOPEN_REASON_REQUIRED", "Reopen reason is required to reopen a resolved case.");
  const assigned = assignedClassIds(context, user, dateValue(current.exception_date));
  if (assigned !== null && current.academic_class_id && !assigned.includes(Number(current.academic_class_id))) return fail(set, 403, "ATTENDANCE_FOLLOWUP_SCOPE_FORBIDDEN", "You do not have permission to access this follow-up case.");
  if (body.assigned_to_user_id != null && !row(context, "SELECT id FROM users WHERE id = ? AND is_active = 1", [Number(body.assigned_to_user_id)])) return fail(set, 400, "ATTENDANCE_FOLLOWUP_ASSIGNEE_FORBIDDEN", "Target assignee user not found or inactive.");
  let action = "UPDATE"; if (status === "ACKNOWLEDGED") action = "ACKNOWLEDGE"; else if (status === "IN_PROGRESS") action = "START_PROGRESS"; else if (status === "MONITORING") action = "MONITOR"; else if (status === "RESOLVED") action = "RESOLVE"; else if (status === "DISMISSED") action = "DISMISS"; else if (status === "REOPENED") action = "REOPEN";
  const updates = ["status = ?", "version = version + 1", "updated_at = CURRENT_TIMESTAMP"]; const values: any[] = [status];
  if (status === "ACKNOWLEDGED" && current.status !== status) { updates.push("acknowledged_by_user_id = ?", "acknowledged_at = CURRENT_TIMESTAMP"); values.push(user.id); }
  if (status === "RESOLVED" || status === "DISMISSED") { updates.push("resolved_by_user_id = ?", "resolved_at = CURRENT_TIMESTAMP", "resolution_code = ?", "resolution_note = ?"); values.push(user.id, status === "DISMISSED" ? String(body.resolution_code ?? "DISMISSED").trim().toUpperCase() : String(body.resolution_code).trim().toUpperCase(), status === "DISMISSED" ? String(body.explanation ?? body.resolution_note).trim() : body.resolution_note?.trim() ?? null); }
  if (status === "REOPENED") updates.push("resolved_by_user_id = NULL", "resolved_at = NULL", "resolution_code = NULL");
  if (body.assigned_to_user_id != null) { updates.push("assigned_to_user_id = ?"); values.push(Number(body.assigned_to_user_id)); }
  if (body.priority != null) { updates.push("priority = ?"); values.push(String(body.priority).toUpperCase()); }
  if (body.due_at != null) { updates.push("due_at = ?"); values.push(body.due_at); }
  try {
    let updated: Row | null = null;
    inTransaction(context.database.client, () => { context.database.client.run(`UPDATE attendance_follow_ups SET ${updates.join(", ")} WHERE id = ?`, [...values, id]); updated = caseQuery(context).find((value) => Number(value.id) === id) ?? null; audit(context, user, action, id, serialize(context, current, false), updated ? serialize(context, updated, false) : null, {}); });
    return updated ? serialize(context, updated) : fail(set, 404, "ATTENDANCE_FOLLOWUP_NOT_FOUND", `Follow-up case #${id} not found.`);
  } catch { return fail(set, 409, "ATTENDANCE_FOLLOWUP_UPDATE_FAILED", "The follow-up case could not be updated."); }
}

function metrics(context: AuthContext, user: CurrentUser): Row {
  const values = filteredCases(context, user, {}); const byKind: Row = {}; const byPriority: Row = {}; const byClass: Row = {}; let open = 0; let unassigned = 0; let overdue = 0; let reopened = 0; let resolved = 0; let dismissed = 0; const ack: number[] = []; const done: number[] = [];
  for (const value of values) { if (ACTIVE.has(value.status)) { open++; if (value.assigned_to_user_id == null) unassigned++; if (serialize(context, value, false).is_overdue) overdue++; } if (value.status === "REOPENED") reopened++; else if (value.status === "RESOLVED") resolved++; else if (value.status === "DISMISSED") dismissed++; byKind[value.exception_kind] = (byKind[value.exception_kind] ?? 0) + 1; byPriority[value.priority] = (byPriority[value.priority] ?? 0) + 1; const className = value.class_name ?? "Global / Unassigned"; byClass[className] = (byClass[className] ?? 0) + 1; const created = Date.parse(String(value.created_at).replace(" ", "T") + "Z"); if (value.acknowledged_at) ack.push((Date.parse(String(value.acknowledged_at).replace(" ", "T") + "Z") - created) / 1000); if (value.resolved_at) done.push((Date.parse(String(value.resolved_at).replace(" ", "T") + "Z") - created) / 1000); }
  const average = (items: number[]) => items.length ? Math.round(items.reduce((sum, value) => sum + value, 0) / items.length * 100) / 100 : 0;
  return { open_cases: open, unassigned_cases: unassigned, overdue_cases: overdue, reopened_count: reopened, resolved_count: resolved, dismissed_count: dismissed, by_kind: byKind, by_priority: byPriority, by_class: byClass, avg_acknowledgement_time_seconds: average(ack), avg_resolution_time_seconds: average(done) };
}

export function attendanceFollowupRoutes(app: any, context: AuthContext): any {
  const idParams = t.Object({ id: t.Number({ minimum: 1 }) });
  const listQuery = t.Object({ status: t.Optional(t.String()), priority: t.Optional(t.String()), exception_kind: t.Optional(t.String()), assigned_to_user_id: t.Optional(t.String()), academic_class_id: t.Optional(t.String()), is_overdue: t.Optional(t.String()), unassigned_only: t.Optional(t.String()), my_cases_only: t.Optional(t.String()) });
  const createBody = t.Object({ exception_key: t.String({ minLength: 1 }), exception_kind: t.String({ minLength: 1 }), student_master_id: t.Optional(t.Union([t.String(), t.Number()])), student_enrollment_id: t.Optional(t.Number()), attendance_id: t.Optional(t.Number()), attendance_correction_request_id: t.Optional(t.Number()), early_departure_excuse_id: t.Optional(t.Number()), academic_class_id: t.Optional(t.Number()), academic_year_id: t.Optional(t.Number()), exception_date: t.Optional(t.String()), period_start: t.Optional(t.String()), period_end: t.Optional(t.String()), source_snapshot: t.Optional(t.Record(t.String(), t.Any())), priority: t.Optional(t.String()), assigned_to_user_id: t.Optional(t.Number()), due_at: t.Optional(t.String()) });
  const updateBody = t.Object({ version: t.Optional(t.Number()), priority: t.Optional(t.String()), assigned_to_user_id: t.Optional(t.Number()), due_at: t.Optional(t.String()) });
  const assignBody = t.Object({ assigned_to_user_id: t.Number({ minimum: 1 }), version: t.Optional(t.Number()) });
  const resolveBody = t.Object({ resolution_code: t.String({ minLength: 1 }), resolution_note: t.Optional(t.String()), version: t.Optional(t.Number()) });
  const dismissBody = t.Object({ explanation: t.String({ minLength: 1 }), resolution_code: t.Optional(t.String()), version: t.Optional(t.Number()) });
  const reopenBody = t.Object({ reason: t.String({ minLength: 1 }), version: t.Optional(t.Number()) });
  const noteBody = t.Object({ body: t.String({ minLength: 1 }), note_type: t.Optional(t.String()) });
  const bulkAssignBody = t.Object({ follow_up_ids: t.Array(t.Number({ minimum: 1 }), { minItems: 1 }), assigned_to_user_id: t.Number({ minimum: 1 }) });
  const bulkResolveBody = t.Object({ follow_up_ids: t.Array(t.Number({ minimum: 1 }), { minItems: 1 }), resolution_code: t.String({ minLength: 1 }), resolution_note: t.Optional(t.String()) });
  app.get("/api/attendance/followups/candidates", ({ query, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "view_attendance_followups" }); if (!user) return { detail: "Insufficient permissions" }; const items = discoverCandidates(context, user, query); return { total: items.length, items }; }, { query: t.Object({ class_id: t.Optional(t.String()), status_filter: t.Optional(t.String()), date_from: t.Optional(t.String()), date_to: t.Optional(t.String()) }) });
  app.get("/api/attendance/followups/metrics/summary", ({ set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "view_attendance_followups" }); if (!user) return { detail: "Insufficient permissions" }; return metrics(context, user); });
  app.get("/api/attendance/followups", ({ query, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "view_attendance_followups" }); if (!user) return { detail: "Insufficient permissions" }; const items = filteredCases(context, user, query).map((value) => serialize(context, value, false)); return { total: items.length, items }; }, { query: listQuery });
  app.post("/api/attendance/followups", ({ body, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "create_attendance_followup" }); if (!user) return { detail: "Insufficient permissions" }; return createCase(context, user, body, set); }, { body: createBody });
  app.get("/api/attendance/followups/:id/history", ({ params, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "view_attendance_followup_audit" }); if (!user) return { detail: "Insufficient permissions" }; const value = findCase(context, user, Number(params.id), set); if (!value) return { detail: "Follow-up case not found" }; return { follow_up_id: Number(params.id), history: rows(context, "SELECT * FROM attendance_follow_up_audit WHERE follow_up_id = ? ORDER BY timestamp ASC, id ASC", [params.id]).map((item) => ({ id: item.id, follow_up_id: item.follow_up_id, actor: item.actor, action: item.action, before_summary: json(item.before_summary), after_summary: json(item.after_summary), metadata_payload: json(item.metadata_payload), timestamp: iso(item.timestamp) })) }; }, { params: idParams });
  app.get("/api/attendance/followups/:id", ({ params, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "view_attendance_followups" }); if (!user) return { detail: "Insufficient permissions" }; const value = findCase(context, user, Number(params.id), set); return value ? serialize(context, value, true) : { detail: "Follow-up case not found" }; }, { params: idParams });
  app.patch("/api/attendance/followups/:id", ({ params, body, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "update_attendance_followup" }); if (!user) return { detail: "Insufficient permissions" }; const current = findCase(context, user, Number(params.id), set); return current ? updateCase(context, user, Number(params.id), current.status, body, set) : { detail: "Follow-up case not found" }; }, { params: idParams, body: updateBody });
  const simple = (path: string, status: string, capability: string, body: any = undefined) => app.post(path, ({ params, body: values, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: capability as any }); if (!user) return { detail: "Insufficient permissions" }; return updateCase(context, user, Number(params.id), status, values ?? {}, set); }, { params: idParams, ...(body ? { body } : {}) });
  simple("/api/attendance/followups/:id/acknowledge", "ACKNOWLEDGED", "update_attendance_followup"); simple("/api/attendance/followups/:id/start", "IN_PROGRESS", "update_attendance_followup"); simple("/api/attendance/followups/:id/monitor", "MONITORING", "update_attendance_followup"); simple("/api/attendance/followups/:id/resolve", "RESOLVED", "resolve_attendance_followup", resolveBody); simple("/api/attendance/followups/:id/dismiss", "DISMISSED", "resolve_attendance_followup", dismissBody); simple("/api/attendance/followups/:id/reopen", "REOPENED", "reopen_attendance_followup", reopenBody);
  app.post("/api/attendance/followups/:id/assign", ({ params, body, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "assign_attendance_followup" }); if (!user) return { detail: "Insufficient permissions" }; return updateCase(context, user, Number(params.id), String(findCase(context, user, Number(params.id), set)?.status ?? "OPEN"), body, set); }, { params: idParams, body: assignBody });
  app.post("/api/attendance/followups/:id/notes", ({ params, body, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "update_attendance_followup" }); if (!user) return { detail: "Insufficient permissions" }; const value = findCase(context, user, Number(params.id), set); if (!value) return { detail: "Follow-up case not found" }; try { const result = context.database.client.run("INSERT INTO attendance_follow_up_notes (follow_up_id, note_type, body, created_by_user_id, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)", [params.id, String(body.note_type ?? "INTERNAL_NOTE").trim().toUpperCase(), String(body.body).trim(), user.id]); const note = row(context, "SELECT n.*, u.username AS created_by_username FROM attendance_follow_up_notes n LEFT JOIN users u ON u.id = n.created_by_user_id WHERE n.id = ?", [Number(result.lastInsertRowid)]) as Row; audit(context, user, "ADD_NOTE", Number(params.id), null, null, { note_id: note.id, note_type: note.note_type }); return { id: note.id, follow_up_id: note.follow_up_id, note_type: note.note_type, body: note.body, created_by_user_id: note.created_by_user_id, created_by_username: note.created_by_username ?? null, created_at: iso(note.created_at) }; } catch { return fail(set, 409, "ATTENDANCE_FOLLOWUP_NOTE_FAILED", "The follow-up note could not be added."); } }, { params: idParams, body: noteBody });
  app.post("/api/attendance/followups/bulk-assign", ({ body, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "assign_attendance_followup" }); if (!user) return { detail: "Insufficient permissions" }; const items: Row[] = []; for (const id of body.follow_up_ids) { const current = findCase(context, user, id, set); if (!current) return { detail: "Follow-up case not found" }; const value = updateCase(context, user, id, current.status, { assigned_to_user_id: body.assigned_to_user_id }, set); if (set.status >= 400) return value; items.push(value); } return { total_updated: items.length, items }; }, { body: bulkAssignBody });
  app.post("/api/attendance/followups/bulk-resolve", ({ body, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "resolve_attendance_followup" }); if (!user) return { detail: "Insufficient permissions" }; const items: Row[] = []; for (const id of body.follow_up_ids) { const value = updateCase(context, user, id, "RESOLVED", { resolution_code: body.resolution_code, resolution_note: body.resolution_note }, set); if (set.status >= 400) return value; items.push(value); } return { total_updated: items.length, items }; }, { body: bulkResolveBody });
  return app;
}
