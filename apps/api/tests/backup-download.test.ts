import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";
import { isEncryptedBackup, parseBackupEncryptionConfig } from "../src/security/backup-crypto";
import { createAccountFixture } from "./fixtures/accounts";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const secret = "synthetic-download-cookie-secret-distinct-from-key";
const key = Buffer.alloc(32, 43).toString("base64");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "operatoros-backup-download-"));
  const databasePath = join(root, "operatoros.sqlite");
  const backupDir = join(root, "backups");
  mkdirSync(backupDir);
  createAccountFixture(databasePath, "golden-active");
  const database = openDatabase(databasePath);
  const app = createApp({ environment: "test", databaseHandle: database, backupDir, backupEncryption: parseBackupEncryptionConfig({ activeKey: key, activeKeyId: "synthetic", authCookieSecret: secret }), auth: { authCookieSecret: secret, auditDir: backupDir } });
  return { root, database, backupDir, app };
}

async function login(app: ReturnType<typeof createApp>, role = "admin"): Promise<string> {
  const response = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: `golden-${role}`, password: `golden-${role}-pass-1` }) }));
  const token = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!token) throw new Error("Synthetic session missing");
  return `astyx_session=${token}`;
}

async function createBackup(app: ReturnType<typeof createApp>, cookie: string): Promise<string> {
  const response = await app.handle(new Request("http://local/api/admin/backups", { method: "POST", headers: { cookie, origin: "http://localhost:5173" } }));
  expect(response.status).toBe(200);
  return (await response.json() as { filename: string }).filename;
}

it("downloads the encrypted artifact and metadata together for isolated CLI recovery", async () => {
  const value = fixture();
  try {
    value.database.client.run("INSERT INTO students (id,name) VALUES (7654321,'Synthetic downloaded backup student')");
    const cookie = await login(value.app);
    const filename = await createBackup(value.app, cookie);
    const url = `http://local/api/admin/backups/${filename}/download`;
    for (const suffix of ["", "?bundle=false"]) {
      const legacy = await value.app.handle(new Request(`${url}${suffix}`, { headers: { cookie } }));
      expect(legacy.status).toBe(200);
      expect(Buffer.from(await legacy.arrayBuffer()).equals(readFileSync(join(value.backupDir, filename)))).toBe(true);
    }
    const response = await value.app.handle(new Request(`${url}?bundle=true`, { headers: { cookie } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-tar");
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${filename}.tar"`);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("cache-control")).toContain("private");
    const files = await new Bun.Archive(await response.blob()).files();
    expect([...files.keys()].sort()).toEqual([filename, `${filename}.meta.json`].sort());
    const artifact = Buffer.from(await files.get(filename)!.arrayBuffer());
    const metadata = Buffer.from(await files.get(`${filename}.meta.json`)!.arrayBuffer());
    expect(isEncryptedBackup(artifact)).toBe(true);
    expect(artifact.equals(readFileSync(join(value.backupDir, filename)))).toBe(true);
    expect(metadata.equals(readFileSync(join(value.backupDir, `${filename}.meta.json`)))).toBe(true);

    const exported = join(value.root, "exported");
    const target = join(value.root, "disposable-restore");
    mkdirSync(join(exported, "backups"), { recursive: true, mode: 0o700 });
    mkdirSync(target, { mode: 0o700 });
    writeFileSync(join(exported, "backups", filename), artifact, { mode: 0o600 });
    writeFileSync(join(exported, "backups", `${filename}.meta.json`), metadata, { mode: 0o600 });
    const restored = Bun.spawnSync([process.execPath, join(repository, "apps/api/src/backup-cli.ts"), "restore-disposable", filename, target], {
      cwd: repository, stdout: "pipe", stderr: "pipe",
      env: { ...process.env, OPERATOROS_DATA_DIR: exported, DATABASE_URL: `sqlite:///${join(exported, "operatoros.sqlite")}`, BACKUP_ENCRYPTION_KEY: key, BACKUP_ENCRYPTION_KEY_ID: "synthetic", AUTH_COOKIE_SECRET: secret },
    });
    expect(restored.exitCode).toBe(0);
    const recovered = openDatabase(join(target, "operatoros.sqlite"), { readonly: true });
    try { expect(recovered.client.query("SELECT COUNT(*) AS count FROM students WHERE id=7654321").get()).toEqual({ count: 1 }); }
    finally { recovered.close(); }
  } finally { value.database.close(); rmSync(value.root, { recursive: true, force: true }); }
}, 15000);

it("keeps bundle downloads administrator-only and refuses missing or symlinked pair members", async () => {
  const value = fixture();
  try {
    const cookie = await login(value.app);
    const staffCookie = await login(value.app, "staff");
    const filename = await createBackup(value.app, cookie);
    const url = `http://local/api/admin/backups/${filename}/download?bundle=true`;
    expect((await value.app.handle(new Request(url))).status).toBe(401);
    expect((await value.app.handle(new Request(url, { headers: { cookie: staffCookie } }))).status).toBe(403);
    expect((await value.app.handle(new Request(url.replace("bundle=true", "bundle=invalid"), { headers: { cookie } }))).status).toBe(400);
    for (const name of [filename, `${filename}.meta.json`]) {
      const path = join(value.backupDir, name);
      const saved = join(value.root, "preserved-pair-member");
      const before = readFileSync(path);
      renameSync(path, saved);
      expect((await value.app.handle(new Request(url, { headers: { cookie } }))).status).toBe(404);
      symlinkSync(saved, path);
      expect((await value.app.handle(new Request(url, { headers: { cookie } }))).status).toBe(404);
      expect(readFileSync(saved).equals(before)).toBe(true);
      rmSync(path);
      renameSync(saved, path);
    }
  } finally { value.database.close(); rmSync(value.root, { recursive: true, force: true }); }
});
