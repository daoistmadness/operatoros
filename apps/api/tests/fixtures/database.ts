import { openDatabase } from "@operatoros/db";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function openTestDatabase(path: string, options: { readonly?: boolean } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  if (path !== ":memory:" && !options.readonly && !existsSync(path)) writeFileSync(path, "", { flag: "wx", mode: 0o600 });
  return openDatabase(path, { ...options, validate: false });
}
