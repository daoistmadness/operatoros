import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chmodSync, lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BACKUP_OPERATION_LOCK_FILENAME = ".operatoros-backup-cli.lock";

export async function acquireBackupOperationLock(dataDir: string): Promise<{ release(): Promise<void>; onLost(callback: () => void): void }> {
  const path = join(dataDir, BACKUP_OPERATION_LOCK_FILENAME);
  const existing = lstatSync(path, { throwIfNoEntry: false });
  if (existing && !existing.isFile()) throw Object.assign(new Error("BACKUP_OPERATION_LOCK_INVALID"), { code: "BACKUP_OPERATION_LOCK_INVALID" });
  writeFileSync(path, "", { flag: "a", mode: 0o600 });
  chmodSync(path, 0o600);
  const worker = fileURLToPath(new URL("./backup-operation-lock-holder.ts", import.meta.url));
  const child = spawn("flock", ["--nonblock", "--exclusive", "--conflict-exit-code", "75", "--no-fork", path, process.execPath, worker], { stdio: ["ignore", "pipe", "ignore"] });
  let settled = false;
  let released = false;
  let lost = false;
  let onLost = () => {};
  let output = "";
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));

  child.once("exit", () => {
    if (!released) {
      lost = true;
      onLost();
    }
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => fail("BACKUP_OPERATION_LOCK_UNAVAILABLE"), 10_000);
    const fail = (code: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      reject(Object.assign(new Error(code), { code }));
    };
    child.once("error", () => fail("BACKUP_OPERATION_LOCK_UNAVAILABLE"));
    child.once("exit", (code) => fail(code === 75 ? "BACKUP_OPERATION_LOCKED" : "BACKUP_OPERATION_LOCK_UNAVAILABLE"));
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (settled || !output.includes("LOCKED\n")) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        release: async () => {
          if (released) return;
          released = true;
          child.kill();
          await exited;
        },
        onLost: (callback) => {
          onLost = callback;
          if (lost) onLost();
        },
      });
    });
  });
}
