import { expect, it } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURRENT_SCHEMA_VERSION, SCHEMA_MIGRATIONS, openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";
import { parseBackupEncryptionConfig } from "../src/security/backup-crypto";
import { createAccountFixture } from "./fixtures/accounts";

it("reports current artifact checks without claiming SQLite integrity verification", async () => {
  const root = mkdtempSync(join(tmpdir(), "operatoros-backup-health-"));
  const path = join(root, "synthetic.db");
  const backupDir = join(root, "backups");
  createAccountFixture(path, "golden-active");
  const database = openDatabase(path);
  const previousMigration = SCHEMA_MIGRATIONS[SCHEMA_MIGRATIONS.length - 2]!;
  database.client.query("INSERT OR IGNORE INTO operatoros_schema_migrations (version, predecessor, schema_fingerprint, protected_fingerprints, approved_by, applied_at) VALUES (?, NULL, ?, '{}', ?, ?)").run(previousMigration, "synthetic-history", "synthetic-test", "2099-01-01T00:00:00Z");
  database.client.query("UPDATE operatoros_schema_migrations SET applied_at = ? WHERE version = ?").run("2000-01-01T00:00:00Z", CURRENT_SCHEMA_VERSION);
  let capacity: "enough" | "low" | "failed" = "enough";
  const secret = "astryx-test-only-cookie-secret-32-chars";
  const app = createApp({ databaseHandle: database, backupDir, destructiveOperationsEnabled: false,
    backupEncryption: parseBackupEncryptionConfig({ activeKey: Buffer.alloc(32, 7).toString("base64"), activeKeyId: "test", authCookieSecret: secret }),
    auth: { authCookieSecret: secret, auditDir: join(root, "audit") },
    diskSpaceProbe: () => { if (capacity === "failed") throw new Error("synthetic probe failure"); return { availableBytes: capacity === "low" ? 0 : 1e12, freeBytes: 1e12 }; },
  });
  try {
    const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
    const cookie = `astyx_session=${login.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1]}`;
    const headers = { cookie, origin: "http://localhost:5173" };
    const status = async () => {
      const response = await app.handle(new Request("http://local/api/admin/backups/status", { headers }));
      expect(response.status).toBe(200);
      return await response.json() as { health_state: string; latest_backup_size_bytes: number | null; latest_backup_checksum_status: string | null; latest_backup_integrity_status: string | null; latest_backup_outcome: string | null; last_successful_backup_at: string | null; last_failed_backup_at: string | null; last_failure_code: string | null; backup_directory_available: boolean };
    };
    expect((await status()).health_state).toBe("NO_BACKUP");
    const created = await app.handle(new Request("http://local/api/admin/backups", { method: "POST", headers }));
    expect(created.status).toBe(200);
    const backup = await created.json() as { filename: string; schema_version: string };
    expect(backup.schema_version).toBe(CURRENT_SCHEMA_VERSION);
    const artifactPath = join(backupDir, backup.filename);
    const manifestPath = `${artifactPath}.meta.json`;
    const artifact = readFileSync(artifactPath);
    const manifest = readFileSync(manifestPath);
    const auditPath = join(backupDir, "backup_operations_audit.jsonl");
    const audit = readFileSync(auditPath);
    const healthy = await status();
    expect(healthy.health_state).toBe("HEALTHY");
    expect(healthy.latest_backup_size_bytes).toBe(artifact.length);
    expect(healthy.latest_backup_checksum_status).toBe("verified");
    expect(healthy.latest_backup_integrity_status).toBe("not_checked");
    expect(healthy.latest_backup_outcome).toBe("SUCCESS");
    expect(healthy.last_successful_backup_at).not.toBeNull();

    for (const partialRecord of [
      `${JSON.stringify({ timestamp: "2026-01-02T00:00:00Z", event: "backup_failed", failure_code: "synthetic" })}`,
      `${JSON.stringify({ timestamp: "2026-01-02T00:00:00Z", event: "backup_failed" }).slice(0, -2)}\n`,
    ]) {
      writeFileSync(auditPath, Buffer.concat([audit, Buffer.from(partialRecord)]));
      const incompleteHistory = await status();
      expect(incompleteHistory.latest_backup_outcome).toBeNull();
      expect(incompleteHistory.last_successful_backup_at).toBeNull();
      expect(incompleteHistory.last_failed_backup_at).toBeNull();
      expect(incompleteHistory.health_state).toBe("HEALTHY");
    }
    writeFileSync(auditPath, audit);

    rmSync(auditPath);
    const unavailableHistory = await status();
    expect(unavailableHistory.latest_backup_outcome).toBeNull();
    expect(unavailableHistory.last_successful_backup_at).toBeNull();
    writeFileSync(auditPath, audit);

    for (const damaged of [Buffer.alloc(0), artifact.subarray(0, artifact.length - 1), Buffer.from(artifact)]) {
      if (damaged.length === artifact.length) damaged[damaged.length - 5] = damaged[damaged.length - 5]! ^ 1;
      writeFileSync(artifactPath, damaged);
      const result = await status();
      expect(result.health_state).toBe("UNKNOWN");
      expect(result.latest_backup_size_bytes).toBe(damaged.length);
      expect(result.latest_backup_checksum_status).not.toBe("verified");
      expect(result.latest_backup_integrity_status).toBe("not_checked");
    }
    writeFileSync(artifactPath, artifact);
    writeFileSync(manifestPath, JSON.stringify({ ...JSON.parse(manifest.toString()), key_id: "inconsistent" }));
    expect((await status()).health_state).toBe("UNKNOWN");
    writeFileSync(manifestPath, JSON.stringify({ ...JSON.parse(manifest.toString()), trigger: "unsupported" }));
    expect((await status()).health_state).toBe("UNKNOWN");
    writeFileSync(manifestPath, manifest);
    writeFileSync(manifestPath, JSON.stringify({ ...JSON.parse(manifest.toString()), backup_file_size_bytes: String(artifact.length) }));
    expect((await status()).health_state).toBe("UNKNOWN");
    const invalidSizeList = await app.handle(new Request("http://local/api/admin/backups", { headers }));
    expect((await invalidSizeList.json() as Array<{ filename: string }>).some((entry) => entry.filename === backup.filename)).toBe(false);
    writeFileSync(manifestPath, manifest);
    capacity = "low";
    expect((await status()).health_state).toBe("LOW_DISK_SPACE");
    writeFileSync(artifactPath, "truncated");
    expect((await status()).health_state).toBe("UNKNOWN");
    writeFileSync(artifactPath, artifact);
    capacity = "failed";
    expect((await status()).health_state).toBe("UNKNOWN");
    capacity = "enough";
    rmSync(artifactPath);
    expect((await status()).health_state).toBe("UNKNOWN");
    writeFileSync(artifactPath, artifact);
    rmSync(manifestPath);
    expect((await status()).health_state).toBe("UNKNOWN");
    writeFileSync(manifestPath, "invalid json");
    expect((await status()).health_state).toBe("UNKNOWN");
    writeFileSync(manifestPath, manifest);
    expect(readFileSync(join(backupDir, "backup_operations_audit.jsonl"))).toEqual(audit);

    const historyResponse = await app.handle(new Request("http://local/api/admin/backups/history", { headers }));
    expect(historyResponse.status).toBe(200);
    expect(await historyResponse.json()).toMatchObject([{ backup_filename: backup.filename, status: "SUCCESS", integrity_verified: true, checksum: expect.any(String) }]);
    appendFileSync(join(backupDir, "backup_operations_audit.jsonl"), `${JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", event: "backup_succeeded", filename: backup.filename, trigger: "manual" })}\n`);
    const legacyHistory = await app.handle(new Request("http://local/api/admin/backups/history", { headers }));
    expect((await legacyHistory.json() as any[])[0]?.integrity_verified).toBe(null);

    capacity = "low";
    const failedBackup = await app.handle(new Request("http://local/api/admin/backups", { method: "POST", headers }));
    expect(failedBackup.status).toBe(507);
    capacity = "enough";
    const failedHealth = await status();
    expect(failedHealth.health_state).toBe("LAST_BACKUP_FAILED");
    expect(failedHealth.latest_backup_outcome).toBe("FAILED");
    expect(failedHealth.last_failed_backup_at).not.toBeNull();
    expect(failedHealth.last_failure_code).toBe("BACKUP_LOW_DISK_SPACE");
    const failedHistory = await app.handle(new Request("http://local/api/admin/backups/history", { headers }));
    expect((await failedHistory.json() as any[]).slice(0, 2).map((entry) => entry.status)).toEqual(["FAILED", "SUCCESS"]);

    const recoveredBackup = await app.handle(new Request("http://local/api/admin/backups", { method: "POST", headers }));
    expect(recoveredBackup.status).toBe(200);
    expect((await status()).health_state).toBe("HEALTHY");
    expect((await status()).latest_backup_outcome).toBe("SUCCESS");

    rmSync(backupDir, { recursive: true });
    writeFileSync(backupDir, "destination is a file");
    const unavailable = await status();
    expect(unavailable.health_state).toBe("DESTINATION_UNAVAILABLE");
    expect(unavailable.backup_directory_available).toBe(false);
    rmSync(backupDir);
    mkdirSync(backupDir);
    expect((await status()).health_state).toBe("NO_BACKUP");

    database.client.run("PRAGMA foreign_keys = OFF");
    database.client.run("INSERT INTO sessions (user_id, token_hash, expires_at, absolute_expires_at) VALUES (404, 'synthetic-orphan-session', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
    const invalidSource = await app.handle(new Request("http://local/api/admin/backups", { method: "POST", headers }));
    expect(invalidSource.status).toBeGreaterThanOrEqual(400);
    expect(readdirSync(backupDir).filter((name) => /^backup_.*\.sqlite3$/.test(name))).toHaveLength(0);

    const singleEvent = JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", event: "backup_succeeded", trigger: "synthetic_single" });
    writeFileSync(auditPath, `\n${singleEvent}\n`);
    const singleHistory = await app.handle(new Request("http://local/api/admin/backups/history", { headers }));
    expect(singleHistory.status).toBe(200);
    expect((await singleHistory.json() as Array<{ trigger_type: string }>)[0]?.trigger_type).toBe("SYNTHETIC_SINGLE");

    const syntheticEvents = Array.from({ length: 1000 }, (_, index) => JSON.stringify({
      timestamp: new Date(1_700_000_000_000 + index * 1000).toISOString(),
      event: index % 2 === 0 ? "backup_succeeded" : "backup_failed",
      trigger: `synthetic_${index}`,
      failure_code: `synthetic_${index}`,
    }));
    writeFileSync(auditPath, `${syntheticEvents.join("\n")}\npartial record`);
    const recentHistory = await app.handle(new Request("http://local/api/admin/backups/history", { headers }));
    expect(recentHistory.status).toBe(200);
    const history = await recentHistory.json() as Array<{ id: number; trigger_type: string }>;
    expect(history).toHaveLength(200);
    expect(history[0]?.trigger_type).toBe("SYNTHETIC_999");
    expect(history.at(-1)?.trigger_type).toBe("SYNTHETIC_800");
    expect(new Set(history.map((entry) => entry.id)).size).toBe(200);

    const oversizedEvent = JSON.stringify({ timestamp: "2026-01-02T00:00:00Z", event: "backup_failed", trigger: "SYNTHETIC_OVERSIZED", padding: "x".repeat(1024 * 1024) });
    writeFileSync(auditPath, `${singleEvent}\n${oversizedEvent}\n`);
    const boundedHistory = await app.handle(new Request("http://local/api/admin/backups/history", { headers }));
    expect(boundedHistory.status).toBe(200);
    expect((await boundedHistory.json() as Array<{ trigger_type: string }>).map((entry) => entry.trigger_type)).toEqual(["SYNTHETIC_SINGLE"]);
  } finally { database.close(); rmSync(root, { recursive: true, force: true }); }
}, 15000);
