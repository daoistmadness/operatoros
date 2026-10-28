import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, rmSync, statfsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { BACKUP_DISK_SPACE_PROBE_FAILED, BACKUP_LOW_DISK_SPACE, minimumRequiredSpaceBytes, type DiskSpaceProbe } from "../src/domains/safety";
import { parseBackupEncryptionConfig } from "../src/security/backup-crypto";
import { createAccountFixture } from "./fixtures/accounts";

const cookieValue = "astryx-test-only-cookie-secret-32-chars";
const backupKey = Buffer.alloc(32, 7).toString("base64");
const origin = "http://localhost:5173";

type ProbeFactory = (paths: { databasePath: string; backupDir: string }) => DiskSpaceProbe;

function harness(name: string, probe?: ProbeFactory) {
  const stamp = `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const databasePath = `/tmp/operatoros-p302-${name}-${stamp}.db`;
  const backupDir = `/tmp/operatoros-p302-${name}-backups-${stamp}`;
  const auditDir = `/tmp/operatoros-p302-${name}-audit-${stamp}`;
  createAccountFixture(databasePath, "golden-active");
  const database = openDatabase(databasePath);
  const app = createApp({
    databaseHandle: database,
    destructiveOperationsEnabled: false,
    backupDir,
    backupEncryption: parseBackupEncryptionConfig({ activeKey: backupKey, activeKeyId: "test", authCookieSecret: cookieValue }),
    auth: { authCookieSecret: cookieValue, auditDir },
    diskSpaceProbe: probe ? probe({ databasePath, backupDir }) : null,
  });
  return {
    app,
    database,
    databasePath,
    backupDir,
    cleanup: () => {
      database.close();
      rmSync(databasePath, { force: true });
      rmSync(backupDir, { recursive: true, force: true });
      rmSync(auditDir, { recursive: true, force: true });
    },
  };
}

async function login(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", ["password"]: "golden-admin-pass-1" }) }));
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

function backupArtifacts(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => /^backup_\d{4}-\d{2}-\d{2}T/.test(name) || name.startsWith(".operatoros-backup-"));
}

async function createBackupRequest(app: ReturnType<typeof createApp>, cookie: string): Promise<Response> {
  return app.handle(new Request("http://local/api/admin/backups", { method: "POST", headers: { cookie, origin } }));
}

async function statusRequest(app: ReturnType<typeof createApp>, cookie: string): Promise<Response> {
  return app.handle(new Request("http://local/api/admin/backups/status", { headers: { cookie, origin } }));
}

describe("backup disk-space preflight (P3-02)", () => {
  it("includes plaintext and base64-envelope space in its minimum", () => {
    const h = harness("minimum-estimate");
    try {
      const size = statSync(h.databasePath).size;
      const required = minimumRequiredSpaceBytes(h.databasePath);
      expect(required).toBeGreaterThanOrEqual(size + Math.ceil(size / 3) * 4);
      expect(required).toBeGreaterThan(size * 2);
    } finally { h.cleanup(); }
  });

  it("refuses the backup with the documented code below the minimum, leaving no artifacts", async () => {
    const h = harness("low", ({ databasePath }) => () => ({ availableBytes: minimumRequiredSpaceBytes(databasePath) - 1, freeBytes: 4096 }));
    try {
      const cookie = await login(h.app);
      const response = await createBackupRequest(h.app, cookie);
      expect(response.status).toBe(507);
      const body = await response.json() as any;
      expect(typeof body.detail).toBe("string");
      expect(String(body.detail).startsWith(BACKUP_LOW_DISK_SPACE)).toBe(true);
      expect(String(body.detail)).toContain("bytes required");
      expect(existsSync(h.backupDir)).toBe(false);
      expect(backupArtifacts(h.backupDir)).toEqual([]);
    } finally { h.cleanup(); }
  }, 15000);

  it("proceeds exactly at the threshold and preserves manifest integrity", async () => {
    const h = harness("boundary", ({ databasePath }) => () => ({ availableBytes: minimumRequiredSpaceBytes(databasePath), freeBytes: minimumRequiredSpaceBytes(databasePath) + 4096 }));
    try {
      const cookie = await login(h.app);
      const response = await createBackupRequest(h.app, cookie);
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(String(body.filename)).toMatch(/^backup_.*\.sqlite3$/);
      expect(String(body.sha256)).toHaveLength(64);
      expect(body.encrypted).toBe(true);
      const manifest = JSON.parse(String(await Bun.file(`${h.backupDir}/${body.filename}.meta.json`).text())) as any;
      expect(manifest.sha256).toBe(body.sha256);
      expect(manifest.encrypted).toBe(true);
      expect(backupArtifacts(h.backupDir).sort()).toEqual([String(body.filename), `${body.filename}.meta.json`].sort());
      expect(existsSync(`${h.backupDir}/backup_operations_audit.jsonl`)).toBe(true);
    } finally { h.cleanup(); }
  }, 15000);

  it("fails closed when the filesystem-capacity probe fails", async () => {
    const h = harness("probe-failure", () => () => { throw new Error("synthetic probe failure"); });
    try {
      const cookie = await login(h.app);
      const response = await createBackupRequest(h.app, cookie);
      expect(response.status).toBe(503);
      const body = await response.json() as any;
      expect(typeof body.detail).toBe("string");
      expect(String(body.detail).startsWith(BACKUP_DISK_SPACE_PROBE_FAILED)).toBe(true);
      expect(existsSync(h.backupDir)).toBe(false);
      expect(backupArtifacts(h.backupDir)).toEqual([]);
    } finally { h.cleanup(); }
  }, 15000);

  it("reports real filesystem values and low_space=false when space is sufficient", async () => {
    const h = harness("status-real");
    try {
      const cookie = await login(h.app);
      const response = await statusRequest(h.app, cookie);
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      const stats = statfsSync(dirname(h.backupDir));
      expect(Number.isInteger(body.free_space_bytes)).toBe(true);
      expect(body.free_space_bytes).toBeGreaterThan(0);
      expect(body.free_space_bytes).toBeLessThanOrEqual(stats.bsize * stats.blocks);
      expect(body.free_disk_space_bytes).toBeGreaterThanOrEqual(body.free_space_bytes);
      expect(body.low_space).toBe(false);
      expect(body.minimum_required_space_bytes).toBe(minimumRequiredSpaceBytes(h.databasePath));
      expect(Object.keys(body)).toEqual(expect.arrayContaining(["free_space_bytes", "free_disk_space_bytes", "low_space", "minimum_required_space_bytes", "backup_count", "health_state"]));
    } finally { h.cleanup(); }
  }, 15000);

  it("reports low_space=true with exact probe values one byte below the minimum", async () => {
    const h = harness("status-low", ({ databasePath }) => () => ({ availableBytes: minimumRequiredSpaceBytes(databasePath) - 1, freeBytes: 123_456_789 }));
    try {
      const cookie = await login(h.app);
      const expected = minimumRequiredSpaceBytes(h.databasePath) - 1;
      const response = await statusRequest(h.app, cookie);
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.free_space_bytes).toBe(expected);
      expect(body.free_disk_space_bytes).toBe(123_456_789);
      expect(body.low_space).toBe(true);
    } finally { h.cleanup(); }
  }, 15000);

  it("reports low_space=false exactly at the minimum (documented boundary)", async () => {
    const h = harness("status-high", ({ databasePath }) => () => ({ availableBytes: minimumRequiredSpaceBytes(databasePath), freeBytes: minimumRequiredSpaceBytes(databasePath) + 4096 }));
    try {
      const cookie = await login(h.app);
      const expected = minimumRequiredSpaceBytes(h.databasePath);
      const response = await statusRequest(h.app, cookie);
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.free_space_bytes).toBe(expected);
      expect(body.free_disk_space_bytes).toBe(expected + 4096);
      expect(body.low_space).toBe(false);
    } finally { h.cleanup(); }
  }, 15000);

  it("represents a failed probe conservatively instead of reporting healthy status", async () => {
    const h = harness("status-probe-failure", () => () => { throw new Error("synthetic probe failure"); });
    try {
      const cookie = await login(h.app);
      const response = await statusRequest(h.app, cookie);
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.free_space_bytes).toBe(null);
      expect(body.free_disk_space_bytes).toBe(null);
      expect(body.low_space).toBe(true);
      expect(body.health_state).toBe("NO_BACKUP");
      expect(body.backup_count).toBe(0);
    } finally { h.cleanup(); }
  }, 15000);
});
