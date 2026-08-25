import { t } from "elysia";
import { actor } from "./core";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;

function rows(context: AuthContext, sql: string, params: any[] = []): Row[] {
  return context.database.client.query(sql).all(...params) as Row[];
}

function parseJson(value: unknown): Row {
  if (!value) return {};
  try { return JSON.parse(String(value)) as Row; } catch { return {}; }
}

function dueState(dueAt: string | null, status: string | null): string {
  if (["RESOLVED", "DISMISSED", "APPROVED", "REJECTED", "CANCELLED", "COMPLETED"].includes(String(status))) return "COMPLETED";
  if (!dueAt) return "NO_DUE_DATE";
  const due = Date.parse(dueAt.includes("T") ? dueAt : `${dueAt.replace(" ", "T")}Z`);
  if (Number.isNaN(due)) return "OVERDUE";
  const now = new Date();
  const dueDate = new Date(due); const today = now.toISOString().slice(0, 10);
  if (dueDate.toISOString().slice(0, 10) === today) return "DUE_TODAY";
  return due < Date.now() ? "OVERDUE" : "DUE_LATER";
}

function itemDueOrder(value: string): number {
  return { OVERDUE: 0, DUE_TODAY: 1, DUE_LATER: 2, NO_DUE_DATE: 3, COMPLETED: 4 }[value as keyof Record<string, number>] ?? 5;
}

function candidate(
  kind: string,
  studentReference: string | number | null,
  studentLabel: string,
  className: string | null,
  jenjang: string | null,
  date: string | null,
  attendanceId: number,
  evidence: string,
  priority: string,
  metadata: Row = {},
): Row {
  const key = `${kind}:${studentReference ?? "0"}:${date ?? "no_date"}:${attendanceId}`;
  return {
    item_type: "FOLLOWUP_CANDIDATE",
    source_id: `cand-${key}`,
    deduplication_key: key,
    student_reference: studentReference,
    student_display_label: studentLabel,
    class_reference: className,
    jenjang_reference: jenjang,
    event_date: date,
    title: `Kandidat: ${kind.replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase())}`,
    evidence_summary: evidence,
    workflow_status: "DISCOVERED",
    priority,
    due_at: null,
    derived_due_state: "NO_DUE_DATE",
    available_actions: ["materialize_case"],
    source_route: "/attendance/followups",
    last_activity_timestamp: new Date().toISOString(),
    metadata: { exception_key: key, exception_kind: kind, student_master_id: studentReference, student_name: studentLabel, class_name: className, jenjang, exception_date: date, ...metadata },
  };
}

function workQueue(context: AuthContext, user: Row): Row[] {
  const singleUser = process.env.OPERATOROS_DEPLOYMENT_MODE === "single_user_offline";
  const items: Row[] = [];
  const activeStatuses = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "MONITORING", "REOPENED"];
  const followupWhere = singleUser || user.role === "admin" ? "" : "WHERE (f.assigned_to_user_id = ? OR f.assigned_to_user_id IS NULL)";
  const followupParams = singleUser || user.role === "admin" ? [] : [user.id];
  const cases = rows(context, `
    SELECT f.*, m.full_name AS student_name, c.class_name, j.name AS jenjang_name
    FROM attendance_follow_ups f
    LEFT JOIN student_masters m ON m.id = f.student_master_id
    LEFT JOIN academic_classes c ON c.id = f.academic_class_id
    LEFT JOIN academic_grades g ON g.id = c.grade_id
    LEFT JOIN jenjangs j ON j.id = g.jenjang_id
    ${followupWhere}
    ORDER BY f.created_at DESC`, followupParams);
  const existingKeys = new Set<string>();
  for (const value of cases) {
    existingKeys.add(String(value.exception_key));
    if (singleUser && value.assigned_to_user_id == null && activeStatuses.includes(String(value.status))) {
      context.database.client.run("UPDATE attendance_follow_ups SET assigned_to_user_id = ? WHERE id = ?", [user.id, value.id]);
      value.assigned_to_user_id = user.id;
    }
    items.push({
      item_type: "FOLLOWUP_CASE", source_id: `followup-${value.id}`, deduplication_key: value.exception_key,
      student_reference: value.student_master_id, student_display_label: value.student_name ?? "Siswa/Tergantung",
      class_reference: value.class_name ?? null, jenjang_reference: value.jenjang_name ?? null,
      event_date: value.exception_date, title: `Follow-Up: ${String(value.exception_kind).replaceAll("_", " ").replace(/\b\w/g, (item) => item.toUpperCase())}`,
      evidence_summary: parseJson(value.source_snapshot).summary ?? "Kasus follow-up kehadiran.", workflow_status: value.status,
      priority: value.priority, due_at: value.due_at, derived_due_state: dueState(value.due_at, value.status),
      available_actions: ["view_detail", "add_note", "update_status", "set_due_date"], source_route: `/attendance/followups?case_id=${value.id}`,
      last_activity_timestamp: value.updated_at, metadata: { id: value.id, version: Number(value.version), assigned_to_user_id: value.assigned_to_user_id },
    });
  }

  const attendance = rows(context, `
    SELECT a.id, a.date, a.status, a.check_in, a.check_out, a.late_source, a.is_absent,
           s.name AS student_name, s.id AS legacy_student_id, s.class_name AS legacy_class_name,
           e.student_master_id, e.class_name AS enrollment_class_name, c.class_name AS academic_class_name,
           j.name AS jenjang_name, o.override_status, pc.id AS pending_correction_id
    FROM attendance a
    JOIN students s ON s.id = a.student_id
    LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.lifecycle_state = 'ACTIVE'
    LEFT JOIN academic_classes c ON c.id = e.academic_class_id
    LEFT JOIN academic_grades g ON g.id = c.grade_id
    LEFT JOIN jenjangs j ON j.id = g.jenjang_id
    LEFT JOIN attendance_overrides o ON o.attendance_id = a.id
    LEFT JOIN (SELECT attendance_id, MIN(id) AS id FROM attendance_correction_requests WHERE state IN ('DRAFT', 'SUBMITTED', 'PENDING_APPROVAL') GROUP BY attendance_id) pc ON pc.attendance_id = a.id
    ORDER BY a.date DESC, a.id DESC`);
  for (const value of attendance) {
    const studentReference = value.student_master_id ?? String(value.legacy_student_id);
    const className = value.academic_class_name ?? value.enrollment_class_name ?? value.legacy_class_name ?? null;
    const status = String(value.override_status ?? value.status ?? "").toLowerCase();
    const date = value.date ?? null;
    const id = Number(value.id);
    const add = (item: Row) => { if (!existingKeys.has(item.deduplication_key)) items.push(item); };
    if (status === "alfa" || status === "absent" || Number(value.is_absent) === 1 && !["sakit", "izin"].includes(status)) {
      add(candidate("UNEXPLAINED_ABSENCE", studentReference, value.student_name, className, value.jenjang_name ?? null, date, id, `Unexplained absence recorded on ${date}`, "HIGH", { source_entity: "attendance", source_id: id }));
    } else if (status === "late" || value.late_source && value.late_source !== "none") {
      add(candidate("LATE_ARRIVAL", studentReference, value.student_name, className, value.jenjang_name ?? null, date, id, `Late arrival recorded at ${value.check_in ? String(value.check_in).slice(0, 5) : "N/A"} on ${date}`, "MEDIUM", { source_entity: "attendance", source_id: id }));
    }
    if (value.check_in && !value.check_out) add(candidate("MISSING_CHECKOUT", studentReference, value.student_name, className, value.jenjang_name ?? null, date, id, `Check-in present but missing checkout on ${date}`, "MEDIUM", { source_entity: "attendance", source_id: id }));
    if (value.pending_correction_id) add(candidate("PENDING_CORRECTION", studentReference, value.student_name, className, value.jenjang_name ?? null, date, Number(value.pending_correction_id), `Pending attendance correction request #${value.pending_correction_id} submitted on ${date}`, "MEDIUM", { source_entity: "attendance_correction_requests", source_id: Number(value.pending_correction_id) }));
  }

  for (const value of rows(context, `
    SELECT r.id, r.state, r.proposed_status, r.reason_code, r.explanation, r.requester, r.version, r.submitted_at,
           a.student_id, a.date, s.name AS student_name, s.class_name
    FROM attendance_correction_requests r
    LEFT JOIN attendance a ON a.id = r.attendance_id
    LEFT JOIN students s ON s.id = a.student_id
    WHERE r.state IN ('SUBMITTED', 'DRAFT')`)) {
    items.push({ item_type: "CORRECTION_REQUEST", source_id: `correction-${value.id}`, deduplication_key: `correction-${value.id}`,
      student_reference: value.student_id == null ? null : String(value.student_id), student_display_label: value.student_name ?? "Siswa",
      class_reference: value.class_name ?? null, jenjang_reference: null, event_date: value.date ?? null,
      title: `Koreksi: Status ${value.proposed_status}`, evidence_summary: `Alasan (${value.reason_code}): ${value.explanation}`,
      workflow_status: value.state, priority: value.state === "SUBMITTED" ? "HIGH" : "MEDIUM", due_at: value.submitted_at ?? null,
      derived_due_state: value.state === "SUBMITTED" ? "DUE_TODAY" : "DUE_LATER",
      available_actions: singleUser ? ["self_confirm", "approve", "reject", "cancel"] : ["approve", "reject", "cancel"],
      source_route: `/attendance/corrections?id=${value.id}`, last_activity_timestamp: value.updated_at ?? value.submitted_at ?? null,
      metadata: { id: value.id, version: Number(value.version), requester: value.requester },
    });
  }

  for (const value of rows(context, "SELECT id, device_identifier, device_source, effective_from FROM student_device_identities WHERE is_active = 1 AND (student_master_id IS NULL OR legacy_student_id IS NULL)")) {
    items.push({ item_type: "UNMATCHED_DEVICE", source_id: `device-${value.id}`, deduplication_key: `device-${value.id}`, student_reference: null,
      student_display_label: `Perangkat (${value.device_identifier})`, class_reference: null, jenjang_reference: null, event_date: value.effective_from ?? null,
      title: `Perangkat Belum Terhubung: ${value.device_identifier}`, evidence_summary: `Sumber: ${value.device_source}. Kartu/perangkat rfid belum ditautkan ke siswa.`,
      workflow_status: "UNMATCHED", priority: "HIGH", due_at: null, derived_due_state: "DUE_TODAY", available_actions: ["link_student"],
      source_route: "/upload-center", last_activity_timestamp: new Date().toISOString(), metadata: { id: value.id, device_identifier: value.device_identifier },
    });
  }
  return items.sort((a, b) => itemDueOrder(a.derived_due_state) - itemDueOrder(b.derived_due_state) || String(a.last_activity_timestamp ?? "").localeCompare(String(b.last_activity_timestamp ?? "")));
}

export function operatorRoutes(app: any, context: AuthContext): any {
  app.get("/api/operator/work-queue", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_attendance_followups" });
    if (!user) return { detail: "Insufficient permissions" };
    return workQueue(context, user);
  }, { response: t.Array(t.Any()) });
  return app;
}
