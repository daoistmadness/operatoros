import { expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFreshDatabase, openDatabase } from "@operatoros/db";

const root = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const cli = join(root, "apps/api/src/backup-cli.ts");

it("backs up and restores only an explicit disposable data root", () => {
  const temporary = mkdtempSync(join(tmpdir(), "operatoros-backup-cli-test-"));
  const source = join(temporary, "source");
  const restored = join(temporary, "restored");
  mkdirSync(source);
  mkdirSync(restored);
  const databasePath = join(source, "operatoros.sqlite");
  const env = {
    ...process.env,
    OPERATOROS_DATA_DIR: source,
    DATABASE_URL: `sqlite:///${databasePath}`,
    BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    BACKUP_ENCRYPTION_KEY_ID: "synthetic-test",
    AUTH_COOKIE_SECRET: "synthetic-test-cookie-secret-distinct-from-key",
    OPERATOROS_MIGRATION_LOCKED: "1",
  };
  const command = (...args: string[]) => Bun.spawnSync([process.execPath, cli, ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  try {
    createFreshDatabase(databasePath);
    const active = openDatabase(databasePath);
    expect(command("backup").stderr.toString()).toContain("DATABASE_OPEN_HANDLE");
    active.close();
    const wal = openDatabase(databasePath);
    wal.client.exec("PRAGMA journal_mode=WAL");
    wal.close();
    writeFileSync(`${databasePath}-wal`, "");
    writeFileSync(`${databasePath}-shm`, "synthetic shared memory");
    const backup = command("backup");
    expect(backup.exitCode).toBe(0);
    expect(existsSync(`${databasePath}-wal`)).toBe(false);
    expect(existsSync(`${databasePath}-shm`)).toBe(false);
    const artifact = backup.stdout.toString().trim().replace("Encrypted backup completed: ", "");
    expect(artifact).toStartWith(join(source, "backups"));

    writeFileSync(`${databasePath}-wal`, "nonempty synthetic WAL");
    writeFileSync(`${databasePath}-shm`, "synthetic shared memory");
    expect(command("backup").stderr.toString()).toContain("DATABASE_SIDECAR_PRESENT");
    expect(existsSync(`${databasePath}-wal`)).toBe(true);
    expect(existsSync(`${databasePath}-shm`)).toBe(true);
    rmSync(`${databasePath}-wal`);
    rmSync(`${databasePath}-shm`);

    const restore = command("restore-disposable", artifact, restored);
    expect(restore.exitCode).toBe(0);
    expect(existsSync(join(restored, "operatoros.sqlite-wal"))).toBe(false);
    expect(existsSync(join(restored, "operatoros.sqlite-shm"))).toBe(false);
    const handle = openDatabase(join(restored, "operatoros.sqlite"), { readonly: true });
    handle.close();
    writeFileSync(`${databasePath}-wal`, "");
    writeFileSync(`${databasePath}-shm`, "synthetic shared memory");
    expect(command("migrate-existing", artifact, source).stdout.toString()).toContain("NOOP 20261002_s48");
    expect(existsSync(`${databasePath}-wal`)).toBe(false);
    expect(existsSync(`${databasePath}-shm`)).toBe(false);

    writeFileSync(`${databasePath}-wal`, "nonempty synthetic WAL");
    writeFileSync(`${databasePath}-shm`, "synthetic shared memory");
    expect(command("migrate-existing", artifact, source).stderr.toString()).toContain("DATABASE_SIDECAR_PRESENT");
    expect(existsSync(`${databasePath}-wal`)).toBe(true);
    rmSync(`${databasePath}-wal`);
    rmSync(`${databasePath}-shm`);

    const changed = openDatabase(databasePath);
    changed.client.run("INSERT INTO students (id,name) VALUES (1,'Synthetic Student')");
    changed.close();
    const refused = command("migrate-existing", artifact, source);
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr.toString()).toContain("BACKUP_SOURCE_MISMATCH");
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
