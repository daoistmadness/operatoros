import { randomUUID } from "node:crypto";
import {
  DataResetCommitRequestSchema,
  DataResetPreviewRequestSchema,
  DataResetPreviewResponseSchema,
  DataResetResultSchema,
  type DataResetScope,
} from "@operatoros/contracts/system";
import { inTransaction } from "@operatoros/db";
import type { AuthContext, CurrentUser } from "../auth/service";
import { actor } from "./core";
import { createPreResetBackup, type SafetyConfig } from "./safety";

type Row = Record<string, any>;
type Context = any;
type Client = AuthContext["database"]["client"];
type ResetGroup = { domain: string; tables: readonly string[] };

const ATTENDANCE_PLAN: readonly ResetGroup[] = [
  { domain: "Attendance follow-up cases", tables: ["attendance_follow_up_notes", "attendance_follow_up_audit", "attendance_follow_ups"] },
  { domain: "Attendance corrections", tables: ["attendance_correction_audit", "attendance_correction_requests"] },
  { domain: "Early departure records", tables: ["early_departure_excuse_audits", "early_departure_excuses"] },
  { domain: "Attendance overrides", tables: ["attendance_override_history", "attendance_overrides"] },
  { domain: "Attendance import history", tables: ["attendance_import_rows", "attendance_import_batches"] },
  { domain: "Attendance review periods", tables: ["attendance_period_audit", "attendance_periods"] },
  { domain: "Attendance absence summaries", tables: ["absence_reasons", "absence_reason_class_entries"] },
  { domain: "Attendance upload history", tables: ["upload_logs"] },
  { domain: "Attendance records", tables: ["attendance"] },
];

const ACADEMIC_RESULTS_PLAN: readonly ResetGroup[] = [
  { domain: "Academic results and interventions", tables: ["academic_interventions", "student_subject_grades"] },
];

const STUDENT_PLAN: readonly ResetGroup[] = [
  { domain: "Student progression history", tables: ["student_progression_audit", "student_progression_preview_batches"] },
  { domain: "Enrollment history", tables: ["student_enrollment_class_history", "student_enrollment_lifecycle_audit"] },
  { domain: "Student import history", tables: [
    "student_import_applied_actions", "student_import_rows", "student_master_change_history",
    "academic_roster_import_batches", "student_import_batches", "student_import_sessions",
  ] },
  { domain: "Student identity and profile data", tables: [
    "enrollment_population_preview_batches", "legacy_link_preview_batches", "legacy_link_resolutions",
    "student_device_identities", "student_addresses", "student_contacts", "student_parent_guardians",
    "student_health_profiles", "student_document_statuses", "student_enrollments", "students", "student_masters",
  ] },
];

const SCHOOL_STRUCTURE_PLAN: readonly ResetGroup[] = [
  { domain: "School structure review data", tables: ["academic_master_import_previews"] },
  { domain: "Class assignments", tables: ["teacher_class_assignment_audit", "teacher_class_assignments"] },
  { domain: "Staff import history", tables: ["staff_import_issues", "staff_import_rows", "staff_import_batches"] },
  { domain: "Staff profiles", tables: [
    "staff_jenjang_assignments", "staff_identifiers", "staff_contact_details", "staff_education", "staff_members",
  ] },
  { domain: "School report setup", tables: ["report_templates", "report_branding_configs", "staff_job_title_mappings"] },
  { domain: "School policies and academic mappings", tables: [
    "dismissal_policy_audits", "dismissal_policies", "student_academic_mapping_rules", "student_progression_mapping_rules",
    "heb_overrides", "jenjang_config",
  ] },
  { domain: "Attendance and academic configuration", tables: [
    "attendance_calendar_exceptions", "attendance_calendar_weekday_rules", "attendance_submission_deadlines",
    "academic_term_configs", "academic_assessment_sessions", "kkm_thresholds", "assessment_components",
  ] },
  { domain: "Academic classes and references", tables: [
    "academic_classes", "academic_grades", "academic_programs", "subjects", "academic_years", "jenjangs",
  ] },
];

const PLANS: Record<DataResetScope, readonly ResetGroup[]> = {
  ATTENDANCE: ATTENDANCE_PLAN,
  ACADEMIC_RESULTS: ACADEMIC_RESULTS_PLAN,
  STUDENTS: [...ATTENDANCE_PLAN, ...ACADEMIC_RESULTS_PLAN, ...STUDENT_PLAN],
  ALL_SCHOOL_DATA: [...ATTENDANCE_PLAN, ...ACADEMIC_RESULTS_PLAN, ...STUDENT_PLAN, ...SCHOOL_STRUCTURE_PLAN],
};

const PRESERVED: Record<DataResetScope, readonly string[]> = {
  ATTENDANCE: [
    "Students, student identities, and enrollments", "Academic results and school structure",
    "Attendance Calendar, submission deadlines, and lateness cutoffs", "Staff and administrator accounts, authorization, and sessions",
    "Report templates and branding", "System settings, audit log, and encrypted backups",
  ],
  ACADEMIC_RESULTS: [
    "Students, student identities, and enrollments", "Attendance, corrections, and follow-ups",
    "Academic years, terms, classes, subjects, and assessment configuration", "Staff and administrator accounts, authorization, and sessions",
    "Report templates and branding", "System settings, audit log, and encrypted backups",
  ],
  STUDENTS: [
    "Academic years, terms, Programs, Jenjang, Grades, Classes, and subjects", "Attendance Calendar and lateness configuration",
    "Assessment templates and academic mapping configuration", "Staff and administrator accounts, authorization, and sessions",
    "Report templates and branding", "System settings, audit log, and encrypted backups",
  ],
  ALL_SCHOOL_DATA: [
    "Administrator and staff login accounts, roles, authorization, and sessions", "System and security settings required to run the application",
    "Backup configuration, encrypted backups, and backup history", "Audit log and database migration metadata",
  ],
};

const CONFIRMATIONS: Record<DataResetScope, string> = {
  ATTENDANCE: "RESET ATTENDANCE",
  ACADEMIC_RESULTS: "RESET ACADEMICS",
  STUDENTS: "RESET STUDENTS",
  ALL_SCHOOL_DATA: "RESET ALL SCHOOL DATA",
};

const DELETE_GUARDS = [
  { table: "attendance_override_history", name: "trg_attendance_override_history_no_delete" },
  { table: "attendance_override_history", name: "trg_history_no_delete" },
  { table: "attendance_correction_audit", name: "trg_attendance_correction_audit_no_delete" },
  { table: "attendance_period_audit", name: "trg_attendance_period_audit_no_delete" },
  { table: "attendance_follow_up_audit", name: "trg_attendance_follow_up_audit_no_delete" },
  { table: "student_enrollment_class_history", name: "trg_student_enrollment_class_history_no_delete" },
  { table: "student_enrollment_lifecycle_audit", name: "trg_student_enrollment_lifecycle_audit_no_delete" },
  { table: "student_import_applied_actions", name: "trg_student_import_actions_no_delete" },
  { table: "student_master_change_history", name: "trg_student_master_change_history_no_delete" },
  { table: "student_progression_audit", name: "trg_student_progression_audit_no_delete" },
  { table: "early_departure_excuse_audits", name: "trg_early_departure_excuse_audits_no_delete" },
  { table: "teacher_class_assignment_audit", name: "trg_teacher_class_assignment_audit_no_delete" },
  { table: "dismissal_policy_audits", name: "trg_dismissal_policy_audits_no_delete" },
] as const;

// ponytail: process-local lock; the supported runtime is one SQLite-owning API process.
let resetInProgress = false;

function fail(set: any, status: number, code: string, message: string) {
  set.status = status;
  return { detail: { code, message } };
}

function planTables(groups: readonly ResetGroup[]): Set<string> {
  return new Set(groups.flatMap(({ tables }) => [...tables]));
}

function countPlan(client: Client, groups: readonly ResetGroup[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { domain, tables } of groups) {
    counts[domain] ??= 0;
    for (const table of tables) {
      counts[domain] += Number((client.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as Row).count);
    }
  }
  return counts;
}

function deleteTable(client: Client, table: string): number {
  if (table !== "student_import_applied_actions") return Number(client.run(`DELETE FROM ${table}`).changes);
  let deleted = 0;
  while (true) {
    const result = client.run("DELETE FROM student_import_applied_actions WHERE id IN (SELECT parent.id FROM student_import_applied_actions AS parent WHERE NOT EXISTS (SELECT 1 FROM student_import_applied_actions AS child WHERE child.parent_action_id = parent.id))");
    deleted += Number(result.changes);
    const remaining = Number((client.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as Row).count);
    if (remaining === 0) return deleted;
    if (result.changes === 0) throw new Error("Student import action dependencies could not be cleared.");
  }
}

function appendResetAudit(client: Client, user: CurrentUser, scope: DataResetScope, success: boolean, counts: Record<string, number>, failureCode: string | null, backupFilename: string | null): void {
  client.run(`INSERT INTO operations_audit_events
    (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source, success, failure_code, changed_fields, metadata, schema_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    randomUUID(), String(user.id), user.role, "destructive_data_reset", "SCHOOL_DATA", scope, "RESET",
    scope === "ALL_SCHOOL_DATA" ? "CRITICAL" : "HIGH", "SYSTEM_SETTINGS", success ? 1 : 0, failureCode,
    JSON.stringify(Object.keys(counts)), JSON.stringify({ deleted_counts: counts, backup_filename }), "1",
  ]);
}

function recordFailedReset(client: Client, user: CurrentUser, scope: DataResetScope, code: string, backupFilename: string | null): void {
  try {
    const counts = Object.fromEntries(Object.keys(countPlan(client, PLANS[scope])).map((domain) => [domain, 0]));
    appendResetAudit(client, user, scope, false, counts, code, backupFilename);
  } catch { /* keep the reset error sanitized */ }
}

function verifyIntegrity(client: Client): void {
  const integrity = String((client.query("PRAGMA integrity_check").get() as Row | null)?.integrity_check ?? "");
  const foreignKeyIssues = client.query("PRAGMA foreign_key_check").all();
  if (integrity !== "ok" || foreignKeyIssues.length) throw new Error("Database integrity validation failed.");
}

function resetData(context: AuthContext, scope: DataResetScope, user: CurrentUser, backupConfig: SafetyConfig) {
  const client = context.database.client;
  let backupFilename: string | null = null;
  try {
    backupFilename = createPreResetBackup(context, backupConfig);
  } catch {
    recordFailedReset(client, user, scope, "PRE_RESET_BACKUP_FAILED", null);
    throw Object.assign(new Error("An encrypted pre-reset backup could not be created. No reset was performed."), { status: 503, code: "PRE_RESET_BACKUP_FAILED" });
  }

  const groups = PLANS[scope];
  const tables = planTables(groups);
  const guards = DELETE_GUARDS.filter(({ table }) => tables.has(table)).flatMap(({ name, table }) => {
    const trigger = client.query("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ? AND tbl_name = ?").get(name, table) as Row | null;
    return trigger?.sql ? [{ name, sql: String(trigger.sql) }] : [];
  });
  try {
    const deletedCounts = inTransaction(client, () => {
      for (const guard of guards) client.run(`DROP TRIGGER IF EXISTS ${guard.name}`);
      const counts: Record<string, number> = {};
      for (const { domain, tables: groupTables } of groups) {
        counts[domain] ??= 0;
        for (const table of groupTables) counts[domain] += deleteTable(client, table);
      }
      for (const guard of guards) client.run(guard.sql);
      verifyIntegrity(client);
      appendResetAudit(client, user, scope, true, counts, null, backupFilename);
      return counts;
    });
    return { scope, deleted_counts: deletedCounts, completed_at: new Date().toISOString(), backup_filename: backupFilename };
  } catch {
    recordFailedReset(client, user, scope, "DATA_RESET_ROLLED_BACK", backupFilename);
    throw Object.assign(new Error("The reset failed. All database changes were rolled back."), { status: 500, code: "DATA_RESET_ROLLED_BACK" });
  }
}

export function dataResetRoutes(app: any, context: AuthContext | null, config: { destructiveOperationsEnabled: boolean; backup: SafetyConfig }): void {
  if (!context) return;
  const authorized = (ctx: Context) => actor(context, ctx, { role: "admin", capability: "destructive_data_reset", refreshSession: false });

  app.post("/api/system/data-reset/preview", (ctx: Context) => {
    const user = authorized(ctx);
    if (!user) return { detail: { code: "FORBIDDEN", message: "Administrator access is required." } };
    if (config.destructiveOperationsEnabled !== true) return fail(ctx.set, 403, "DESTRUCTIVE_OPERATIONS_DISABLED", "Destructive operations are disabled in this environment.");
    try {
      const groups = PLANS[ctx.body.scope as DataResetScope];
      return {
        scope: ctx.body.scope,
        will_delete: Object.entries(countPlan(context.database.client, groups)).map(([domain, count]) => ({ domain, count })),
        will_preserve: PRESERVED[ctx.body.scope as DataResetScope],
        encrypted_backup_required: true,
      };
    } catch {
      return fail(ctx.set, 500, "RESET_PREVIEW_FAILED", "The reset preview could not be loaded.");
    }
  }, { body: DataResetPreviewRequestSchema, response: { 200: DataResetPreviewResponseSchema } });

  app.post("/api/system/data-reset", (ctx: Context) => {
    const user = authorized(ctx);
    if (!user) return { detail: { code: "FORBIDDEN", message: "Administrator access is required." } };
    if (config.destructiveOperationsEnabled !== true) return fail(ctx.set, 403, "DESTRUCTIVE_OPERATIONS_DISABLED", "Destructive operations are disabled in this environment.");
    const scope = ctx.body.scope as DataResetScope;
    if (ctx.body.confirmation !== CONFIRMATIONS[scope]) return fail(ctx.set, 400, "RESET_CONFIRMATION_MISMATCH", "The confirmation phrase does not match the selected reset.");
    if (resetInProgress) return fail(ctx.set, 409, "RESET_IN_PROGRESS", "Another reset operation is already active.");
    resetInProgress = true;
    try {
      return resetData(context, scope, user, config.backup);
    } catch (error) {
      const value = error as { status?: number; code?: string };
      return fail(ctx.set, value.status ?? 500, value.code ?? "DATA_RESET_FAILED", error instanceof Error ? error.message : "The reset failed.");
    } finally {
      resetInProgress = false;
    }
  }, { body: DataResetCommitRequestSchema, response: { 200: DataResetResultSchema } });
}
