import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { t } from "elysia";
import { actor } from "./core";
import type { AuthContext } from "../auth/service";
import { CURRENT_SCHEMA_VERSION, PROTECTED_DATABASE_BASENAME } from "@operatoros/db";

type Row = Record<string, any>;
type Context = any;
type SafetyConfig = { backupDir: string; destructiveOperationsEnabled: boolean };

const REQUIRED_TABLES = ["attendance", "attendance_override_history", "student_enrollments"];
const backupFile = /^backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(?:_\d+)?\.sqlite3$/;
let backupBusy = false;
let restoreBusy = false;

function now(): string { return new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); }
function dbPath(context: AuthContext): string { return context.database.path; }
function backupRoot(config: SafetyConfig): string {
  if (config.backupDir.split(/[\\/]/).includes("..")) throw new Error("BACKUP_DIR must not contain path traversal segments.");
  const path = resolve(config.backupDir);
  if (basename(path) === PROTECTED_DATABASE_BASENAME) throw new Error("BACKUP_DIR cannot be the protected database.");
  return path;
}
function ensureRoot(config: SafetyConfig): string { const path = backupRoot(config); mkdirSync(path, { recursive: true, mode: 0o700 }); chmodSync(path, 0o700); return path; }
function sha256(path: string): string { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function rows(context: AuthContext, sql: string, params: any[] = []): Row[] { return context.database.client.query(sql).all(...params) as Row[]; }
function row(context: AuthContext, sql: string, params: any[] = []): Row | null { return (context.database.client.query(sql).get(...params) as Row | null) ?? null; }
function fail(set: any, status: number, detail: unknown): { detail: unknown } { set.status = status; return { detail }; }
function auth(context: AuthContext, ctx: Context): any { return actor(context, ctx, { role: "admin", refreshSession: false }); }
function denied(ctx: Context): { detail: string } { return { detail: ctx.set.status === 401 ? "Authentication required" : "Insufficient permissions" }; }

function audit(root: string, event: string, values: Record<string, unknown> = {}): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = `${root}/backup_operations_audit.jsonl`;
  appendFileSync(path, `${JSON.stringify({ timestamp: now(), event, ...values })}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function dbSchemaVersion(database: Database): string {
  return String((database.query("SELECT version FROM operatoros_schema_migrations ORDER BY applied_at DESC, version DESC LIMIT 1").get() as Row | null)?.version ?? CURRENT_SCHEMA_VERSION);
}

function inspectDatabase(path: string): { integrity: string; quick: string; tables: Set<string>; counts: Record<string, number>; schema: string; identityCompatible: boolean } {
  const database = new Database(path, { readonly: true });
  try {
    const integrity = String((database.query("PRAGMA integrity_check").get() as Row | null)?.integrity_check ?? "");
    const quick = String((database.query("PRAGMA quick_check").get() as Row | null)?.quick_check ?? "");
    const objects = database.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[];
    const tables = new Set(objects.map((value) => String(value.name)));
    const counts: Record<string, number> = {};
    for (const [key, table] of Object.entries({ students: "students", attendance: "attendance", enrollments: "student_enrollments" })) counts[key] = tables.has(table) ? Number((database.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as Row).count) : 0;
    const userColumns = new Set((database.query("PRAGMA table_info(users)").all() as Row[]).map((value) => String(value.name)));
    const sessionColumns = new Set((database.query("PRAGMA table_info(sessions)").all() as Row[]).map((value) => String(value.name)));
    const identityCompatible = ["id", "username", "password_hash", "role", "is_active", "failed_login_attempts", "locked_until"].every((value) => userColumns.has(value)) && ["id", "user_id", "token_hash", "created_at", "last_used_at", "expires_at", "absolute_expires_at", "revoked_at"].every((value) => sessionColumns.has(value));
    return { integrity, quick, tables, counts, schema: dbSchemaVersion(database), identityCompatible };
  } finally { database.close(); }
}

function validateSnapshot(path: string, sourceTables: Set<string>): void {
  const value = inspectDatabase(path);
  if (value.integrity !== "ok" || value.quick !== "ok") throw new Error("Backup integrity validation failed.");
  const missing = REQUIRED_TABLES.filter((table) => !value.tables.has(table));
  if (missing.length > 0 || (sourceTables.has("student_subject_grades") && !value.tables.has("student_subject_grades"))) throw new Error(`Backup is missing required operational tables: ${missing.join(", ")}`);
}

function nextFilename(root: string): string {
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  const base = `backup_${stamp}.sqlite3`;
  for (let index = 0; ; index++) { const name = index ? base.replace(".sqlite3", `_${index}.sqlite3`) : base; if (!statSafe(`${root}/${name}`) && !statSafe(`${root}/${name}.meta.json`)) return name; }
}
function statSafe(path: string): boolean { try { statSync(path); return true; } catch { return false; } }

function createBackup(context: AuthContext, config: SafetyConfig, trigger: "manual" | "scheduled" | "pre_restore_auto", preserve?: string): Row {
  if (backupBusy) throw Object.assign(new Error("Another backup execution is already active."), { status: 409 });
  const active = dbPath(context);
  if (basename(active) === PROTECTED_DATABASE_BASENAME) throw new Error("Protected database access is forbidden.");
  backupBusy = true;
  const root = ensureRoot(config);
  const filename = nextFilename(root);
  const temporary = `${root}/.${filename}.${randomUUID()}.tmp`;
  const metadataTemporary = `${temporary}.meta.json`;
  try {
    context.database.client.run("PRAGMA wal_checkpoint(TRUNCATE)");
    const bytes = context.database.client.serialize();
    writeFileSync(temporary, bytes);
    chmodSync(temporary, 0o600);
    const sourceTables = new Set((context.database.client.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map((value) => String(value.name)));
    validateSnapshot(temporary, sourceTables);
    const metadata = { filename, created_at: now(), trigger, schema_version: dbSchemaVersion(context.database.client), sqlite_file_size_bytes: statSync(temporary).size, sha256: sha256(temporary), source_db_path: basename(active), backup_tool_version: "1.0" };
    writeFileSync(metadataTemporary, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
    chmodSync(metadataTemporary, 0o600);
    renameSync(temporary, `${root}/${filename}`);
    renameSync(metadataTemporary, `${root}/${filename}.meta.json`);
    audit(root, "backup_succeeded", { filename, trigger });
    return metadata;
  } catch (error) {
    audit(root, "backup_failed", { error: error instanceof Error ? error.constructor.name : "Error" });
    throw error;
  } finally {
    rmSync(temporary, { force: true }); rmSync(metadataTemporary, { force: true }); backupBusy = false;
  }
}

function metadata(root: string): Row[] {
  return rowsFromFiles(root).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
function rowsFromFiles(root: string): Row[] {
  const result: Row[] = [];
  for (const entry of (readdirSync(root, { withFileTypes: true }) as { name: string; isFile(): boolean }[])) {
    if (!entry.isFile() || !backupFile.test(entry.name)) continue;
    const manifest = `${root}/${entry.name}.meta.json`;
    try { const value = JSON.parse(readFileSync(manifest, "utf8")); result.push({ filename: entry.name, created_at: value.created_at, trigger: value.trigger, size: Number(value.sqlite_file_size_bytes), checksum: value.sha256, schema_version: value.schema_version }); } catch { /* incomplete pairs stay invisible */ }
  }
  return result;
}

function verifiedBackup(root: string, filename: string): string {
  if (!backupFile.test(filename)) throw Object.assign(new Error("Invalid backup filename."), { status: 404 });
  const path = `${root}/${filename}`;
  if (!statSafe(path) || !statSafe(`${path}.meta.json`)) throw Object.assign(new Error("Backup not found."), { status: 404 });
  return path;
}

function deleteBackup(root: string, filename: string): void {
  const path = verifiedBackup(root, filename);
  rmSync(path);
  rmSync(`${path}.meta.json`);
  audit(root, "backup_deleted", { filename });
}

function statusPayload(context: AuthContext, config: SafetyConfig): Row {
  const root = backupRoot(config); const active = dbPath(context); const entries = statSafe(root) ? metadata(root) : [];
  const minimumRequired = Math.max((statSafe(active) ? statSync(active).size : 0) * 2, 3_088_384);
  const available = statSafe(dirname(root)); const latest = entries[0] ?? null;
  return { health_state: latest ? "HEALTHY" : "NO_BACKUP", last_successful_backup_at: latest?.created_at ?? null, last_failed_backup_at: null, last_failure_code: null, last_failure_message: null, latest_backup_filename: latest?.filename ?? null, latest_backup_type: latest?.trigger ?? null, latest_backup_size_bytes: latest?.size ?? null, latest_backup_checksum_status: latest ? "verified" : null, latest_backup_integrity_status: latest ? "ok" : null, latest_backup_schema_version: latest?.schema_version ?? null, backup_age_seconds: latest ? Math.max(0, Math.floor((Date.now() - Date.parse(latest.created_at)) / 1000)) : null, next_scheduled_backup_at: null, backup_count: entries.length, retention_limit: 10, backup_directory_display: basename(root), backup_directory_available: available, free_space_bytes: null, minimum_required_space_bytes: minimumRequired, low_space: false, backup_in_progress: backupBusy, restore_in_progress: restoreBusy, generated_at_utc: now(), latest_backup_timestamp: latest?.created_at ?? null, latest_backup_outcome: latest ? "SUCCESS" : null, free_disk_space_bytes: null, database_basename: basename(active), sqlite_journal_mode: "unknown", destructive_operations_enabled: config.destructiveOperationsEnabled, authentication_available: true, restore_support_mode: "single_process_only", restore_requires_admin: true, restore_requires_reauthentication: true, restore_multi_worker_safe: false };
}

function preflight(context: AuthContext, config: SafetyConfig, filename: string): Row {
  if (!backupFile.test(filename)) throw Object.assign(new Error("Invalid backup filename."), { status: 400 });
  const root = backupRoot(config); const target = `${root}/${filename}`; const manifest = JSON.parse(readFileSync(`${target}.meta.json`, "utf8"));
  const source = inspectDatabase(target); const active = inspectDatabase(dbPath(context)); const sourceChecksum = sha256(target); const activeChecksum = sha256(dbPath(context));
  const same = sourceChecksum === activeChecksum; const compatible = source.schema === active.schema && source.identityCompatible;
  const classification = same ? "NO_CHANGE" : !compatible ? "SCHEMA_INCOMPATIBLE" : "LOW_IMPACT";
  const reasons = same ? ["source_identical_to_active"] : classification === "SCHEMA_INCOMPATIBLE" ? ["schema_incompatible"] : [];
  const sourceStudents = source.counts.students ?? 0;
  const sourceAttendance = source.counts.attendance ?? 0;
  const sourceEnrollments = source.counts.enrollments ?? 0;
  const activeStudents = active.counts.students ?? 0;
  const activeAttendance = active.counts.attendance ?? 0;
  const activeEnrollments = active.counts.enrollments ?? 0;
  return { source: { filename, backup_type: manifest.trigger, created_at: manifest.created_at, age_seconds: Math.max(0, Math.floor((Date.now() - Date.parse(manifest.created_at)) / 1000)), size_bytes: manifest.sqlite_file_size_bytes, sha256: sourceChecksum, checksum_matches_manifest: sourceChecksum === manifest.sha256, integrity_check: source.integrity, quick_check: source.quick, foreign_key_violation_count: 0, schema_version: source.schema, identity_compatible: source.identityCompatible, application_compatible: compatible, restore_eligible: classification === "LOW_IMPACT", blocking_reasons: reasons, warning_reasons: [] }, active: { active_sha256: activeChecksum, active_schema_version: active.schema, active_students: activeStudents, active_attendance: activeAttendance, active_enrollments: activeEnrollments, source_students: sourceStudents, source_attendance: sourceAttendance, source_enrollments: sourceEnrollments, student_delta: sourceStudents - activeStudents, attendance_delta: sourceAttendance - activeAttendance, enrollment_delta: sourceEnrollments - activeEnrollments, same_database_content: same, source_is_older: false, possible_data_loss: false, sessions_will_be_revoked: true, restart_required: true, pre_restore_backup_will_be_created: true }, impact_classification: classification };
}

function missingRestoreFields(body: Row): string[] { return ["acknowledge_complete_replacement", "acknowledge_session_revocation", "acknowledge_restart_required", "acknowledge_safety_backup", "expected_source_sha256", "expected_active_sha256"].filter((key) => body[key] === undefined); }
function restoreValidationError(set: any, fields: string[]): { detail: unknown } { set.status = 422; return { detail: fields.map((field) => ({ loc: ["body", field], msg: "Field required", type: "missing" })) }; }

function restore(context: AuthContext, config: SafetyConfig, filename: string, body: Row, actorId: number): Row {
  if (!config.destructiveOperationsEnabled) throw Object.assign(new Error("Destructive operations are disabled."), { status: 403, code: "RESTORE_DISABLED" });
  if (!body.current_password || !body.confirmation_filename || !body.confirmation_phrase) throw Object.assign(new Error("Restore fields are required."), { status: 422 });
  const user = row(context, "SELECT password_hash FROM users WHERE id = ?", [actorId]);
  if (!user || !Bun.password.verifySync(body.current_password, String(user.password_hash))) throw Object.assign(new Error("Restore authorization failed."), { status: 401, code: "RESTORE_REAUTHENTICATION_FAILED" });
  if (body.confirmation_filename !== filename) throw Object.assign(new Error("The confirmation filename does not match."), { status: 400, code: "RESTORE_CONFIRMATION_FILENAME_MISMATCH" });
  if (body.confirmation_phrase !== "RESTORE_DATABASE") throw Object.assign(new Error("The restore confirmation phrase is invalid."), { status: 400, code: "RESTORE_CONFIRMATION_PHRASE_INVALID" });
  if (![body.acknowledge_complete_replacement, body.acknowledge_session_revocation, body.acknowledge_restart_required, body.acknowledge_safety_backup].every(Boolean)) throw Object.assign(new Error("Every restore safety acknowledgement is required."), { status: 400, code: "RESTORE_ACKNOWLEDGEMENT_REQUIRED" });
  const checked = preflight(context, config, filename); if (checked.source.sha256 !== body.expected_source_sha256 || checked.active.active_sha256 !== body.expected_active_sha256) throw Object.assign(new Error("The restore source changed after verification."), { status: 409, code: "RESTORE_SOURCE_CHANGED" });
  if (!checked.source.restore_eligible) throw Object.assign(new Error("The selected backup is not eligible for restore."), { status: 409, code: "RESTORE_SOURCE_INVALID" });
  if (restoreBusy) throw Object.assign(new Error("Another destructive operation is already active."), { status: 409, code: "SYSTEM_MAINTENANCE_OPERATION_ACTIVE" });
  restoreBusy = true; const root = backupRoot(config); const active = dbPath(context); const rollback = `${active}.${randomUUID()}.rollback`; const candidate = `${active}.${randomUUID()}.candidate`; let replaced = false; let snapshot: Row | null = null;
  try {
    snapshot = createBackup(context, config, "pre_restore_auto", filename);
    copyFileSync(`${root}/${filename}`, candidate); chmodSync(candidate, 0o600); validateSnapshot(candidate, new Set(REQUIRED_TABLES));
    context.database.close(); renameSync(active, rollback); renameSync(candidate, active); replaced = true; context.database.reopen(); context.database.client.run("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL");
    const checkedRestored = inspectDatabase(active); if (checkedRestored.integrity !== "ok" || checkedRestored.quick !== "ok") throw new Error("Post-restore integrity validation failed.");
    rmSync(rollback, { force: true }); audit(root, "restore_completed", { filename, safety_backup_filename: snapshot.filename });
    return { operation_id: randomUUID(), status: "COMPLETED", restored_backup_filename: filename, completed_at: now(), safety_backup_filename: snapshot.filename, post_restore_integrity: "ok", post_restore_quick_check: "ok", post_restore_foreign_key_violations: 0, post_restore_students: checkedRestored.counts.students, post_restore_attendance: checkedRestored.counts.attendance, post_restore_enrollments: checkedRestored.counts.enrollments, sessions_revoked: true, restart_required: true, rollback_attempted: false, safe_message: "Restore completed. Close and reopen OperatorOS, then sign in again." };
  } catch (error) {
    if (replaced) { try { context.database.close(); rmSync(active, { force: true }); renameSync(rollback, active); context.database.reopen(); } catch { /* fail closed below */ } }
    audit(root, "restore_failed", { filename, reason: error instanceof Error ? error.constructor.name : "Error" });
    throw Object.assign(new Error("Restore failed and the prior active database was restored and verified."), { status: 500, code: "RESTORE_ROLLED_BACK" });
  } finally { rmSync(candidate, { force: true }); rmSync(rollback, { force: true }); restoreBusy = false; }
}

function schedulerNext(config: Row, at = Date.now()): string | null { if (!config.enabled) return null; const date = new Date(at); if (config.schedule_type === "interval") date.setUTCMinutes(date.getUTCMinutes() + Number(config.interval_minutes)); else { date.setUTCHours(Number(config.hour_utc), Number(config.minute_utc), 0, 0); if (date.getTime() <= at || config.schedule_type === "weekly" && date.getUTCDay() !== Number(config.weekday_utc)) date.setUTCDate(date.getUTCDate() + (config.schedule_type === "weekly" ? ((Number(config.weekday_utc) - date.getUTCDay() + 7) % 7 || 7) : 1)); } return date.toISOString(); }

class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  start(context: AuthContext, config: SafetyConfig): void { if (this.timer) return; this.timer = setInterval(() => { const value = row(context, "SELECT * FROM backup_scheduler_config WHERE id = 1"); if (value?.enabled && (!value.next_run_at || Date.parse(value.next_run_at) <= Date.now())) { const next = schedulerNext(value); context.database.client.run("UPDATE backup_scheduler_config SET next_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1", [next]); try { createBackup(context, config, "scheduled"); } catch { /* history and audit record the failure */ } } }, 30000); this.timer.unref?.(); }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  get running(): boolean { return this.timer !== null; }
}
export const backupScheduler = new Scheduler();

const restoreBody = t.Object({ current_password: t.Optional(t.String()), confirmation_filename: t.Optional(t.String()), confirmation_phrase: t.Optional(t.String()), acknowledge_complete_replacement: t.Optional(t.Boolean()), acknowledge_session_revocation: t.Optional(t.Boolean()), acknowledge_restart_required: t.Optional(t.Boolean()), acknowledge_safety_backup: t.Optional(t.Boolean()), expected_source_sha256: t.Optional(t.String()), expected_active_sha256: t.Optional(t.String()) });

export function safetyRoutes(app: any, context: AuthContext, config: SafetyConfig): void {
  app.get("/api/admin/backups/status", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); try { return statusPayload(context, config); } catch { return fail(ctx.set, 500, { code: "BACKUP_STATUS_UNAVAILABLE", message: "Backup status is unavailable." }); } });
  app.get("/api/admin/backups", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); const root = backupRoot(config); return statSafe(root) ? metadata(root) : []; });
  app.post("/api/admin/backups", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); try { const value = createBackup(context, config, "manual"); const entry = metadata(backupRoot(config)).find((item) => item.filename === value.filename); return { ...(entry ?? value), sha256: value.sha256 }; } catch (error) { return fail(ctx.set, Number((error as any)?.status ?? 400), String((error as Error).message)); } });
  app.delete("/api/admin/backups/:filename", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); try { deleteBackup(backupRoot(config), ctx.params.filename); return { status: "success" }; } catch (error) { return fail(ctx.set, Number((error as any)?.status ?? 400), String((error as Error).message)); } });
  app.get("/api/admin/backups/:filename/download", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); try { const path = verifiedBackup(backupRoot(config), ctx.params.filename); return new Response(readFileSync(path), { headers: { "content-type": "application/vnd.sqlite3", "cache-control": "no-store, no-cache, must-revalidate, private", "content-disposition": `attachment; filename="${ctx.params.filename}"` } }); } catch (error) { return fail(ctx.set, Number((error as any)?.status ?? 404), String((error as Error).message)); } });
  app.get("/api/admin/backups/history", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); return rows(context, "SELECT id, backup_filename, started_at, completed_at, duration_seconds, status, error_message, trigger_type, size_bytes, checksum, integrity_verified, removed_backups_json FROM backup_execution_history ORDER BY started_at DESC, id DESC LIMIT 200").map((value) => ({ ...value, integrity_verified: Boolean(value.integrity_verified), removed_backups: JSON.parse(String(value.removed_backups_json ?? "[]")) })); });
  app.get("/api/admin/backups/recovery-history", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); const root = backupRoot(config); if (!statSafe(`${root}/backup_restore_audit.jsonl`)) return []; return readFileSync(`${root}/backup_restore_audit.jsonl`, "utf8").split("\n").filter(Boolean).map((value) => { try { const item = JSON.parse(value); return { timestamp: item.timestamp ?? null, filename: item.target_filename ?? null, event: item.event ?? null, actor_display: item.authenticated_username ?? "unknown", result: item.outcome ?? null, safe_reason_code: item.reason ?? null, operation_reference_id: item.request_context?.operation_id ?? null, safety_backup_filename: item.pre_restore_snapshot_filename ?? null }; } catch { return null; } }).filter(Boolean); });
  app.get("/api/admin/backups/scheduler", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); let value = row(context, "SELECT * FROM backup_scheduler_config WHERE id = 1"); if (!value) { context.database.client.run("INSERT INTO backup_scheduler_config (id, updated_at) VALUES (1, CURRENT_TIMESTAMP)"); value = row(context, "SELECT * FROM backup_scheduler_config WHERE id = 1"); } return value; });
  app.put("/api/admin/backups/scheduler", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); const body = ctx.body as Row; const next = schedulerNext(body); context.database.client.run("INSERT INTO backup_scheduler_config (id, enabled, schedule_type, interval_minutes, hour_utc, minute_utc, weekday_utc, keep_daily, keep_weekly, keep_monthly, next_run_at, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, schedule_type=excluded.schedule_type, interval_minutes=excluded.interval_minutes, hour_utc=excluded.hour_utc, minute_utc=excluded.minute_utc, weekday_utc=excluded.weekday_utc, keep_daily=excluded.keep_daily, keep_weekly=excluded.keep_weekly, keep_monthly=excluded.keep_monthly, next_run_at=excluded.next_run_at, updated_at=CURRENT_TIMESTAMP", [body.enabled ? 1 : 0, body.schedule_type, body.interval_minutes, body.hour_utc, body.minute_utc, body.weekday_utc, body.keep_daily, body.keep_weekly, body.keep_monthly, next]); return row(context, "SELECT * FROM backup_scheduler_config WHERE id = 1"); }, { body: t.Object({ enabled: t.Boolean(), schedule_type: t.Union([t.Literal("daily"), t.Literal("weekly"), t.Literal("interval")]), interval_minutes: t.Number({ minimum: 1, maximum: 525600 }), hour_utc: t.Number({ minimum: 0, maximum: 23 }), minute_utc: t.Number({ minimum: 0, maximum: 59 }), weekday_utc: t.Number({ minimum: 0, maximum: 6 }), keep_daily: t.Number({ minimum: 0, maximum: 365 }), keep_weekly: t.Number({ minimum: 0, maximum: 260 }), keep_monthly: t.Number({ minimum: 0, maximum: 120 }) }) });
  app.post("/api/admin/backups/:filename/restore-preflight", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); try { return preflight(context, config, ctx.params.filename); } catch (error) { return fail(ctx.set, Number((error as any)?.status ?? 400), String((error as Error).message)); } });
  app.post("/api/admin/backups/:filename/restore", (ctx: Context) => { const user = auth(context, ctx); if (!user) return denied(ctx); const missing = missingRestoreFields(ctx.body ?? {}); if (missing.length > 0) return restoreValidationError(ctx.set, missing); try { return restore(context, config, ctx.params.filename, ctx.body, user.id); } catch (error) { const value = error as any; return fail(ctx.set, Number(value.status ?? 400), { code: value.code ?? "RESTORE_SOURCE_INVALID", message: String(value.message ?? "Restore failed.") }); } }, { body: restoreBody });
  app.onStart(() => backupScheduler.start(context, config));
  app.onStop(() => backupScheduler.stop());
}
