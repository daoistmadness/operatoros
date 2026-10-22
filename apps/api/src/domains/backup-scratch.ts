import { lstatSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const uuid = "[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}";
const sqliteSidecar = "(?:-(?:wal|shm|journal))?";

function directoryEntries(path: string): string[] {
  try { return readdirSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function hasPendingRestoreRollback(databasePath: string): boolean {
  const prefix = `${basename(databasePath)}.`;
  return directoryEntries(dirname(databasePath)).some((name) => name.startsWith(prefix) && name.endsWith(".rollback"));
}

function cleanScratchDirectory(root: string, name: string, files: RegExp): void {
  const directory = join(root, name);
  const info = lstatSync(directory, { throwIfNoEntry: false });
  if (!info?.isDirectory() || info.isSymbolicLink()) return;
  for (const entry of readdirSync(directory)) {
    if (!files.test(entry)) continue;
    const path = join(directory, entry);
    const file = lstatSync(path, { throwIfNoEntry: false });
    if (file?.isFile() && !file.isSymbolicLink()) rmSync(path);
  }
  if (readdirSync(directory).length === 0) rmdirSync(directory);
}

/** Call only while holding the data-root backup-operation lock. */
export function cleanupInterruptedBackupScratch(databasePath: string, backupDir: string): void {
  const dataDir = dirname(databasePath);
  if (!hasPendingRestoreRollback(databasePath)) {
    const escaped = basename(databasePath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const candidate = new RegExp(`^${escaped}\\.${uuid}\\.candidate${sqliteSidecar}$`);
    for (const name of directoryEntries(dataDir)) {
      if (candidate.test(name)) {
        const path = join(dataDir, name);
        const file = lstatSync(path, { throwIfNoEntry: false });
        if (file?.isFile() && !file.isSymbolicLink()) rmSync(path);
      } else if (/^\.operatoros-restore-(?:api|cli)-[A-Za-z0-9]{6}$/.test(name)) {
        cleanScratchDirectory(dataDir, name, name.includes("-cli-")
          ? new RegExp(`^${uuid}\\.candidate${sqliteSidecar}$`)
          : new RegExp(`^snapshot\\.sqlite${sqliteSidecar}$`));
      }
    }
  }
  const backupRoot = lstatSync(backupDir, { throwIfNoEntry: false });
  if (backupRoot?.isDirectory() && !backupRoot.isSymbolicLink()) {
    for (const name of directoryEntries(backupDir)) {
      if (/^\.operatoros-backup-[A-Za-z0-9]{6}$/.test(name)) {
        cleanScratchDirectory(backupDir, name, new RegExp(`^(?:snapshot\\.sqlite|backup\\.encrypted|backup\\.meta\\.json)${sqliteSidecar}$`));
      }
    }
  }
}
