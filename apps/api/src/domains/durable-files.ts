import { closeSync, fsyncSync, openSync } from "node:fs";

export function syncFile(path: string): void {
  const fd = openSync(path, "r+");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function syncDirectory(path: string): void {
  // shortcut: Node has no portable directory flush on Windows; add native support if crash durability there is required.
  if (process.platform === "win32") return;
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
