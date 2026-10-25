import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { BACKUP_RETENTION_LIMIT } from "../src/domains/safety";
import { parseBackupEncryptionConfig } from "../src/security/backup-crypto";
import { createAccountFixture } from "./fixtures/accounts";

const cookieValue = "astryx-test-only-cookie-secret-32-chars";
const backupKey = Buffer.alloc(32, 7).toString("base64");
const origin = "http://localhost:5173";

function harness(name: string) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), `operatoros-p416-${name}-`));
  const databasePath = join(temporaryRoot, "operatoros.sqlite");
  const backupDir = join(temporaryRoot, "backups");
  const auditDir = join(temporaryRoot, "audit");
  try {
    createAccountFixture(databasePath, "golden-active");
    const database = openDatabase(databasePath);
    try {
      const app = createApp({
        databaseHandle: database,
        destructiveOperationsEnabled: true,
        backupDir,
        backupEncryption: parseBackupEncryptionConfig({ activeKey: backupKey, activeKeyId: "test", authCookieSecret: cookieValue }),
        auth: { authCookieSecret: cookieValue, auditDir },
      });
      return {
        app,
        database,
        databasePath,
        backupDir,
        cleanup: () => {
          try { database.close(); }
          finally { rmSync(temporaryRoot, { recursive: true, force: true }); }
        },
      };
    } catch (error) {
      database.close();
      throw error;
    }
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function login(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function createBackup(app: ReturnType<typeof createApp>, cookie: string): Promise<any> {
  const response = await app.handle(new Request("http://local/api/admin/backups", { method: "POST", headers: { cookie, origin } }));
  const payload = await response.json();
  const detail = typeof payload === "object" && payload !== null && "detail" in payload && typeof payload.detail === "string" ? payload.detail : "";
  const errorCode = /^([A-Z0-9_]+):/.exec(detail)?.[1] ?? "UNSPECIFIED";
  expect(response.status, `backup response HTTP ${response.status}; code=${errorCode}`).toBe(200);
  return payload;
}

async function status(app: ReturnType<typeof createApp>, cookie: string): Promise<any> {
  const response = await app.handle(new Request("http://local/api/admin/backups/status", { headers: { cookie, origin } }));
  expect(response.status).toBe(200);
  return response.json();
}

function backupFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => /^backup_\d{4}-\d{2}-\d{2}T.*\.sqlite3$/.test(name)).sort();
}

function auditEvents(dir: string): any[] {
  if (!existsSync(`${dir}/backup_operations_audit.jsonl`)) return [];
  return readFileSync(`${dir}/backup_operations_audit.jsonl`, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

describe("backup retention eviction (P4-16)", () => {
  it("keeps the newest documented count, evicts the oldest pairs, and audits every eviction", async () => {
    const h = harness("limit");
    try {
      const cookie = await login(h.app);
      const created: string[] = [];
      for (let index = 0; index < BACKUP_RETENTION_LIMIT + 2; index++) {
        created.push(String((await createBackup(h.app, cookie)).filename));
      }

      const files = backupFiles(h.backupDir);
      expect(files).toHaveLength(BACKUP_RETENTION_LIMIT);
      const newest = String(created[created.length - 1]);
      expect(files).toContain(newest);
      const evicted = created.slice(0, 2);
      for (const filename of evicted) {
        expect(files).not.toContain(filename);
        expect(existsSync(`${h.backupDir}/${filename}.meta.json`)).toBe(false);
      }

      const payload = await status(h.app, cookie);
      expect(payload.backup_count).toBe(BACKUP_RETENTION_LIMIT);
      expect(payload.retention_limit).toBe(BACKUP_RETENTION_LIMIT);

      const evictions = auditEvents(h.backupDir).filter((event) => event.event === "backup_evicted");
      expect(evictions.map((event) => event.filename).sort()).toEqual([...evicted].sort());
      for (const event of evictions) {
        expect(event.reason).toBe("retention_limit");
        expect(event.retention_limit).toBe(BACKUP_RETENTION_LIMIT);
      }
    } finally { h.cleanup(); }
  }, 60000);

  it("keeps the only backup and does not evict at the limit", async () => {
    const h = harness("single");
    try {
      const cookie = await login(h.app);
      const only = String((await createBackup(h.app, cookie)).filename);
      expect(backupFiles(h.backupDir)).toEqual([only]);
      for (let index = 1; index < BACKUP_RETENTION_LIMIT; index++) await createBackup(h.app, cookie);
      expect(backupFiles(h.backupDir)).toHaveLength(BACKUP_RETENTION_LIMIT);
      expect(auditEvents(h.backupDir).filter((event) => event.event === "backup_evicted")).toEqual([]);
      expect((await status(h.app, cookie)).backup_count).toBe(BACKUP_RETENTION_LIMIT);
    } finally { h.cleanup(); }
  }, 60000);

  it("protects an older backup selected for restore, then evicts it once it is no longer in use", async () => {
    const h = harness("restore-source");
    try {
      let cookie = await login(h.app);
      const source = String((await createBackup(h.app, cookie)).filename);
      for (let index = 1; index < BACKUP_RETENTION_LIMIT; index++) await createBackup(h.app, cookie);
      h.database.client.run("CREATE TABLE retention_marker (value TEXT NOT NULL)");
      h.database.client.run("INSERT INTO retention_marker VALUES ('changed-after-source')");

      const preflight = await h.app.handle(new Request(`http://local/api/admin/backups/${source}/restore-preflight`, { method: "POST", headers: { cookie, origin } }));
      expect(preflight.status).toBe(200);
      const checked = await preflight.json() as any;
      const restored = await h.app.handle(new Request(`http://local/api/admin/backups/${source}/restore`, {
        method: "POST",
        headers: { cookie, origin, "content-type": "application/json" },
        body: JSON.stringify({
          current_password: "golden-admin-pass-1",
          confirmation_filename: source,
          confirmation_phrase: "RESTORE_DATABASE",
          acknowledge_complete_replacement: true,
          acknowledge_session_revocation: true,
          acknowledge_restart_required: true,
          acknowledge_safety_backup: true,
          expected_source_sha256: checked.source.sha256,
          expected_active_sha256: checked.active.active_sha256,
        }),
      }));
      expect(restored.status).toBe(200);

      // The pre-restore safety snapshot pushes the directory past the limit; the
      // restore source must survive even though it is the oldest generation.
      expect(existsSync(`${h.backupDir}/${source}`)).toBe(true);
      expect(existsSync(`${h.backupDir}/${source}.meta.json`)).toBe(true);

      cookie = await login(h.app);
      expect((await status(h.app, cookie)).backup_count).toBe(BACKUP_RETENTION_LIMIT + 1);
      await createBackup(h.app, cookie);
      expect(existsSync(`${h.backupDir}/${source}`)).toBe(false);
      expect(existsSync(`${h.backupDir}/${source}.meta.json`)).toBe(false);
      expect(backupFiles(h.backupDir)).toHaveLength(BACKUP_RETENTION_LIMIT);
    } finally { h.cleanup(); }
  }, 60000);
});
