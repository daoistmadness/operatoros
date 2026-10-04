#!/usr/bin/env bun
/** Recompute disposable checksum/fingerprint and verify reset boundaries. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { openDatabase } from "@operatoros/db";
import { validateExistingDatabasePath } from "./create-test-workspace";

const COLUMNS = ["id", "student_id", "student_master_id", "academic_year_id", "jenjang_id", "academic_class_id", "class_name"] as const;
const LINK_MASTER = "00000000-0000-4000-8000-000000000004";

export function writeAfterVerification(database: string, runtimeRoot: string, checksum: string, beforeFile: string, output: string) {
  const selected = validateExistingDatabasePath(database, runtimeRoot);
  const before = JSON.parse(readFileSync(beforeFile, "utf8")) as { baseline_enrollment_max_id: number; enrollments: unknown[][] };
  const baselineMaxId = Number(before.baseline_enrollment_max_id ?? 0);
  const handle = openDatabase(selected, { readonly: true });
  try {
    const count = (sql: string, params: unknown[] = []) => (handle.client.query(sql).get(...(params as [])) as any ?? {});
    const enrollmentCount = Number(count("SELECT COUNT(*) AS c FROM student_enrollments").c ?? 0);
    const attendanceCount = Number(count("SELECT COUNT(*) AS c FROM attendance").c ?? 0);
    const studentCount = Number(count("SELECT COUNT(*) AS c FROM students").c ?? 0);
    const masterCount = Number(count("SELECT COUNT(*) AS c FROM student_masters").c ?? 0);
    const resetCount = Number(count("SELECT COUNT(*) AS c FROM operations_audit_events WHERE entity_type='SCHOOL_DATA' AND entity_reference='STUDENTS' AND operation='RESET' AND success=1").c ?? 0);
    const adminCount = Number(count("SELECT COUNT(*) AS c FROM users WHERE username='operatoros_e2e_admin' AND is_active=1").c ?? 0);
    const fkIssues = handle.client.query("PRAGMA foreign_key_check").all() as unknown[];
    const rows = handle.client.query(`SELECT ${COLUMNS.join(",")} FROM student_enrollments WHERE id <= ? ORDER BY id`).all(baselineMaxId) as Array<Record<string, unknown>>;
    const enrollments: unknown[][] = rows.map((row) => COLUMNS.map((col) => row[col] ?? null));
    const fingerprint = createHash("sha256").update(JSON.stringify(enrollments)).digest("hex");
    const key = (row: unknown[]) => JSON.stringify(row);
    const beforeRows = new Map((before.enrollments ?? []).map((r) => [key(r as unknown[]), r]));
    const afterRows = new Map(enrollments.map((r) => [key(r), r]));
    const isOnboardingAfter = (r: unknown[]) => r[2] === LINK_MASTER && r[1] === 999999;
    const isOnboardingBefore = (r: unknown[]) => r[2] === LINK_MASTER && r[1] === null;
    let unexpected = 0;
    for (const [k, r] of beforeRows) if (!afterRows.has(k) && !isOnboardingBefore(r as unknown[])) unexpected++;
    for (const [k, r] of afterRows) if (!beforeRows.has(k) && !isOnboardingAfter(r as unknown[])) unexpected++;
    // Parity with the retired Python gate: any remaining rows fail the wiped-state
    // expectation (int(any(counts))), so a successful suite-ending wipe reports zero
    // failures instead of flagging its own empty tables.
    const resetFailures = resetCount < 1 || adminCount < 1 || fkIssues.length > 0 || Boolean(studentCount || masterCount || enrollmentCount || attendanceCount) ? 1 : 0;
    writeFileSync(output, JSON.stringify({
      disposable_checksum: checksum,
      enrollment_fingerprint: fingerprint,
      unexpected_enrollment_changes: resetCount && resetFailures === 0 ? 0 : unexpected,
      reset_verification_failures: resetFailures,
      student_enrollments: enrollmentCount,
      students: studentCount,
      student_masters: masterCount,
      attendance: attendanceCount,
      admin_accounts: adminCount,
      foreign_key_issues: fkIssues.length,
    }, null, 2));
  } finally {
    handle.close();
  }
}

if (import.meta.main) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: { database: { type: "string" }, "runtime-root": { type: "string" }, checksum: { type: "string" }, before: { type: "string" }, output: { type: "string" } } });
    const [db, sum, bef, out] = positionals.length === 4 ? positionals : [values.database, values.checksum, values.before, values.output];
    if (!db || !sum || !bef || !out || !values["runtime-root"]) throw new TypeError("--database/--runtime-root/checksum/before/output are required");
    writeAfterVerification(db as string, values["runtime-root"] as string, sum as string, bef as string, out as string);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof TypeError ? 2 : 1;
  }
}
