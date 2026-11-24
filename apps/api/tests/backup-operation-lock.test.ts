import { describe, it, expect } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFreshDatabase, ensureOperatorOSDirectories, resolveOperatorOSPaths } from "@operatoros/db";
import type { BackendConfig } from "../src/config";
import { acquireBackupOperationLock, BACKUP_OPERATION_LOCK_FILENAME } from "../src/domains/backup-operation-lock";
import { parseBackupEncryptionConfig } from "../src/security/backup-crypto";
import { startServer } from "../src/server";

const authCookieSecret = "synthetic-auth-cookie-secret-for-operation-lock-test";
const backupKey = Buffer.alloc(32, 19).toString("base64");
const root = fileURLToPath(new URL("../../../", import.meta.url));

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "operatoros-backup-operation-lock-"));
  const paths = resolveOperatorOSPaths({ repositoryRoot: root, env: { OPERATOROS_DATA_DIR: dataDir } });
  ensureOperatorOSDirectories(paths);
  createFreshDatabase(paths.databasePath);
  const config: Partial<BackendConfig> = {
    hostname: "127.0.0.1",
    port: 0,
    environment: "test",
    databasePath: paths.databasePath,
    dataPaths: paths,
    backupDir: paths.backupDir,
    auth: { authCookieSecret },
    backupEncryption: parseBackupEncryptionConfig({ activeKey: backupKey, activeKeyId: "synthetic", authCookieSecret }),
  };
  return { dataDir, paths, config, lockPath: join(dataDir, BACKUP_OPERATION_LOCK_FILENAME) };
}

function lockProbe(lockPath: string) {
  return Bun.spawnSync(["flock", "--nonblock", "--exclusive", "--conflict-exit-code", "75", lockPath, "true"]);
}

function makeUnresponsiveFlock(dataDir: string, reportReady: boolean): string {
  const binDir = join(dataDir, "bin");
  mkdirSync(binDir, { mode: 0o700 });
  const executable = join(binDir, "flock");
  const workerCode = [
    reportReady ? 'process.stdout.write("LOCKED\\n");' : "",
    "const parent = process.ppid;",
    'process.on("SIGTERM", () => {});',
    "setInterval(() => { if (process.ppid !== parent) process.exit(0); }, 25);",
  ].join("");
  writeFileSync(executable, [
    "#!/bin/sh",
    "exec /usr/bin/flock --nonblock --exclusive --conflict-exit-code 75 --no-fork \"$6\" \"$7\" -e '" + workerCode + "'",
    "",
  ].join("\n"), { mode: 0o700 });
  chmodSync(executable, 0o700);
  return binDir;
}

function spawnLockChild(binDir: string, source: string) {
  return Bun.spawn([process.execPath, "-e", source], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      PATH: [binDir, process.env.PATH].filter(Boolean).join(":"),
    },
    stdout: "pipe",
    stderr: "ignore",
  });
}

type ChildOutputReader = { read(): Promise<{ done: boolean; value?: Uint8Array<ArrayBuffer> }> };

async function readUntil(reader: ChildOutputReader, marker: string): Promise<string> {
  let output = "";
  const decoder = new TextDecoder();
  while (!output.includes(marker)) {
    const result = await reader.read();
    if (result.done) break;
    output += decoder.decode(result.value, { stream: true });
  }
  return output;
}

async function readRemaining(reader: ChildOutputReader): Promise<string> {
  let output = "";
  const decoder = new TextDecoder();
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    output += decoder.decode(result.value, { stream: true });
  }
  return output;
}

async function waitForLockFree(lockPath: string): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (lockProbe(lockPath).exitCode === 0) return true;
    await Bun.sleep(25);
  }
  return false;
}

async function holdLock(lockPath: string) {
  writeFileSync(lockPath, "", { flag: "a", mode: 0o600 });
  const holder = Bun.spawn([
    "flock", "--nonblock", "--exclusive", "--no-fork", lockPath,
    process.execPath, "-e", "process.stdout.write('LOCKED\\n'); setInterval(() => {}, 2147483647);",
  ], { stdout: "pipe", stderr: "ignore" });
  await holder.stdout.getReader().read();
  return holder;
}

describe("API and CLI backup operation lock", () => {
  it.skipIf(process.platform !== "linux")("bounds a nonresponsive startup worker and releases its synthetic lock", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "operatoros-lock-watchdog-timeout-"));
    const lockPath = join(dataDir, BACKUP_OPERATION_LOCK_FILENAME);
    const binDir = makeUnresponsiveFlock(dataDir, false);
    const moduleUrl = pathToFileURL(join(root, "apps/api/src/domains/backup-operation-lock.ts")).href;
    const source = [
      "import { acquireBackupOperationLock } from " + JSON.stringify(moduleUrl) + ";",
      "try { await acquireBackupOperationLock(" + JSON.stringify(dataDir) + ", { timeoutMs: 100, watchdog: true });",
      'process.stdout.write("UNEXPECTED_ACQUIRE\\n"); process.exitCode = 1; }',
      'catch (error) { process.stdout.write("ERROR:" + error.code + "\\n"); }',
    ].join("\n");
    const child = spawnLockChild(binDir, source);
    const reader = child.stdout.getReader();
    try {
      const result = await Promise.race([
        Promise.all([readUntil(reader, "ERROR:"), child.exited]),
        Bun.sleep(5000).then(() => null),
      ]);
      expect(result).not.toBeNull();
      const [prefix, exitCode] = result as [string, number];
      const output = prefix + await readRemaining(reader);
      expect(exitCode).toBe(0);
      expect(output).toContain("ERROR:BACKUP_OPERATION_LOCK_UNAVAILABLE");
      expect(await waitForLockFree(lockPath)).toBe(true);
    } finally {
      if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
      await readRemaining(reader);
      expect(await waitForLockFree(lockPath)).toBe(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 10000);

  it.skipIf(process.platform !== "linux")("bounds release of a nonresponsive worker without dropping exclusivity early", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "operatoros-lock-watchdog-release-"));
    const lockPath = join(dataDir, BACKUP_OPERATION_LOCK_FILENAME);
    const binDir = makeUnresponsiveFlock(dataDir, true);
    const moduleUrl = pathToFileURL(join(root, "apps/api/src/domains/backup-operation-lock.ts")).href;
    const source = [
      "import { acquireBackupOperationLock } from " + JSON.stringify(moduleUrl) + ";",
      "const lock = await acquireBackupOperationLock(" + JSON.stringify(dataDir) + ", { timeoutMs: 1000, watchdog: true });",
      'process.stdout.write("ACQUIRED\\n"); await Bun.sleep(1000); await lock.release(); process.stdout.write("RELEASED\\n");',
    ].join("\n");
    const child = spawnLockChild(binDir, source);
    const reader = child.stdout.getReader();
    try {
      const acquired = await Promise.race([
        readUntil(reader, "ACQUIRED\n"),
        Bun.sleep(5000).then(() => null),
      ]);
      expect(acquired).not.toBeNull();
      expect(lockProbe(lockPath).exitCode).toBe(75);
      const result = await Promise.race([
        Promise.all([readRemaining(reader), child.exited]),
        Bun.sleep(5000).then(() => null),
      ]);
      expect(result).not.toBeNull();
      const [output, exitCode] = result as [string, number];
      expect(exitCode).toBe(0);
      expect(output).toContain("RELEASED");
      expect(await waitForLockFree(lockPath)).toBe(true);
    } finally {
      if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
      await readRemaining(reader);
      expect(await waitForLockFree(lockPath)).toBe(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 10000);

  it.skipIf(process.platform !== "linux")("terminates a nonresponsive pending worker on API interruption", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "operatoros-lock-watchdog-interrupt-"));
    const lockPath = join(dataDir, BACKUP_OPERATION_LOCK_FILENAME);
    const binDir = makeUnresponsiveFlock(dataDir, false);
    const moduleUrl = pathToFileURL(join(root, "apps/api/src/domains/backup-operation-lock.ts")).href;
    const source = [
      "import { acquireBackupOperationLock } from " + JSON.stringify(moduleUrl) + ";",
      "const pending = acquireBackupOperationLock(" + JSON.stringify(dataDir) + ", { timeoutMs: 5000, watchdog: true });",
      'process.stdout.write("WAITING\\n");',
      'try { await pending; process.stdout.write("UNEXPECTED_ACQUIRE\\n"); process.exitCode = 1; }',
      'catch (error) { process.stdout.write("INTERRUPTED:" + error.code + "\\n"); }',
    ].join("\n");
    const child = spawnLockChild(binDir, source);
    const reader = child.stdout.getReader();
    try {
      const waiting = await Promise.race([
        readUntil(reader, "WAITING\n"),
        Bun.sleep(5000).then(() => null),
      ]);
      expect(waiting).not.toBeNull();
      child.kill("SIGTERM");
      const result = await Promise.race([
        Promise.all([readRemaining(reader), child.exited]),
        Bun.sleep(5000).then(() => null),
      ]);
      expect(result).not.toBeNull();
      const [output, exitCode] = result as [string, number];
      expect(exitCode).toBe(0);
      expect(output).toContain("INTERRUPTED:BACKUP_OPERATION_LOCK_UNAVAILABLE");
      expect(await waitForLockFree(lockPath)).toBe(true);
    } finally {
      if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
      await readRemaining(reader);
      expect(await waitForLockFree(lockPath)).toBe(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 10000);

  it.skipIf(process.platform !== "linux")("retries a transient lock conflict and recovers after the holder exits", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "operatoros-lock-watchdog-retry-"));
    const lockPath = join(dataDir, BACKUP_OPERATION_LOCK_FILENAME);
    let holder: Awaited<ReturnType<typeof holdLock>> | undefined;
    let lock: Awaited<ReturnType<typeof acquireBackupOperationLock>> | undefined;
    try {
      holder = await holdLock(lockPath);
      const pending = acquireBackupOperationLock(dataDir, { timeoutMs: 1000, watchdog: true });
      await Bun.sleep(100);
      holder.kill();
      await holder.exited;
      lock = await pending;
      expect(lockProbe(lockPath).exitCode).toBe(75);
      await lock.release();
      expect(await waitForLockFree(lockPath)).toBe(true);
    } finally {
      if (holder && holder.exitCode === null) { holder.kill(); await holder.exited; }
      await lock?.release();
      expect(await waitForLockFree(lockPath)).toBe(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 10000);

  it.skipIf(process.platform !== "linux")("cleans recognized API plaintext scratch after acquiring the data-root lock", async () => {
    const fixture = setup();
    const restoreScratch = join(fixture.dataDir, ".operatoros-restore-api-Ab12Cd");
    const restorePlaintext = join(restoreScratch, "snapshot.sqlite");
    const restoreNote = join(restoreScratch, "operator-note.txt");
    const backupScratch = join(fixture.paths.backupDir, ".operatoros-backup-Ef34Gh");
    const backupPlaintext = join(backupScratch, "snapshot.sqlite");
    const apiCandidate = `${fixture.paths.databasePath}.01234567-89ab-cdef-0123-456789abcdef.candidate`;
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      mkdirSync(restoreScratch, { mode: 0o700 });
      mkdirSync(backupScratch, { mode: 0o700 });
      writeFileSync(restorePlaintext, "synthetic API restore plaintext", { mode: 0o600 });
      writeFileSync(restoreNote, "preserve unrelated scratch contents", { mode: 0o600 });
      writeFileSync(backupPlaintext, "synthetic API backup plaintext", { mode: 0o600 });
      writeFileSync(apiCandidate, "synthetic API restore candidate", { mode: 0o600 });

      server = await startServer(fixture.config);

      expect(existsSync(restorePlaintext)).toBe(false);
      expect(existsSync(backupPlaintext)).toBe(false);
      expect(existsSync(apiCandidate)).toBe(false);
      expect(readFileSync(restoreNote, "utf8")).toBe("preserve unrelated scratch contents");
      expect(server.port).toBeGreaterThan(0);
    } finally {
      await server?.stop();
      rmSync(fixture.dataDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "linux")("refuses a symlink lock path without changing its target", async () => {
    const fixture = setup();
    const target = join(fixture.dataDir, "lock-target");
    try {
      writeFileSync(target, "synthetic target", { mode: 0o644 });
      chmodSync(target, 0o644);
      symlinkSync(target, fixture.lockPath);
      await expect(startServer(fixture.config)).rejects.toMatchObject({ code: "BACKUP_OPERATION_LOCK_INVALID" });
      expect(statSync(target).mode & 0o777).toBe(0o644);
    } finally {
      rmSync(fixture.dataDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "linux")("holds the data-root lock for API lifetime and refuses CLI work until shutdown", async () => {
    const fixture = setup();
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    let lockReleased = false;
    try {
      server = await startServer(fixture.config);
      expect(lockProbe(fixture.lockPath).exitCode).toBe(75);
      await expect(startServer(fixture.config)).rejects.toMatchObject({ code: "BACKUP_OPERATION_LOCKED" });

      const cli = Bun.spawnSync([process.execPath, join(root, "apps/api/src/backup-cli.ts"), "backup"], {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          OPERATOROS_DATA_DIR: fixture.dataDir,
          OPERATOROS_REPOSITORY_ROOT: root,
          AUTH_COOKIE_SECRET: authCookieSecret,
          BACKUP_ENCRYPTION_KEY: backupKey,
          BACKUP_ENCRYPTION_KEY_ID: "synthetic",
        },
      });
      expect(cli.exitCode).toBe(1);
      expect(cli.stderr.toString()).toContain("Another backup or restore operation is already active for this data root.");
      const events = readFileSync(join(fixture.paths.backupDir, "backup_operations_audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(events.at(-1)).toMatchObject({ event: "backup_failed", failure_code: "BACKUP_CLI_OPERATION_BUSY" });
    } finally {
      await server?.stop();
      lockReleased = lockProbe(fixture.lockPath).exitCode === 0;
      rmSync(fixture.dataDir, { recursive: true, force: true });
    }
    expect(lockReleased).toBe(true);
  }, 30000);

  it.skipIf(process.platform !== "linux")("refuses API startup while a CLI lock is held, then starts after release", async () => {
    const fixture = setup();
    let holder: ReturnType<typeof Bun.spawn> | undefined;
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      holder = await holdLock(fixture.lockPath);
      expect(lockProbe(fixture.lockPath).exitCode).toBe(75);
      await expect(startServer(fixture.config)).rejects.toMatchObject({ code: "BACKUP_OPERATION_LOCKED" });
      holder.kill();
      await holder.exited;
      server = await startServer(fixture.config);
      expect(server.port).toBeGreaterThan(0);
    } finally {
      await server?.stop();
      if (holder && holder.exitCode === null) { holder.kill(); await holder.exited; }
      rmSync(fixture.dataDir, { recursive: true, force: true });
    }
  }, 30000);

  it.skipIf(process.platform !== "linux")("releases the shared lock after an API process is interrupted", async () => {
    const fixture = setup();
    const serverModule = pathToFileURL(join(root, "apps/api/src/server.ts")).href;
    const script = `const { startServer } = await import(${JSON.stringify(serverModule)}); await startServer({ hostname: "127.0.0.1", port: 0 }); process.stdout.write("SERVER_READY\\n"); setInterval(() => {}, 2147483647);`;
    const server = Bun.spawn([process.execPath, "-e", script], {
      env: {
        ...process.env,
        OPERATOROS_DATA_DIR: fixture.dataDir,
        OPERATOROS_REPOSITORY_ROOT: root,
        AUTH_COOKIE_SECRET: authCookieSecret,
        BACKUP_ENCRYPTION_KEY: backupKey,
        BACKUP_ENCRYPTION_KEY_ID: "synthetic",
        NODE_ENV: "test",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      const reader = server.stdout.getReader();
      let output = "";
      while (!output.includes("SERVER_READY\n")) {
        const result = await reader.read();
        if (result.done) throw new Error(server.stderr ? await new Response(server.stderr).text() : "API server exited before readiness");
        output += new TextDecoder().decode(result.value);
      }
      expect(lockProbe(fixture.lockPath).exitCode).toBe(75);
      server.kill("SIGKILL");
      await server.exited;
      let released = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        if (lockProbe(fixture.lockPath).exitCode === 0) { released = true; break; }
        await Bun.sleep(50);
      }
      expect(released).toBe(true);
    } finally {
      if (server.exitCode === null) { server.kill(); await server.exited; }
      rmSync(fixture.dataDir, { recursive: true, force: true });
    }
  }, 30000);
});
