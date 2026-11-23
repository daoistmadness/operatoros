import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chmodSync, lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BACKUP_OPERATION_LOCK_FILENAME = ".operatoros-backup-cli.lock";

export async function acquireBackupOperationLock(
  dataDir: string,
  options: { timeoutMs?: number } = {},
): Promise<{ release(): Promise<void>; onLost(callback: () => void): void }> {
  const path = join(dataDir, BACKUP_OPERATION_LOCK_FILENAME);
  const existing = lstatSync(path, { throwIfNoEntry: false });
  if (existing && !existing.isFile()) throw Object.assign(new Error("BACKUP_OPERATION_LOCK_INVALID"), { code: "BACKUP_OPERATION_LOCK_INVALID" });
  writeFileSync(path, "", { flag: "a", mode: 0o600 });
  chmodSync(path, 0o600);
  const workerUrl = new URL("./backup-operation-lock-holder.ts", import.meta.url);
  const worker = fileURLToPath(workerUrl);

  const timeoutMs = options.timeoutMs ?? (process.env.NODE_ENV !== "test" ? 3000 : 0);
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    let settled = false;
    let released = false;
    let lost = false;
    let onLost = () => {};
    let output = "";
    let exited: Promise<void>;

    const tryAcquire = () => {
      output = "";
      child = spawn("flock", ["--nonblock", "--exclusive", "--conflict-exit-code", "75", "--no-fork", path, process.execPath, worker], { stdio: ["ignore", "pipe", "ignore"] });
      exited = new Promise<void>((res) => child.once("exit", () => res()));

      child.once("exit", (code) => {
        if (!released) {
          if (!settled && code === 75 && Date.now() < deadline) {
            setTimeout(tryAcquire, 50);
            return;
          }
          lost = true;
          onLost();
          if (!settled) {
            settled = true;
            child.kill();
            reject(Object.assign(new Error(code === 75 ? "BACKUP_OPERATION_LOCKED" : "BACKUP_OPERATION_LOCK_UNAVAILABLE"), { code: code === 75 ? "BACKUP_OPERATION_LOCKED" : "BACKUP_OPERATION_LOCK_UNAVAILABLE" }));
          }
        }
      });

      child.once("error", () => {
        if (!settled) {
          settled = true;
          child.kill();
          reject(Object.assign(new Error("BACKUP_OPERATION_LOCK_UNAVAILABLE"), { code: "BACKUP_OPERATION_LOCK_UNAVAILABLE" }));
        }
      });

      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (settled || !output.includes("LOCKED\n")) return;
        settled = true;
        const onSigterm = () => {
          if (!released) {
            released = true;
            child.kill("SIGKILL");
          }
        };
        process.once("SIGTERM", onSigterm);
        resolve({
          release: async () => {
            process.removeListener("SIGTERM", onSigterm);
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
    };

    tryAcquire();
  });
}
