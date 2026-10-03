import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURRENT_SCHEMA_VERSION, openDatabase } from "@operatoros/db";
import { createGoldenFixture } from "./fixtures/golden";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
test.each(["academic", "reports", "academic-with-defaults", "reports-with-defaults"] as const)("%s fixture preserves canonical schema and synthetic account semantics", (kind) => {
  const root = mkdtempSync(join(tmpdir(), "operatoros-golden-fixture-")); roots.push(root);
  const path = join(root, "operatoros.sqlite"); createGoldenFixture(path, kind); const handle = openDatabase(path, { readonly: true });
  try {
    expect(handle.client.query("SELECT version FROM operatoros_schema_migrations").all()).toEqual([{ version: CURRENT_SCHEMA_VERSION }]);
    expect(handle.client.query("PRAGMA foreign_key_check").all()).toEqual([]);
    const users = handle.client.query("SELECT username,password_hash,role,is_active FROM users ORDER BY id").all() as { username: string; password_hash: string; role: string; is_active: number }[];
    expect(users.map(({ username, role, is_active }) => ({ username, role, is_active }))).toEqual([{ username: "golden-admin", role: "admin", is_active: 1 }, { username: "golden-staff", role: "staff", is_active: 1 }, { username: "golden-inactive", role: "staff", is_active: 0 }]);
    for (const user of users) { const password = user.username === "golden-inactive" ? "golden-inactive-pass" : `${user.username}-pass-1`; expect(Bun.password.verifySync(password, user.password_hash)).toBe(true); expect(Bun.password.verifySync("wrong", user.password_hash)).toBe(false); }
    if (kind.startsWith("academic")) {
      expect(handle.client.query("SELECT lifecycle_state,effective_from,effective_to,class_name,class_assigned FROM student_enrollments ORDER BY id").all()).toEqual([{ lifecycle_state: "ENDED", effective_from: "2025-07-01", effective_to: "2026-06-30", class_name: "7A-old", class_assigned: 0 }, { lifecycle_state: "ACTIVE", effective_from: "2026-07-01", effective_to: null, class_name: "7A", class_assigned: 0 }]);
      expect(handle.client.query("SELECT s.id,d.device_identifier FROM students s LEFT JOIN student_device_identities d ON d.legacy_student_id=s.id ORDER BY s.id").all()).toEqual([{ id: 701, device_identifier: "701" }, { id: 702, device_identifier: null }, { id: 703, device_identifier: "703" }, { id: 704, device_identifier: null }]);
    } else {
      expect(handle.client.query("SELECT status,COUNT(*) AS count,SUM(late_duration) AS minutes FROM attendance GROUP BY status ORDER BY status").all()).toEqual([{ status: "incomplete", count: 4, minutes: 0 }, { status: "late", count: 5, minutes: 85 }, { status: "on-time", count: 13, minutes: 0 }]);
      expect(handle.client.query("SELECT jenjang,heb_value FROM heb_overrides ORDER BY jenjang").all()).toEqual([{ jenjang: "SD", heb_value: 15 }, { jenjang: "SMP", heb_value: 18 }]);
      expect(handle.client.query("SELECT COUNT(*) AS count FROM student_enrollments").get()).toEqual({ count: 7 });
      expect(handle.client.query("SELECT COUNT(*) AS count FROM absence_reason_class_entries").get()).toEqual({ count: 3 });
      expect(handle.client.query("SELECT COUNT(*) AS count FROM absence_reasons").get()).toEqual({ count: 4 });
    }
    if (kind.endsWith("-with-defaults")) {
      expect(handle.client.query("SELECT name,assessment_type FROM assessment_components ORDER BY id").all()).toEqual([{ name: "kuis", assessment_type: "sumatif" }, { name: "tes", assessment_type: "sumatif" }, { name: "total", assessment_type: "sumatif" }, { name: "total", assessment_type: "formatif" }]);
      expect(handle.client.query("SELECT name FROM subjects").all()).toEqual([{ name: "Language" }]);
      expect(handle.client.query("SELECT label FROM academic_years WHERE is_default=1").all()).toEqual([{ label: "2025/2026" }]);
      expect(handle.client.query("SELECT name,output_format FROM report_templates ORDER BY id").all()).toEqual([{ name: "Full Management Review", output_format: "both" }, { name: "Attendance & Lateness Review", output_format: "both" }, { name: "Academic Risk Review", output_format: "both" }, { name: "Editable Excel Workbook", output_format: "excel" }]);
      expect(handle.client.query("SELECT prepared_by,is_default FROM report_branding_configs").all()).toEqual([{ prepared_by: "OperatorOS", is_default: 1 }]);
    }
  } finally { handle.close(); }
});
