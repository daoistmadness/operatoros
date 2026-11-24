import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chmodSync, lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BACKUP_OPERATION_LOCK_FILENAME = ".operatoros-backup-cli.lock";

const WATCHDOG_TERM_GRACE_MS = 250;
const WATCHDOG_KILL_GRACE_MS = 250;

type BackupOperationLockErrorCode = "BACKUP_OPERATION_LOCKED" | "BACKUP_OPERATION_LOCK_UNAVAILABLE";

function lockError(code: BackupOperationLockErrorCode) {
  return Object.assign(new Error(code), { code });
}

async function waitForChildExit(exited: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const didExit = await Promise.race([exited.then(() => true), timeout]);
  if (timer) clearTimeout(timer);
  return didExit;
}

async function terminateLockWorker(child: ReturnType<typeof spawn>, exited: Promise<void>): Promise<boolean> {
  child.kill("SIGTERM");
  if (await waitForChildExit(exited, WATCHDOG_TERM_GRACE_MS)) return true;

  child.kill("SIGKILL");
  return waitForChildExit(exited, WATCHDOG_KILL_GRACE_MS);
}

export async function acquireBackupOperationLock(
  dataDir: string,
  options: { timeoutMs?: number; watchdog?: boolean } = {},
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
  const watchdog = options.watchdog === true;

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
      let resolveExited!: () => void;
      exited = new Promise<void>((res) => { resolveExited = res; });
      let stopReason: "timeout" | "interrupted" | undefined;
      let watchdogTimer: ReturnType<typeof setTimeout> | undefined;

      const clearWatchdog = () => {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        process.removeListener("SIGINT", onInterrupt);
        process.removeListener("SIGTERM", onInterrupt);
      };

      const fail = (code: BackupOperationLockErrorCode) => {
        if (settled) return;
        settled = true;
        clearWatchdog();
        child.kill();
        reject(lockError(code));
      };

      const requestStop = (reason: "timeout" | "interrupted") => {
        if (settled || stopReason) return;
        stopReason = reason;
        if (watchdogTimer) clearTimeout(watchdogTimer);
        void terminateLockWorker(child, exited).then((stopped) => {
          if (!stopped) fail("BACKUP_OPERATION_LOCK_UNAVAILABLE");
        });
      };

      const onInterrupt = () => requestStop("interrupted");
      if (watchdog) {
        process.once("SIGINT", onInterrupt);
        process.once("SIGTERM", onInterrupt);
      }

      child.once("exit", (code) => {
        resolveExited();
        clearWatchdog();
        if (!released) {
          if (stopReason) {
            fail("BACKUP_OPERATION_LOCK_UNAVAILABLE");
            return;
          }
          if (!settled && code === 75 && Date.now() < deadline) {
            setTimeout(tryAcquire, 50);
            return;
          }
          lost = true;
          onLost();
          if (!settled) fail(code === 75 ? "BACKUP_OPERATION_LOCKED" : "BACKUP_OPERATION_LOCK_UNAVAILABLE");
        }
      });

      child.once("error", () => {
        if (!stopReason) fail("BACKUP_OPERATION_LOCK_UNAVAILABLE");
      });

      if (watchdog && timeoutMs > 0) {
        watchdogTimer = setTimeout(() => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          requestStop("timeout");
        }, Math.max(0, deadline - Date.now()));
      }

      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (settled || stopReason || !output.includes("LOCKED\n")) return;
        settled = true;
        clearWatchdog();
        const onSigterm = () => {
          if (!released) {
            if (watchdog) child.kill("SIGTERM");
            else {
              released = true;
              child.kill("SIGKILL");
            }
          }
        };
        process.once("SIGTERM", onSigterm);
        resolve({
          release: async () => {
            process.removeListener("SIGTERM", onSigterm);
            if (released) return;
            released = true;
            if (watchdog) {
              if (!await terminateLockWorker(child, exited)) throw lockError("BACKUP_OPERATION_LOCK_UNAVAILABLE");
            } else {
              child.kill();
              await exited;
            }
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
