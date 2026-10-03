#!/usr/bin/env bun
/** Record disposable before-state: counts, checksum, enrollment fingerprint. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { openDatabase } from "@operatoros/db";
import { validateExistingDatabasePath } from "./create-test-workspace";

const COLUMNS = ["id", "student_id", "student_master_id", "academic_year_id", "jenjang_id", "academic_class_id", "class_name"] as const;

export function writeBeforeSnapshot(database: string, runtimeRoot: string, output: string) {
  const selected = validateExistingDatabasePath(database, runtimeRoot);
  const handle = openDatabase(selected, { readonly: true });
  try {
    const count = (table: string) => (handle.client.query(`SELECT COUNT(*) AS c FROM "${table}"`).get() as any).c as number;
    const rows = handle.client.query(`SELECT ${COLUMNS.join(",")} FROM student_enrollments ORDER BY id`).all() as Array<Record<string, unknown>>;
    const enrollments: unknown[][] = rows.map((row) => COLUMNS.map((col) => row[col] ?? null));
    const fingerprint = createHash("sha256").update(JSON.stringify(enrollments)).digest("hex");
    const checksum = createHash("sha256").update(readFileSync(selected)).digest("hex");
    writeFileSync(output, JSON.stringify({
      disposable_database: selected,
      disposable_checksum: checksum,
      enrollment_fingerprint: fingerprint,
      enrollments,
      baseline_enrollment_max_id: enrollments.reduce((m, r) => Math.max(m, Number(r[0] ?? 0)), 0),
      student_enrollments: count("student_enrollments"),
      attendance: count("attendance"),
    }, null, 2));
  } finally {
    handle.close();
  }
}

if (import.meta.main) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: { database: { type: "string" }, "runtime-root": { type: "string" }, output: { type: "string" } } });
    const [db, out] = positionals.length === 2 ? positionals : [values.database, values.output];
    if (!db || !out || !values["runtime-root"]) throw new TypeError("--database/--runtime-root and output are required");
    writeBeforeSnapshot(db as string, values["runtime-root"] as string, out as string);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof TypeError ? 2 : 1;
  }
}
