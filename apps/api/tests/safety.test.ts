import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { backupScheduler } from "../src/domains/safety";
import { isEncryptedBackup, parseBackupEncryptionConfig } from "../src/security/backup-crypto";
import { createAccountFixture } from "./fixtures/accounts";

const secret = "astryx-test-only-cookie-secret-32-chars";
const backupKey = Buffer.alloc(32, 7).toString("base64");

function seed(path: string): void {
  createAccountFixture(path, "golden-active");
}

async function login(app: ReturnType<typeof createApp>, username: string, password: string): Promise<string> {
  const response = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }));
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

describe("backup, restore, and scheduler safety", () => {
  it("backs up, preflights, restores, revokes sessions, and rejects corruption", async () => {
    const path = `/tmp/operatoros-phase9-safety-${process.pid}-${Date.now()}.db`;
    const backupDir = `/dev/shm/operatoros-phase9-backups-${process.pid}-${Date.now()}`;
    seed(path); mkdirSync(backupDir, { recursive: true });
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, destructiveOperationsEnabled: true, backupDir, backupEncryption: parseBackupEncryptionConfig({ activeKey: backupKey, activeKeyId: "test", authCookieSecret: secret }), auth: { authCookieSecret: secret, auditDir: backupDir } });
    try {
      const yearId = Number(database.client.run("INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2026/2027','2026-07-01','2027-06-30','active',1)").lastInsertRowid);
      const jenjangId = Number(database.client.run("INSERT INTO jenjangs (name,code,level,active) VALUES ('Backup Primary','BP','primary',1)").lastInsertRowid);
      const programId = Number(database.client.run("INSERT INTO academic_programs (jenjang_id,name,active) VALUES (?,'Backup Program',1)", [jenjangId]).lastInsertRowid);
      const gradeId = Number(database.client.run("INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (?,?,'Backup Grade',1,1)", [jenjangId, programId]).lastInsertRowid);
      const classId = Number(database.client.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?,?,'Backup Class','',1)", [yearId, gradeId]).lastInsertRowid);
      database.client.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (9001,'Backup Student','Backup Primary','Backup Class')");
      const enrollmentId = Number(database.client.run("INSERT INTO student_enrollments (student_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (9001,?, ?, ?, 'Backup Class',1,'2026-07-01','ACTIVE')", [yearId, jenjangId, classId]).lastInsertRowid);
      const classMonthId = Number(database.client.run("INSERT INTO attendance_ledger_class_months (academic_year_id,class_id,month) VALUES (?,?, '2026-08')", [yearId, classId]).lastInsertRowid);
      const revisionId = Number(database.client.run("INSERT INTO attendance_ledger_revisions (class_month_id,revision_no,entry_mode,state,created_by,created_at) VALUES (?,1,'PER_STUDENT','OPEN','backup-test',CURRENT_TIMESTAMP)", [classMonthId]).lastInsertRowid);
      database.client.run("INSERT INTO attendance_ledger_student_totals (revision_id,enrollment_id,sakit,izin,alfa) VALUES (?,?,1,0,0)", [revisionId, enrollmentId]);
      database.client.run("INSERT INTO jenjang_lateness_policy (jenjang_id,effective_from,cutoff_time,source,created_by,created_at,reason) VALUES (?,'2026-07-01','07:30','BACKFILL_ASSUMED','backup-test',CURRENT_TIMESTAMP,'Synthetic backup policy')", [jenjangId]);
      const cookie = await login(app, "golden-admin", "golden-admin-pass-1");
      const created = await app.handle(new Request("http://local/api/admin/backups", { method: "POST", headers: { cookie, origin: "http://localhost:5173" } }));
      expect(created.status).toBe(200);
      const backup = await created.json() as any;
      expect(backup.filename).toMatch(/^backup_.*\.sqlite3$/);
      expect(backup.sha256).toHaveLength(64);

      const download = await app.handle(new Request(`http://local/api/admin/backups/${backup.filename}/download`, { headers: { cookie, origin: "http://localhost:5173" } }));
      expect(download.status).toBe(200);
      expect(download.headers.get("content-type")).toBe("application/vnd.operatoros.backup+json");
      expect(download.headers.get("content-disposition")).toContain(backup.filename);
      const artifact = Buffer.from(await download.arrayBuffer());
      expect(artifact.length).toBeGreaterThan(0);
      expect(isEncryptedBackup(artifact)).toBe(true);

      const wrongKeyApp = createApp({ databaseHandle: database, destructiveOperationsEnabled: true, backupDir, backupEncryption: parseBackupEncryptionConfig({ activeKey: Buffer.alloc(32, 8).toString("base64"), activeKeyId: "test", authCookieSecret: secret }), auth: { authCookieSecret: secret, auditDir: backupDir } });
      const wrongKeyCookie = await login(wrongKeyApp, "golden-admin", "golden-admin-pass-1");
      const wrongKeyPreflight = await wrongKeyApp.handle(new Request(`http://local/api/admin/backups/${backup.filename}/restore-preflight`, { method: "POST", headers: { cookie: wrongKeyCookie, origin: "http://localhost:5173" } }));
      expect(wrongKeyPreflight.status).toBeGreaterThanOrEqual(400);

      const plaintextApp = createApp({ databaseHandle: database, destructiveOperationsEnabled: true, backupDir, backupEncryption: null, auth: { authCookieSecret: secret, auditDir: backupDir } });
      const plaintextCookie = await login(plaintextApp, "golden-admin", "golden-admin-pass-1");
      const plaintextBackup = await plaintextApp.handle(new Request("http://local/api/admin/backups", { method: "POST", headers: { cookie: plaintextCookie, origin: "http://localhost:5173" } }));
      expect(plaintextBackup.status).toBe(503);

      database.client.run("CREATE TABLE restore_marker (value TEXT NOT NULL)");
      database.client.run("INSERT INTO restore_marker VALUES ('after-backup')");
      const laterRevisionId = Number(database.client.run("INSERT INTO attendance_ledger_revisions (class_month_id,revision_no,entry_mode,state,created_by,created_at) VALUES (?,2,'PER_STUDENT','OPEN','backup-test',CURRENT_TIMESTAMP)", [classMonthId]).lastInsertRowid);
      database.client.run("INSERT INTO attendance_ledger_student_totals (revision_id,enrollment_id,sakit,izin,alfa) VALUES (?,?,2,0,0)", [laterRevisionId, enrollmentId]);
      database.client.run("INSERT INTO jenjang_lateness_policy (jenjang_id,effective_from,cutoff_time,source,created_by,created_at,reason) VALUES (?,'2099-01-01','07:45','RECORDED','backup-test',CURRENT_TIMESTAMP,'Future backup policy')", [jenjangId]);
      const preflight = await app.handle(new Request(`http://local/api/admin/backups/${backup.filename}/restore-preflight`, { method: "POST", headers: { cookie, origin: "http://localhost:5173" } }));
      expect(preflight.status).toBe(200);
      const checked = await preflight.json() as any;
      expect(checked.source.restore_eligible).toBe(true);
      const restore = await app.handle(new Request(`http://local/api/admin/backups/${backup.filename}/restore`, { method: "POST", headers: { cookie, origin: "http://localhost:5173", "content-type": "application/json" }, body: JSON.stringify({ current_password: "golden-admin-pass-1", confirmation_filename: backup.filename, confirmation_phrase: "RESTORE_DATABASE", acknowledge_complete_replacement: true, acknowledge_session_revocation: true, acknowledge_restart_required: true, acknowledge_safety_backup: true, expected_source_sha256: checked.source.sha256, expected_active_sha256: checked.active.active_sha256 }) }));
      expect(restore.status).toBe(200);
      expect((await restore.json() as any).sessions_revoked).toBe(true);
      expect(database.client.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'restore_marker'").get()).toBeNull();
      expect(database.client.query("SELECT revision_no,entry_mode,state FROM attendance_ledger_revisions WHERE class_month_id=? ORDER BY revision_no").all(classMonthId)).toEqual([{ revision_no: 1, entry_mode: "PER_STUDENT", state: "OPEN" }]);
      expect(database.client.query("SELECT sakit,izin,alfa FROM attendance_ledger_student_totals WHERE revision_id=?").get(revisionId)).toEqual({ sakit: 1, izin: 0, alfa: 0 });
      expect(database.client.query("SELECT effective_from,cutoff_time,source FROM jenjang_lateness_policy WHERE jenjang_id=?").all(jenjangId)).toEqual([{ effective_from: "2026-07-01", cutoff_time: "07:30", source: "BACKFILL_ASSUMED" }]);
      const postRestoreCookie = await login(app, "golden-admin", "golden-admin-pass-1");

      const corrupt = `${backupDir}/${backup.filename}`;
      const bytes = readFileSync(corrupt); bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1; writeFileSync(corrupt, bytes);
      const corruptPreflight = await app.handle(new Request(`http://local/api/admin/backups/${backup.filename}/restore-preflight`, { method: "POST", headers: { cookie: postRestoreCookie, origin: "http://localhost:5173" } }));
      expect(corruptPreflight.status).toBeGreaterThanOrEqual(400);
      const deleted = await app.handle(new Request(`http://local/api/admin/backups/${backup.filename}`, { method: "DELETE", headers: { cookie: postRestoreCookie, origin: "http://localhost:5173" } }));
      expect(deleted.status).toBe(200);
      expect(existsSync(corrupt)).toBe(false);
    } finally { database.close(); rmSync(path, { force: true }); rmSync(backupDir, { recursive: true, force: true }); }
  }, 30000);

  it("keeps scheduler lifecycle single-instance and clean", () => {
    const path = `/tmp/operatoros-phase9-scheduler-${process.pid}-${Date.now()}.db`;
    const backupDir = `/tmp/operatoros-phase9-scheduler-backups-${process.pid}-${Date.now()}`;
    seed(path); const database = openDatabase(path); const context = { database, config: { authCookieSecret: secret, cookieSecure: false, sessionIdleTimeoutHours: 6, sessionAbsoluteTimeoutHours: 24, maxFailedLoginAttempts: 5, accountLockMinutes: 30, managedDevSetup: false, allowedOrigins: [], auditDir: backupDir } } as any;
    try { backupScheduler.start(context, { backupDir, destructiveOperationsEnabled: false }); backupScheduler.start(context, { backupDir, destructiveOperationsEnabled: false }); expect(backupScheduler.running).toBe(true); backupScheduler.stop(); expect(backupScheduler.running).toBe(false); } finally { backupScheduler.stop(); database.close(); rmSync(path, { force: true }); rmSync(backupDir, { recursive: true, force: true }); }
  });
});
