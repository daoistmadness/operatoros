#!/usr/bin/env bun
/**
 * Read-only containment check for the backup directory.
 *
 * The backup runtime publishes only complete `backup_<timestamp>.sqlite3` +
 * `.meta.json` pairs and the operations audit log. Anything else in that
 * directory, including a plaintext database snapshot, is outside the encrypted
 * chain and outside retention. This check reports it and exits non-zero.
 *
 * Usage: bun scripts/check-backup-dir.ts <backup-dir>
 */
import { lstatSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ARTIFACT = /^backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(?:_\d+)?\.sqlite3$/;
const METADATA = /^backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(?:_\d+)?\.sqlite3\.meta\.json$/;
const AUDIT = "backup_operations_audit.jsonl";
const METADATA_SUFFIX = ".meta.json";

/** Returns one line per problem; an empty array means the directory is clean. */
export function inspectBackupDirectory(names: string[], isRegularFile: (name: string) => boolean): string[] {
  const present = new Set(names);
  const problems: string[] = [];
  for (const name of names) {
    if (name === AUDIT) continue;
    const isArtifact = ARTIFACT.test(name);
    const isMetadata = METADATA.test(name);
    if (!isArtifact && !isMetadata) {
      problems.push(`unexpected entry: ${name}`);
      continue;
    }
    if (!isRegularFile(name)) {
      problems.push(`not a regular file: ${name}`);
      continue;
    }
    const counterpart = isArtifact ? `${name}${METADATA_SUFFIX}` : name.slice(0, -METADATA_SUFFIX.length);
    if (!present.has(counterpart)) problems.push(`incomplete pair: ${name} has no ${counterpart}`);
  }
  return problems.sort();
}

if (import.meta.main) {
  const argument = process.argv[2];
  if (!argument) {
    console.error("usage: bun scripts/check-backup-dir.ts <backup-dir>");
    process.exit(2);
  }
  const directory = resolve(argument);
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch (error) {
    console.error(`cannot read ${directory}: ${(error as Error).message}`);
    process.exit(2);
  }
  const problems = inspectBackupDirectory(names, (name) => {
    try {
      return lstatSync(join(directory, name)).isFile();
    } catch {
      return false;
    }
  });
  if (problems.length > 0) {
    console.error(`backup directory is not contained: ${directory}`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(`backup directory clean: ${directory} (${names.length} entries)`);
}
