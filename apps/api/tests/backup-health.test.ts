import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";
import { parseBackupEncryptionConfig } from "../src/security/backup-crypto";
import { createAccountFixture } from "./fixtures/accounts";

it("reports current artifact checks without claiming SQLite integrity verification", async () => {
  const root = mkdtempSync(join(tmpdir(), "operatoros-backup-health-"));
  const path = join(root, "synthetic.db");
  const backupDir = join(root, "backups");
  createAccountFixture(path, "golden-active");
  const database = openDatabase(path);
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
      return await response.json() as { health_state: string; latest_backup_size_bytes: number | null; latest_backup_checksum_status: string | null; latest_backup_integrity_status: string | null; latest_backup_outcome: string | null; backup_directory_available: boolean };
    };
    expect((await status()).health_state).toBe("NO_BACKUP");
    const created = await app.handle(new Request("http://local/api/admin/backups", { method: "POST", headers }));
    expect(created.status).toBe(200);
    const backup = await created.json() as { filename: string };
    const artifactPath = join(backupDir, backup.filename);
    const manifestPath = `${artifactPath}.meta.json`;
    const artifact = readFileSync(artifactPath);
    const manifest = readFileSync(manifestPath);
    const audit = readFileSync(join(backupDir, "backup_operations_audit.jsonl"));
    const healthy = await status();
    expect(healthy.health_state).toBe("HEALTHY");
    expect(healthy.latest_backup_size_bytes).toBe(artifact.length);
    expect(healthy.latest_backup_checksum_status).toBe("verified");
    expect(healthy.latest_backup_integrity_status).toBe("not_checked");
    expect(healthy.latest_backup_outcome).toBe(null);

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
    rmSync(backupDir, { recursive: true });
    writeFileSync(backupDir, "destination is a file");
    const unavailable = await status();
    expect(unavailable.health_state).toBe("DESTINATION_UNAVAILABLE");
    expect(unavailable.backup_directory_available).toBe(false);
    rmSync(backupDir);
    mkdirSync(backupDir);
    expect((await status()).health_state).toBe("NO_BACKUP");
  } finally { database.close(); rmSync(root, { recursive: true, force: true }); }
}, 15000);
