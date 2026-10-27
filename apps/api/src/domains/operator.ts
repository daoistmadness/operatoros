import { t } from "elysia";
import { actor } from "./core";
import type { AuthContext } from "../auth/service";
import { schoolLocalDate } from "./attendance-submission-deadline";
import { eligibleStaffBySchoolUnitForMonth } from "./staff-school-units";
import {
  DashboardOperationalOverviewSchema,
  BospReminderStatusSchema,
  BospAcknowledgePayloadSchema,
} from "@operatoros/contracts";

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
  if (["RESOLVED", "DISMISSED", "APPROVED", "REJECTED", "CANCELLED", "COMPLETED", "SYNCHRONIZED", "VERIFIED", "SUBMITTED"].includes(String(status))) return "COMPLETED";
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

function queueCandidate(value: Row): Row {
  const kind = String(value.metadata?.exception_kind ?? "");
  const title = kind.toLowerCase().replaceAll("_", " ").replace(/(^|\s)[a-z]/g, (letter) => letter.toUpperCase());
  const metadata = { ...value.metadata };
  delete metadata.jenjang;
  return {
    ...value,
    title: `Kandidat: ${title}`,
    evidence_summary: "Eksplorasi kandidat pengecualian kehadiran.",
    metadata: {
      ...metadata,
      academic_class_id: metadata.academic_class_id ?? null,
      severity: value.priority,
      evidence_summary: value.evidence_summary,
      materialized_case: metadata.materialized_case ?? null,
    },
  };
}

export function getDashboardOperationalOverview(context: AuthContext) {
  const now = context.now?.() ?? new Date();
  const [yearPart, monthPart] = schoolLocalDate(now).split("-");
  const currentYear = Number(yearPart);
  const currentMonth = Number(monthPart);
  const currentPeriod = `${currentYear}-${String(currentMonth).padStart(2, "0")}`;
  const monthStart = `${currentPeriod}-01`;
  const monthEnd = new Date(Date.UTC(currentYear, currentMonth, 0)).toISOString().slice(0, 10);

  const students = rows(context, "SELECT student_status, nisn FROM student_masters");
  const activeCount = students.filter((student) => String(student.student_status).toLowerCase() === "active").length;
  const inputtedNisn = students.filter((student) => /[^\s\p{White_Space}]/u.test(String(student.nisn ?? ""))).length;

  const pendingVerif = rows(context, `
    SELECT COUNT(DISTINCT m.id) AS count
    FROM student_masters m
    LEFT JOIN student_identity_verifications v_nik ON v_nik.student_master_id = m.id AND v_nik.identifier_type = 'NIK'
    LEFT JOIN student_identity_verifications v_kk ON v_kk.student_master_id = m.id AND v_kk.identifier_type = 'KK'
    WHERE (v_nik.verification_status IS NULL OR v_nik.verification_status != 'VERIFIED')
       OR (v_kk.verification_status IS NULL OR v_kk.verification_status != 'VERIFIED')
  `)[0]?.count ?? 0;

  const activeStaff = rows(context, `
    SELECT COUNT(*) AS count FROM staff_members WHERE employment_status = 'ACTIVE'
  `)[0]?.count ?? 0;

  const activityPeriod = rows(context, "SELECT id FROM staff_monthly_activity_periods WHERE reporting_year=? AND reporting_month=?", [currentYear, currentMonth])[0];
  const ptkStats = activityPeriod
    ? rows(context, `SELECT
        COUNT(CASE WHEN a.status != 'NOT_APPLICABLE' THEN 1 END) AS applicable,
        COUNT(CASE WHEN a.status = 'COMPLETED' THEN 1 END) AS completed,
        COUNT(CASE WHEN a.status = 'PENDING' THEN 1 END) AS pending,
        COUNT(CASE WHEN a.status = 'NEEDS_CORRECTION' THEN 1 END) AS needs_correction
      FROM staff_monthly_activities a WHERE a.period_id=?`, [activityPeriod.id])[0] ?? { applicable: 0, completed: 0, pending: 0, needs_correction: 0 }
    : (() => {
        const applicable = eligibleStaffBySchoolUnitForMonth(context.database.client, monthStart, monthEnd).length;
        return { applicable, completed: 0, pending: applicable, needs_correction: 0 };
      })();

  const uppStats = rows(context, `SELECT
      COUNT(*) AS expected,
      COUNT(CASE WHEN v.id IS NOT NULL THEN 1 END) AS uploaded,
      COUNT(CASE WHEN v.id IS NOT NULL AND r.submission_status != 'SUBMITTED' THEN 1 END) AS awaiting_submission,
      COUNT(CASE WHEN v.id IS NOT NULL AND r.submission_status = 'SUBMITTED' THEN 1 END) AS submitted
    FROM school_units u
    LEFT JOIN upp_monthly_reports r ON r.school_unit_id=u.id AND r.reporting_year=? AND r.reporting_month=?
    LEFT JOIN upp_report_versions v ON v.report_id=r.id AND v.is_active=1
    WHERE u.status='ACTIVE'`, [currentYear, currentMonth])[0] ?? { expected: 0, uploaded: 0, awaiting_submission: 0, submitted: 0 };

  return {
    students: {
      active_count: Number(activeCount),
      nisn_inputted_count: inputtedNisn,
      nisn_not_inputted_count: students.length - inputtedNisn,
      pending_verification_count: Number(pendingVerif),
    },
    staff: {
      active_count: Number(activeStaff),
      monthly_ptk_applicable_count: Number(ptkStats.applicable ?? 0),
      monthly_ptk_completed_count: Number(ptkStats.completed ?? 0),
      monthly_ptk_pending_count: Number(ptkStats.pending ?? 0),
      monthly_ptk_needs_correction_count: Number(ptkStats.needs_correction ?? 0),
    },
    upp: {
      current_period: currentPeriod,
      expected_count: Number(uppStats.expected ?? 0),
      uploaded_count: Number(uppStats.uploaded ?? 0),
      awaiting_submission_count: Number(uppStats.awaiting_submission ?? 0),
      submitted_count: Number(uppStats.submitted ?? 0),
    },
  };
}

export function getBospReminderStatus(context: AuthContext) {
  const now = context.now?.() ?? new Date();
  const currentYear = Number(schoolLocalDate(now).slice(0, 4));

  // Cutoff date is August 31 of current calendar year at 23:59:59 Jakarta time (+07:00)
  const cutoffDateIso = `${currentYear}-08-31T23:59:59+07:00`;
  const cutoffUtcMs = Date.parse(cutoffDateIso);
  const nowMs = now.getTime();

  // Fetch settings
  const setting = rows(context, "SELECT advance_notice_days FROM bosp_annual_reminder_settings WHERE id = 1")[0];
  const advanceNoticeDays = Number(setting?.advance_notice_days ?? 60);

  const windowStartMs = cutoffUtcMs - advanceNoticeDays * 24 * 60 * 60 * 1000;
  const isInNoticeWindow = nowMs >= windowStartMs && nowMs <= cutoffUtcMs;
  const daysRemaining = nowMs <= cutoffUtcMs
    ? Math.max(0, Math.ceil((cutoffUtcMs - nowMs) / (24 * 60 * 60 * 1000)))
    : 0;

  const ack = rows(context, "SELECT * FROM bosp_reminder_acknowledgments WHERE calendar_year = ?", [currentYear])[0];

  return {
    calendar_year: currentYear,
    cutoff_date: cutoffDateIso,
    advance_notice_days: advanceNoticeDays,
    is_in_notice_window: isInNoticeWindow,
    days_remaining: daysRemaining,
    is_acknowledged: Boolean(ack),
    acknowledged_at: ack?.acknowledged_at ?? null,
    acknowledged_by: ack?.acknowledged_by ?? null,
    notes: ack?.notes ?? null,
    is_blocking: false,
  };
}

export function acknowledgeBospReminder(
  context: AuthContext,
  user: { username: string },
  payload: { calendar_year: number; notes?: string | null }
) {
  const nowIso = (context.now?.() ?? new Date()).toISOString();
  context.database.client.run(`INSERT INTO bosp_reminder_acknowledgments (calendar_year, acknowledged_at, acknowledged_by, notes)
    VALUES (?, ?, ?, ?) ON CONFLICT(calendar_year) DO UPDATE SET
      acknowledged_at=excluded.acknowledged_at, acknowledged_by=excluded.acknowledged_by, notes=excluded.notes`,
  [payload.calendar_year, nowIso, user.username, payload.notes ?? null]);
  return getBospReminderStatus(context);
}

export function updateBospReminderSettings(
  context: AuthContext,
  user: { username: string; role: string },
  payload: { advance_notice_days: number }
) {
  const nowIso = (context.now?.() ?? new Date()).toISOString();
  context.database.client.run(
    "UPDATE bosp_annual_reminder_settings SET advance_notice_days = ?, updated_at = ? WHERE id = 1",
    [payload.advance_notice_days, nowIso]
  );
  return getBospReminderStatus(context);
}

export function workQueue(context: AuthContext, user: Row): Row[] {
  const singleUser = process.env.OPERATOROS_DEPLOYMENT_MODE === "single_user_offline";
  const items: Row[] = [];
  const activeStatuses = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "MONITORING", "REOPENED"];
  const followupWhere = singleUser || user.role === "admin"
    ? "WHERE f.status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS','MONITORING','REOPENED')"
    : "WHERE f.status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS','MONITORING','REOPENED') AND (f.assigned_to_user_id = ? OR f.assigned_to_user_id IS NULL)";
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
    const className = value.academic_class_name ?? null;
    const status = String(value.override_status ?? value.status ?? "").toLowerCase();
    const date = value.date ?? null;
    const id = Number(value.id);
    const add = (item: Row) => { if (!existingKeys.has(item.deduplication_key)) items.push(item); };
    if (status === "alfa" || status === "absent" || Number(value.is_absent) === 1 && !["sakit", "izin"].includes(status)) {
      add(queueCandidate(candidate("UNEXPLAINED_ABSENCE", studentReference, value.student_name, className, null, date, id, `Unexplained absence recorded on ${date}`, "HIGH", { academic_class_id: value.academic_class_id ?? null, source_entity: "attendance", source_id: id })));
    } else if (status === "late" || value.late_source && value.late_source !== "none") {
      add(queueCandidate(candidate("LATE_ARRIVAL", studentReference, value.student_name, className, null, date, id, `Late arrival recorded at ${value.check_in ? String(value.check_in).slice(0, 5) : "N/A"} on ${date}`, "MEDIUM", { academic_class_id: value.academic_class_id ?? null, source_entity: "attendance", source_id: id })));
    }
    if (value.check_in && !value.check_out) add(queueCandidate(candidate("MISSING_CHECKOUT", studentReference, value.student_name, className, null, date, id, `Check-in present but missing checkout on ${date}`, "MEDIUM", { academic_class_id: value.academic_class_id ?? null, source_entity: "attendance", source_id: id })));
    if (value.pending_correction_id) add(queueCandidate(candidate("PENDING_CORRECTION", studentReference, value.student_name, className, null, date, Number(value.pending_correction_id), `Pending attendance correction request #${value.pending_correction_id} submitted on ${date}`, "MEDIUM", { academic_class_id: value.academic_class_id ?? null, source_entity: "attendance_correction_requests", source_id: Number(value.pending_correction_id) })));
  }

  for (const value of rows(context, `
    SELECT r.id, r.state, r.proposed_status, r.reason_code, r.explanation, r.requester, r.version, r.submitted_at,
           a.student_id, a.date, s.name AS student_name, s.class_name
    FROM attendance_correction_requests r
    LEFT JOIN attendance a ON a.id = r.attendance_id
    LEFT JOIN students s ON s.id = a.student_id
    WHERE r.state IN ('SUBMITTED', 'DRAFT', 'PENDING_APPROVAL')`)) {
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

  if (user.role === "admin") {
  const today = schoolLocalDate(context.now?.() ?? new Date());
  const reportingYear = Number(today.slice(0, 4));
  const reportingMonth = Number(today.slice(5, 7));

  // --- Module A & B: Student Identity & DAPODIK Integration ---
  // 1. Student Identity Verification Pending (UNVERIFIED)
  const pendingVerifications = rows(context, `
    SELECT m.id AS student_master_id, m.full_name AS student_name, m.nisn, m.nipd,
           (SELECT c.class_name FROM student_enrollments e JOIN academic_classes c ON c.id=e.academic_class_id
             WHERE e.student_master_id=m.id AND e.lifecycle_state='ACTIVE' ORDER BY e.updated_at DESC,e.id DESC LIMIT 1) AS class_name,
           v_nik.verification_status AS nik_status,
           v_kk.verification_status AS kk_status
    FROM student_masters m
    LEFT JOIN student_identity_verifications v_nik ON v_nik.student_master_id = m.id AND v_nik.identifier_type = 'NIK'
    LEFT JOIN student_identity_verifications v_kk ON v_kk.student_master_id = m.id AND v_kk.identifier_type = 'KK'
    WHERE v_nik.verification_status IN ('UNVERIFIED','IDENTIFIER_ENTERED') OR v_nik.verification_status IS NULL
       OR v_kk.verification_status IN ('UNVERIFIED','IDENTIFIER_ENTERED') OR v_kk.verification_status IS NULL
    ORDER BY m.full_name ASC
  `);
  for (const value of pendingVerifications) {
    const nikStatus = value.nik_status ?? "UNVERIFIED";
    const kkStatus = value.kk_status ?? "UNVERIFIED";
    items.push({
      item_type: "STUDENT_VERIFICATION",
      source_id: `student-verif-${value.student_master_id}`,
      deduplication_key: `student-verif-${value.student_master_id}`,
      student_reference: value.student_master_id,
      student_display_label: value.student_name ?? "Siswa",
      class_reference: value.class_name ?? null,
      jenjang_reference: null,
      event_date: null,
      title: `Verifikasi Identitas: ${value.student_name}`,
      evidence_summary: `Status: NIK (${nikStatus}), KK (${kkStatus}). Dokumen kependudukan belum diverifikasi.`,
      workflow_status: "UNVERIFIED",
      priority: "MEDIUM",
      due_at: null,
      derived_due_state: "NO_DUE_DATE",
      available_actions: ["view_student"],
      source_route: `/students/${value.student_master_id}`,
      last_activity_timestamp: new Date().toISOString(),
      metadata: { student_master_id: value.student_master_id, nik_status: nikStatus, kk_status: kkStatus },
    });
  }

  // 2. Student Identity Correction Needed (NEEDS_CORRECTION)
  const identityCorrections = rows(context, `
    SELECT m.id AS student_master_id, m.full_name AS student_name,
           (SELECT c.class_name FROM student_enrollments e JOIN academic_classes c ON c.id=e.academic_class_id
             WHERE e.student_master_id=m.id AND e.lifecycle_state='ACTIVE' ORDER BY e.updated_at DESC,e.id DESC LIMIT 1) AS class_name,
           v.identifier_type, v.correction_reason, v.updated_at
    FROM student_identity_verifications v
    JOIN student_masters m ON m.id = v.student_master_id
    WHERE v.verification_status = 'NEEDS_CORRECTION'
    ORDER BY v.updated_at DESC
  `);
  for (const value of identityCorrections) {
    items.push({
      item_type: "STUDENT_IDENTITY_CORRECTION",
      source_id: `student-id-corr-${value.student_master_id}-${value.identifier_type}`,
      deduplication_key: `student-id-corr-${value.student_master_id}-${value.identifier_type}`,
      student_reference: value.student_master_id,
      student_display_label: value.student_name ?? "Siswa",
      class_reference: value.class_name ?? null,
      jenjang_reference: null,
      event_date: value.updated_at ? value.updated_at.slice(0, 10) : null,
      title: `Koreksi ${value.identifier_type}: ${value.student_name}`,
      evidence_summary: `Koreksi dokumen identitas ${value.identifier_type} diperlukan. Alasan: ${value.correction_reason || "Data tidak cocok"}.`,
      workflow_status: "NEEDS_CORRECTION",
      priority: "HIGH",
      due_at: value.updated_at ?? null,
      derived_due_state: "DUE_TODAY",
      available_actions: ["view_student"],
      source_route: `/students/${value.student_master_id}`,
      last_activity_timestamp: value.updated_at,
      metadata: { student_master_id: value.student_master_id, identifier_type: value.identifier_type, reason: value.correction_reason },
    });
  }

  // 3. Student DAPODIK Correction Needed (NEEDS_CORRECTION)
  const dapodikCorrections = rows(context, `
    SELECT m.id AS student_master_id, m.full_name AS student_name,
           (SELECT c.class_name FROM student_enrollments e JOIN academic_classes c ON c.id=e.academic_class_id
             WHERE e.student_master_id=m.id AND e.lifecycle_state='ACTIVE' ORDER BY e.updated_at DESC,e.id DESC LIMIT 1) AS class_name,
           d.correction_reason, d.notes, d.updated_at
    FROM student_dapodik_registrations d
    JOIN student_masters m ON m.id = d.student_master_id
    WHERE d.status = 'NEEDS_CORRECTION'
    ORDER BY d.updated_at DESC
  `);
  for (const value of dapodikCorrections) {
    items.push({
      item_type: "STUDENT_DAPODIK_CORRECTION",
      source_id: `student-dapodik-corr-${value.student_master_id}`,
      deduplication_key: `student-dapodik-corr-${value.student_master_id}`,
      student_reference: value.student_master_id,
      student_display_label: value.student_name ?? "Siswa",
      class_reference: value.class_name ?? null,
      jenjang_reference: null,
      event_date: value.updated_at ? value.updated_at.slice(0, 10) : null,
      title: `Koreksi DAPODIK: ${value.student_name}`,
      evidence_summary: `Pendaftaran DAPODIK memerlukan koreksi. Catatan: ${value.correction_reason || value.notes || "Perlu perbaikan data siswa"}.`,
      workflow_status: "NEEDS_CORRECTION",
      priority: "HIGH",
      due_at: value.updated_at ?? null,
      derived_due_state: "DUE_TODAY",
      available_actions: ["view_student"],
      source_route: `/students/${value.student_master_id}`,
      last_activity_timestamp: value.updated_at,
      metadata: { student_master_id: value.student_master_id, reason: value.correction_reason },
    });
  }

  // --- Module C: Monthly PTK Activity Reviews ---
  const activityPeriod = rows(context, "SELECT id FROM staff_monthly_activity_periods WHERE reporting_year=? AND reporting_month=?", [reportingYear, reportingMonth])[0];
  if (activityPeriod) {
  const ptkPending = rows(context, `
    SELECT a.id, a.staff_member_id, a.school_unit_id, a.status, a.processing_notes, a.version, a.updated_at,
           s.full_name AS staff_name,
           p.reporting_year, p.reporting_month
    FROM staff_monthly_activities a
    JOIN staff_members s ON s.id = a.staff_member_id
    JOIN staff_monthly_activity_periods p ON p.id = a.period_id
    WHERE a.status IN ('PENDING', 'NEEDS_CORRECTION')
      AND p.id=?
    ORDER BY p.reporting_year DESC, p.reporting_month DESC, a.updated_at DESC
  `, [activityPeriod.id]);
  for (const value of ptkPending) {
    const periodStr = `${value.reporting_year}-${String(value.reporting_month).padStart(2, "0")}`;
    const isCorrection = value.status === "NEEDS_CORRECTION";
    items.push({
      item_type: "STAFF_PTK_REVIEW",
      source_id: `ptk-activity-${value.id}`,
      deduplication_key: `ptk-activity-${value.id}`,
      student_reference: null,
      student_display_label: value.staff_name ?? "Staf/PTK",
      class_reference: null,
      jenjang_reference: null,
      event_date: `${periodStr}-01`,
      title: `Aktivitas PTK (${periodStr}): ${value.staff_name}`,
      evidence_summary: `Status aktivitas: ${value.status}. ${value.processing_notes ? `Catatan: ${value.processing_notes}` : ""}`.trim(),
      workflow_status: value.status,
      priority: isCorrection ? "HIGH" : "MEDIUM",
      due_at: value.updated_at ?? null,
      derived_due_state: isCorrection ? "DUE_TODAY" : "DUE_LATER",
      available_actions: ["view_ptk"],
      source_route: `/staff/monthly-activities?period=${periodStr}`,
      last_activity_timestamp: value.updated_at,
      metadata: { activity_id: value.id, staff_id: value.staff_member_id, period: periodStr, status: value.status },
    });
  }
  } else {
    const eligible = eligibleStaffBySchoolUnitForMonth(context.database.client, `${today.slice(0, 7)}-01`, new Date(Date.UTC(reportingYear, reportingMonth, 0)).toISOString().slice(0, 10));
    const periodStr = `${reportingYear}-${String(reportingMonth).padStart(2, "0")}`;
    if (eligible.length > 0) {
      const sourceId = `ptk-period-${periodStr}`;
      items.push({
        item_type: "STAFF_PTK_REVIEW",
        source_id: sourceId,
        deduplication_key: sourceId,
        student_reference: null,
        student_display_label: null,
        class_reference: null,
        jenjang_reference: null,
        event_date: `${periodStr}-01`,
        title: `Buat aktivitas PTK (${periodStr})`,
        evidence_summary: `${eligible.length} PTK berlaku belum memiliki catatan untuk periode ini.`,
        workflow_status: "PENDING",
        priority: "MEDIUM",
        due_at: null,
        derived_due_state: "DUE_TODAY",
        available_actions: ["view_ptk"],
        source_route: `/staff/monthly-activities?period=${periodStr}`,
        last_activity_timestamp: null,
        metadata: { eligible_staff_count: eligible.length, period: periodStr, status: "PENDING", action_type: "GENERATE_PERIOD" },
      });
    }
  }

  // --- Module D: Monthly UPP Reports ---
  const uppPending = rows(context, `
    SELECT r.id, r.school_unit_id, r.reporting_year, r.reporting_month,
           COALESCE(r.submission_status, 'NOT_UPLOADED') AS submission_status, r.updated_at,
           u.name AS unit_name, v.file_sha256
    FROM school_units u
    LEFT JOIN upp_monthly_reports r ON r.school_unit_id=u.id AND r.reporting_year=? AND r.reporting_month=?
    LEFT JOIN upp_report_versions v ON v.report_id=r.id AND v.is_active=1
    WHERE u.status='ACTIVE' AND (v.id IS NULL OR r.submission_status IN ('UPLOADED','READY_FOR_SUBMISSION'))
    ORDER BY u.name
  `, [reportingYear, reportingMonth]);
  for (const value of uppPending) {
    const periodStr = `${reportingYear}-${String(reportingMonth).padStart(2, "0")}`;
    const hasWorkbook = Boolean(value.file_sha256);
    const actionType = !hasWorkbook ? "MISSING_WORKBOOK" : "AWAITING_SUBMISSION";
    const sourceId = value.id ?? `${value.school_unit_id}-${periodStr}`;
    const title = !hasWorkbook
      ? `UPP Workbook Belum Diunggah: ${value.unit_name} (${periodStr})`
      : `UPP Menunggu Pengiriman: ${value.unit_name} (${periodStr})`;
    const evidence = !hasWorkbook
      ? `Laporan UPP ${periodStr} untuk unit ${value.unit_name} belum memiliki berkas workbook .xlsx.`
      : `Laporan UPP ${periodStr} berstatus ${value.submission_status}, menunggu finalisasi atau pengiriman.`;
    items.push({
      item_type: "UPP_REPORT_PENDING",
      source_id: `upp-report-${sourceId}`,
      deduplication_key: `upp-report-${sourceId}`,
      student_reference: null,
      student_display_label: value.unit_name ?? "Unit Sekolah",
      class_reference: null,
      jenjang_reference: null,
      event_date: `${periodStr}-01`,
      title,
      evidence_summary: evidence,
      workflow_status: value.submission_status,
      priority: !hasWorkbook ? "HIGH" : "MEDIUM",
      due_at: value.updated_at ?? null,
      derived_due_state: !hasWorkbook ? "DUE_TODAY" : "DUE_LATER",
      available_actions: ["view_upp"],
      source_route: `/reports/upp`,
      last_activity_timestamp: value.updated_at,
      metadata: { report_id: value.id ?? null, unit_name: value.unit_name, period: periodStr, has_workbook: hasWorkbook, action_type: actionType },
    });
  }
  }

  // NOTE: SOP Rule Compliance (YSPE-OPR-PS-001 Prosedur Laporan DAPODIK Rev 04):
  // "An IOM Missing task is permitted only when an authoritative existing transfer context
  // identifies a required but absent IOM. If no reliable transfer context exists,
  // do not fabricate missing-IOM tasks."
  // Because student_masters contains no standalone transfer-state engine, zero phantom IOM tasks
  // are created here to guarantee strict absence of false positives.

  return items.sort((a, b) => itemDueOrder(a.derived_due_state) - itemDueOrder(b.derived_due_state) || String(a.last_activity_timestamp ?? "").localeCompare(String(b.last_activity_timestamp ?? "")));
}

export function operatorRoutes(app: any, context: AuthContext): any {
  app.get("/api/operator/dashboard-overview", (ctx: Context) => {
    const user = actor(context, ctx, {});
    if (!user) return { detail: "Authentication required" };
    return getDashboardOperationalOverview(context);
  }, { response: DashboardOperationalOverviewSchema });

  app.get("/api/operator/bosp-reminder", (ctx: Context) => {
    const user = actor(context, ctx, {});
    if (!user) return { detail: "Authentication required" };
    return getBospReminderStatus(context);
  }, { response: BospReminderStatusSchema });

  app.post("/api/operator/bosp-reminder/acknowledge", (ctx: Context) => {
    const user = actor(context, ctx, {});
    if (!user) return { detail: "Authentication required" };
    const currentYear = Number(schoolLocalDate(context.now?.() ?? new Date()).slice(0, 4));
    if (ctx.body.calendar_year !== currentYear) {
      ctx.set.status = 409;
      return { detail: "Only the current school-calendar year can be acknowledged." };
    }
    return acknowledgeBospReminder(context, user, ctx.body);
  }, { body: BospAcknowledgePayloadSchema, response: BospReminderStatusSchema });

  app.put("/api/operator/bosp-reminder/settings", (ctx: Context) => {
    const user = actor(context, ctx, { role: "admin" });
    if (!user) return { detail: "Admin role required" };
    return updateBospReminderSettings(context, user, ctx.body);
  }, {
    body: t.Object({ advance_notice_days: t.Integer({ minimum: 1, maximum: 365 }) }),
    response: BospReminderStatusSchema,
  });

  app.get("/api/operator/work-queue", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_attendance_followups" });
    if (!user) return { detail: "Insufficient permissions" };
    return workQueue(context, user);
  }, { response: t.Array(t.Any()) });

  return app;
}
