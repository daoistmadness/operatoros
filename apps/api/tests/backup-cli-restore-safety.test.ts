import { expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { CURRENT_SCHEMA_VERSION, createFreshDatabase, openDatabase } from "@operatoros/db";

const root = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const cli = join(root, "apps/api/src/backup-cli.ts");
const artifactPattern = /^backup_.*\.sqlite3$/;

it("creates a pre-restore safety snapshot with an audit line and preserves the original database on failure", () => {
  const temporary = mkdtempSync(join(tmpdir(), "operatoros-backup-restore-safety-"));
  const source = join(temporary, "source");
  mkdirSync(source);
  const databasePath = join(source, "operatoros.sqlite");
  const backupDir = join(source, "backups");
  const env = {
    ...process.env,
    OPERATOROS_DATA_DIR: source,
    DATABASE_URL: `sqlite:///${databasePath}`,
    BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    BACKUP_ENCRYPTION_KEY_ID: "synthetic-test",
    AUTH_COOKIE_SECRET: "synthetic-test-cookie-secret-distinct-from-key",
  };
  const command = (...args: string[]) => Bun.spawnSync([process.execPath, cli, ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  try {
    createFreshDatabase(databasePath);
    const backup = command("backup");
    expect(backup.exitCode).toBe(0);
    const artifact = backup.stdout.toString().trim().replace("Encrypted backup completed: ", "");
    const label = basename(artifact);

    const marked = openDatabase(databasePath);
    marked.client.run("INSERT INTO students (id, name) VALUES (424242, 'Withdrawn Student')");
    marked.close();

    const restore = command("restore", label);
    expect(restore.exitCode).toBe(0);
    expect(restore.stdout.toString()).toContain("Pre-restore safety snapshot: ");
    expect(restore.stdout.toString()).toContain(`SQLite restore completed: ${databasePath}`);

    const restored = openDatabase(databasePath, { readonly: true });
    expect(restored.client.query("SELECT COUNT(*) AS count FROM students WHERE id = 424242").get()).toEqual({ count: 0 });
    restored.close();

    const artifacts = readdirSync(backupDir).filter((name) => artifactPattern.test(name)).sort();
    expect(artifacts).toHaveLength(2);
    const safety = artifacts.find((name) => name !== label);
    if (!safety) throw new Error("pre-restore safety snapshot missing");
    expect(existsSync(join(backupDir, safety))).toBe(true);
    expect(existsSync(join(backupDir, `${safety}.meta.json`))).toBe(true);
    const safetyMeta = JSON.parse(readFileSync(join(backupDir, `${safety}.meta.json`), "utf8")) as { trigger?: string; schema_version?: string };
    expect(safetyMeta.trigger).toBe("pre_restore_auto");
    expect(safetyMeta.schema_version).toBe(CURRENT_SCHEMA_VERSION);

    const safetyCheckDir = join(temporary, "safety-check");
    mkdirSync(safetyCheckDir);
    const safetyRestore = command("restore-disposable", safety, safetyCheckDir);
    expect(safetyRestore.exitCode).toBe(0);
    const safetyHandle = openDatabase(join(safetyCheckDir, "operatoros.sqlite"), { readonly: true });
    expect(safetyHandle.client.query("SELECT COUNT(*) AS count FROM students WHERE id = 424242").get()).toEqual({ count: 1 });
    safetyHandle.close();

    const completed = readFileSync(join(backupDir, "backup_operations_audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>).filter((entry) => entry.event === "restore_completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]!.tool).toBe("backup-cli");
    expect(completed[0]!.filename).toBe(label);
    expect(completed[0]!.safety_backup_filename).toBe(safety);

    const cliRecovery = readFileSync(join(backupDir, "backup_restore_audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(cliRecovery).toHaveLength(1);
    expect(cliRecovery[0]!.event).toBe("restore_completed");
    expect(cliRecovery[0]!.outcome).toBe("COMPLETED");
    expect(cliRecovery[0]!.target_filename).toBe(label);
    expect(cliRecovery[0]!.pre_restore_snapshot_filename).toBe(safety);
    expect(cliRecovery[0]!.reason).toBeNull();
    expect(typeof (cliRecovery[0]!.request_context as { operation_id?: unknown }).operation_id).toBe("string");

    const preserved = readFileSync(databasePath);
    writeFileSync(`${databasePath}-wal`, "nonempty synthetic WAL");
    writeFileSync(`${databasePath}-shm`, "synthetic shared memory");
    const refused = command("restore", label);
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr.toString()).toContain("DATABASE_SIDECAR_PRESENT");
    expect(readFileSync(databasePath).equals(preserved)).toBe(true);
    expect(readdirSync(backupDir).filter((name) => artifactPattern.test(name))).toHaveLength(2);
    rmSync(`${databasePath}-wal`);
    rmSync(`${databasePath}-shm`);

    writeFileSync(join(backupDir, "backup_2000-01-01T00-00-00Z.sqlite3"), "not an encrypted backup");
    const invalid = command("restore", "backup_2000-01-01T00-00-00Z.sqlite3");
    expect(invalid.exitCode).not.toBe(0);
    expect(invalid.stderr.toString()).toContain("Legacy plaintext backups require explicit operator opt-in.");
    expect(readFileSync(databasePath).equals(preserved)).toBe(true);

    const failures = readFileSync(join(backupDir, "backup_operations_audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>).filter((entry) => entry.event === "restore_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]!.reason).toBe("DATABASE_SIDECAR_PRESENT");
    expect(failures[0]!.tool).toBe("backup-cli");
    expect(failures[0]!.filename).toBe(label);

    const cliRecoveryLines = readFileSync(join(backupDir, "backup_restore_audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(cliRecoveryLines).toHaveLength(2);
    const cliFailures = cliRecoveryLines.filter((entry) => entry.event === "restore_failed");
    expect(cliFailures).toHaveLength(1);
    expect(cliFailures[0]!.outcome).toBe("FAILED");
    expect(cliFailures[0]!.target_filename).toBe(label);
    expect(cliFailures[0]!.reason).toBe("DATABASE_SIDECAR_PRESENT");
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
