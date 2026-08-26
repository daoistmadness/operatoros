import { createHash, randomUUID } from "node:crypto";
import { t } from "elysia";
import { actor } from "./core";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;

function rows(context: AuthContext, sql: string, params: any[] = []): Row[] { return context.database.client.query(sql).all(...params) as Row[]; }
function row(context: AuthContext, sql: string, params: any[] = []): Row | null { return (context.database.client.query(sql).get(...params) as Row | null) ?? null; }
function fail(set: any, status: number, detail: string): Row { set.status = status; return { detail }; }
function parse(value: unknown): Row | null { if (value == null || value === "") return null; if (typeof value === "object") return value as Row; try { return JSON.parse(String(value)) as Row; } catch { return null; } }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`; return JSON.stringify(value); }
function digest(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function stateChecksum(value: unknown): string { return digest(value); }
function audit(context: AuthContext, user: Row, session: Row, operation: string, metadata: Row): void {
  context.database.client.run("INSERT INTO operations_audit_events (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source, import_session_id, success, metadata, schema_version) VALUES (?, ?, ?, ?, 'IMPORT_SESSION', ?, ?, ?, 'API', ?, 1, ?, '1')", [randomUUID(), user.username, user.role, "rollback_import_session", session.session_uuid, operation, operation === "ROLLBACK_COMMIT" ? "CRITICAL" : "MEDIUM", session.id, JSON.stringify(metadata)]);
}

function preview(context: AuthContext, session: Row, user: Row): Row {
  if (session.provenance_status === "LEGACY_PROVENANCE_UNAVAILABLE") {
    audit(context, user, session, "ROLLBACK_PREVIEW", { eligible: 0, blocked: 0, unavailable: true });
    return {
      session_reference: session.session_uuid,
      session_id: session.id,
      provenance_status: session.provenance_status,
      rollback_state: "NOT_AVAILABLE",
      is_rollbackable: false,
      non_rollbackable_reason: "Historical import session marked LEGACY_PROVENANCE_UNAVAILABLE cannot be rolled back because granular action provenance was not recorded.",
      total_applied_actions: 0,
      eligible_actions: 0,
      blocked_actions: 0,
      manual_review_actions: 0,
      already_compensated_actions: 0,
      affected_entity_counts: { students: 0, enrollments: 0, devices: 0 },
      proposed_reverse_action_order: [],
      dependency_conflicts: [],
      preview_checksum: digest(`${session.session_uuid}:UNAVAILABLE`),
      expiration: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      required_capability: "rollback_import_session",
      required_confirmation: `ROLLBACK_SESSION_${String(session.session_uuid).slice(0, 8)}`,
      history_preservation_disclosure: "Compensating rollback appends new historical actions and preserves all original provenance and audit records.",
    };
  }
  if (session.status !== "COMMITTED") return fail({}, 409, `Import session status is '${session.status}', only COMMITTED sessions can be rolled back`);
  const actions = rows(context, "SELECT * FROM student_import_applied_actions WHERE session_id = ? ORDER BY action_sequence ASC", [session.id]);
  const items: Row[] = []; const conflicts: Row[] = [];
  const students = new Set<string>(); const enrollments = new Set<string>(); const devices = new Set<string>();
  let eligible = 0; let blocked = 0; let manual = 0; let compensated = 0;
  for (const action of actions) {
    let eligibility = "ELIGIBLE"; let conflictCode: string | null = null; let reason: string | null = null;
    if (action.rollback_state === "APPLIED") { eligibility = "ALREADY_COMPENSATED"; conflictCode = "ACTION_ALREADY_COMPENSATED"; reason = "This action has already been compensated in a prior rollback."; compensated++; }
    else if (action.entity_type === "STUDENT_MASTER" || action.action_type === "CREATE_STUDENT_MASTER") {
      students.add(String(action.entity_id)); const student = row(context, "SELECT id FROM student_masters WHERE id = ?", [action.entity_id]);
      if (!student) { eligibility = "BLOCKED"; conflictCode = "STUDENT_NOT_FOUND"; reason = "Student master record no longer exists."; }
      else {
        const device = row(context, "SELECT legacy_student_id FROM student_device_identities WHERE student_master_id = ? LIMIT 1", [action.entity_id]);
        const attendanceCount = device ? Number((row(context, "SELECT COUNT(*) AS count FROM attendance WHERE student_id = ?", [device.legacy_student_id]) as Row).count) : 0;
        const gradeCount = Number((row(context, "SELECT COUNT(*) AS count FROM student_subject_grades g JOIN student_enrollments e ON e.id = g.enrollment_id WHERE e.student_master_id = ?", [action.entity_id]) as Row).count);
        const enrollmentCount = Number((row(context, "SELECT COUNT(*) AS count FROM student_enrollments WHERE student_master_id = ?", [action.entity_id]) as Row).count);
        if (attendanceCount) { eligibility = "BLOCKED"; conflictCode = "CREATED_STUDENT_HAS_ATTENDANCE"; reason = `Created student gained ${attendanceCount} attendance records after import.`; }
        else if (gradeCount) { eligibility = "BLOCKED"; conflictCode = "CREATED_STUDENT_HAS_GRADES"; reason = `Created student gained ${gradeCount} grade entries after import.`; }
        else if (enrollmentCount && action.action_type !== "CREATE_STUDENT_MASTER") { eligibility = "BLOCKED"; conflictCode = "CREATED_STUDENT_HAS_ENROLLMENT"; reason = "Created student gained active academic enrollment."; }
      }
    } else if (action.action_type === "UPDATE_STUDENT_PROFILE") {
      students.add(String(action.entity_id)); const student = row(context, "SELECT full_name, gender, birth_place, birth_date FROM student_masters WHERE id = ?", [action.entity_id]);
      if (!student) { eligibility = "BLOCKED"; conflictCode = "STUDENT_NOT_FOUND"; reason = "Target student no longer exists."; }
      else if (stateChecksum(student) !== action.after_state_checksum) { eligibility = "BLOCKED"; conflictCode = "PROFILE_MODIFIED_AFTER_IMPORT"; reason = "Student profile field changed again after the import."; }
    } else if (action.action_type === "UPDATE_SENSITIVE_IDENTIFIER") {
      students.add(String(action.entity_id)); const student = row(context, "SELECT nik, nisn FROM student_masters WHERE id = ?", [action.entity_id]); const before = parse(action.before_state); const after = parse(action.after_state);
      if (!student) { eligibility = "BLOCKED"; conflictCode = "STUDENT_NOT_FOUND"; reason = "Target student no longer exists."; }
      else if ((after?.nik && student.nik !== after.nik) || (after?.nisn && student.nisn !== after.nisn)) { eligibility = "BLOCKED"; conflictCode = "IDENTIFIER_CHANGED_AFTER_IMPORT"; reason = "NIK or NISN changed again after the import."; }
      else if (!before) { eligibility = "MANUAL_REVIEW_REQUIRED"; conflictCode = "MANUAL_REVIEW_REQUIRED"; reason = "Prior sensitive identifier value is missing."; }
    } else if (["ADD_DEVICE_IDENTITY", "REPLACE_DEVICE_IDENTITY"].includes(action.action_type)) {
      devices.add(String(action.entity_id)); const device = row(context, "SELECT is_active FROM student_device_identities WHERE id = ?", [action.entity_id]);
      if (!device) { eligibility = "BLOCKED"; conflictCode = "DEVICE_NOT_FOUND"; reason = "Device identity mapping no longer exists."; }
      else if (!device.is_active) { eligibility = "BLOCKED"; conflictCode = "DEVICE_REASSIGNED_AFTER_IMPORT"; reason = "Device identity mapping was superseded or deactivated after import."; }
    } else if (["CREATE_ENROLLMENT", "TRANSFER_ENROLLMENT", "END_ENROLLMENT"].includes(action.action_type)) {
      enrollments.add(String(action.entity_id)); const enrollment = row(context, "SELECT lifecycle_state FROM student_enrollments WHERE id = ?", [action.entity_id]);
      if (!enrollment) { eligibility = "BLOCKED"; conflictCode = "ENROLLMENT_NOT_FOUND"; reason = "Enrollment record no longer exists."; }
      else if (action.action_type === "CREATE_ENROLLMENT" && enrollment.lifecycle_state !== "ACTIVE") { eligibility = "BLOCKED"; conflictCode = "ENROLLMENT_TRANSFERRED_AFTER_IMPORT"; reason = "Enrollment was transferred or ended again after import."; }
    }
    if (eligibility === "ELIGIBLE") eligible++; else if (eligibility === "BLOCKED") { blocked++; conflicts.push({ action_id: action.id, action_type: action.action_type, entity_id: action.entity_id, conflict_code: conflictCode, reason }); } else if (eligibility === "MANUAL_REVIEW_REQUIRED") { manual++; conflicts.push({ action_id: action.id, action_type: action.action_type, entity_id: action.entity_id, conflict_code: conflictCode, reason }); }
    items.push({ id: action.id, action_sequence: action.action_sequence, action_type: action.action_type, entity_type: action.entity_type, entity_id: action.entity_id, eligibility, conflict_code: conflictCode, block_reason: reason, before_state: parse(action.before_state), after_state: parse(action.after_state), compensation_type: action.compensation_type });
  }
  const reverse = items.slice().sort((a, b) => Number(b.action_sequence) - Number(a.action_sequence));
  const checksumPayload = items.map((item) => ({ id: item.id, eligibility: item.eligibility, code: item.conflict_code })).sort((a, b) => Number(a.id) - Number(b.id));
  const previewChecksum = digest({ session_id: session.id, actions: checksumPayload });
  context.database.client.run("UPDATE student_import_sessions SET rollback_state = 'PREVIEWED', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [session.id]);
  audit(context, user, session, "ROLLBACK_PREVIEW", { eligible, blocked, preview_checksum: previewChecksum });
  return { session_reference: session.session_uuid, session_id: session.id, provenance_status: session.provenance_status, rollback_state: "PREVIEWED", is_rollbackable: eligible > 0, total_applied_actions: actions.length, eligible_actions: eligible, blocked_actions: blocked, manual_review_actions: manual, already_compensated_actions: compensated, affected_entity_counts: { students: students.size, enrollments: enrollments.size, devices: devices.size }, proposed_reverse_action_order: reverse, dependency_conflicts: conflicts, preview_checksum: previewChecksum, expiration: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), required_capability: "rollback_import_session", required_confirmation: `ROLLBACK_SESSION_${String(session.session_uuid).slice(0, 8)}`, history_preservation_disclosure: "Compensating rollback appends new historical actions and preserves all original provenance and audit records." };
}

export function studentImportSessionRoutes(app: any, context: AuthContext): any {
  app.post("/api/student-import-sessions/:session_id/rollback-preview", ({ params, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "rollback_import_session" }); if (!user) return { detail: "Insufficient permissions" };
    const session = row(context, "SELECT * FROM student_import_sessions WHERE id = ? OR session_uuid = ? LIMIT 1", [params.session_id, params.session_id]);
    if (!session) return fail(set, 404, "Import session not found");
    if (session.status !== "COMMITTED" && session.provenance_status !== "LEGACY_PROVENANCE_UNAVAILABLE") return fail(set, 409, `Import session status is '${session.status}', only COMMITTED sessions can be rolled back`);
    return preview(context, session, user);
  }, { params: t.Object({ session_id: t.String({ minLength: 1 }) }) });
  return app;
}
