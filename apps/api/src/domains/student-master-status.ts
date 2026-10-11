import type { AuthContext } from "../auth/service";

type Client = AuthContext["database"]["client"];
type Actor = Record<string, any>;
type Row = Record<string, unknown>;

const STUDENT_STATUSES = ["pending_review", "active", "inactive", "transferred", "withdrawn", "graduated", "archived"] as const;
type StudentStatus = typeof STUDENT_STATUSES[number];

function row(client: Client, sql: string, params: any[]): Row | null {
  return (client.query(sql).get(...params) as Row | null) ?? null;
}

export function setStudentMasterStatus(client: Client, studentMasterId: string, nextStatus: unknown, actor: Actor, source: string, action = "student_status_changed"): boolean {
  if (typeof nextStatus !== "string" || !STUDENT_STATUSES.includes(nextStatus as StudentStatus)) throw new Error("INVALID_STUDENT_STATUS");
  if (typeof actor.username !== "string" || !actor.username || !source) throw new Error("STUDENT_STATUS_ACTOR_REQUIRED");
  const current = row(client, "SELECT student_status FROM student_masters WHERE id = ?", [studentMasterId]);
  if (!current) throw new Error("STUDENT_MASTER_NOT_FOUND");
  const oldStatus = current.student_status as string;
  if (oldStatus === nextStatus) return false;
  const update = client.run("UPDATE student_masters SET student_status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND student_status = ?", [nextStatus, actor.username, studentMasterId, oldStatus]);
  if (update.changes !== 1) throw new Error("STUDENT_STATUS_CHANGED");
  client.run("INSERT INTO student_master_change_history (student_master_id, action, field_name, old_value, new_value, source, changed_by) VALUES (?, ?, 'student_status', ?, ?, ?, ?)", [studentMasterId, action, oldStatus, nextStatus, source, actor.username]);
  return true;
}

export function graduateStudentMaster(client: Client, studentMasterId: string, sourceEnrollmentId: number, actor: Actor): boolean {
  if (!row(client, "SELECT id FROM student_masters WHERE id = ?", [studentMasterId])) throw new Error("STUDENT_MASTER_NOT_FOUND");
  if (row(client, "SELECT id FROM student_enrollments WHERE student_master_id = ? AND id != ? AND lifecycle_state = 'ACTIVE' LIMIT 1", [studentMasterId, sourceEnrollmentId])) return false;
  return setStudentMasterStatus(client, studentMasterId, "graduated", actor, "student_progression");
}
