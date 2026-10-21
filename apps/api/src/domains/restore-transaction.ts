import { randomUUID } from "node:crypto";
import { renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { syncDirectory, syncFile } from "./durable-files";

/**
 * Filesystem seam for the restore swap. Production uses the node:fs defaults;
 * tests inject failures at each transition.
 */
export interface RestoreFileSystem {
  rename(from: string, to: string): void;
  remove(path: string): void;
  exists(path: string): boolean;
  syncFile(path: string): void;
  syncDirectory(path: string): void;
}

export const nodeRestoreFileSystem: RestoreFileSystem = {
  rename: renameSync,
  remove: (path) => rmSync(path, { force: true }),
  exists: (path) => { try { statSync(path); return true; } catch { return false; } },
  syncFile,
  syncDirectory,
};

export type RestoreSwapOutcome = "committed" | "rolled_back" | "unchanged" | "recovery_required";

export interface RestoreSwapResult<T> {
  outcome: RestoreSwapOutcome;
  value?: T;
  error?: unknown;
}

export interface RestoreSwapOptions<T> {
  active: string;
  candidate: string;
  rollback: string;
  close(): void;
  reopen(): void;
  /** Runs after the candidate is in place and the handle is open again. Throwing rolls the swap back. */
  afterSwap(): T;
  /** Runs after the verified active file and directory have been synced, while rollback is still available. */
  beforeCommit?(value: T): void;
  fileSystem?: RestoreFileSystem;
}

/**
 * Replaces the active SQLite file with a verified candidate, keeping the prior
 * file as a rollback copy until the caller's post-swap work succeeds.
 *
 * Invariants:
 * - The prior active file is never removed before a commit or a verified rollback.
 * - A failed rollback leaves every surviving file on disk for manual recovery.
 * - `recovery_required` means automatic rollback could not be verified; the
 *   caller must not delete the rollback/rejected files.
 */
export function performRestoreSwap<T>(options: RestoreSwapOptions<T>): RestoreSwapResult<T> {
  const files = options.fileSystem ?? nodeRestoreFileSystem;

  const closeQuietly = (): void => { try { options.close(); } catch { /* already closed */ } };
  const reopenQuietly = (): boolean => { try { options.reopen(); return true; } catch { return false; } };

  const restorePriorActive = (): boolean => {
    closeQuietly();
    let parked: string | null = null;
    if (files.exists(options.active)) {
      parked = `${options.active}.${randomUUID()}.rejected`;
      try { files.rename(options.active, parked); }
      catch { return false; } // Cannot move the current file aside: leave everything in place.
      try { files.syncDirectory(dirname(options.active)); }
      catch { /* the following rename and directory sync can still persist both transitions */ }
    }
    try { files.rename(options.rollback, options.active); }
    catch {
      // Put the displaced copy back so a database remains at the active path.
      if (parked) { try { files.rename(parked, options.active); reopenQuietly(); } catch { /* keep the parked copy */ } }
      return false;
    }
    try { files.syncDirectory(dirname(options.active)); }
    catch { return false; }
    if (!reopenQuietly()) return false;
    if (parked) { try { files.remove(parked); } catch { /* keep the duplicate */ } }
    return true;
  };

  try { files.syncFile(options.candidate); }
  catch (error) { return { outcome: "unchanged", error }; }

  try { options.close(); }
  catch (error) { return { outcome: "unchanged", error }; }

  try {
    files.syncFile(options.active);
    files.rename(options.active, options.rollback);
    files.syncDirectory(dirname(options.active));
  }
  catch (error) {
    if (files.exists(options.rollback) && !files.exists(options.active)) {
      return restorePriorActive()
        ? { outcome: "unchanged", error }
        : { outcome: "recovery_required", error };
    }
    reopenQuietly();
    return { outcome: "unchanged", error };
  }

  try {
    files.rename(options.candidate, options.active);
    files.syncDirectory(dirname(options.active));
  }
  catch (error) {
    return restorePriorActive()
      ? { outcome: "rolled_back", error }
      : { outcome: "recovery_required", error };
  }

  try {
    options.reopen();
    const value = options.afterSwap();
    files.syncFile(options.active);
    files.syncDirectory(dirname(options.active));
    options.beforeCommit?.(value);
    try { files.remove(options.rollback); }
    catch { /* an extra copy is safer than failing a verified commit */ }
    try { files.syncDirectory(dirname(options.active)); }
    catch { /* the new active database is durable; a removed rollback may reappear after a crash */ }
    return { outcome: "committed", value };
  } catch (error) {
    return restorePriorActive()
      ? { outcome: "rolled_back", error }
      : { outcome: "recovery_required", error };
  }
}
