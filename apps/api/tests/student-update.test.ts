import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { appendRow, loadXlsxWorkbook, writeXlsxWorkbook } from "@operatoros/excel";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { python } from "./python";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const secret = "astryx-test-only-cookie-secret-32-chars";
const headers = ["OperatorOS Student UUID", "Record Version", "Legal Name", "Preferred Name", "NIPD", "NISN", "NIK", "Birth Place", "Birth Date", "Gender", "Religion", "Student Status", "Address", "Kelurahan", "Kecamatan", "City", "Province", "Postal Code", "Phone", "Email", "Guardian Name", "Guardian Phone", "Attendance Device No. ID", "Device Source", "Academic Year ID", "Academic Year", "Academic Class ID", "Class"];

function seed(path: string): void {
  const script = "from pathlib import Path; import sqlite3, sys, uuid; sys.path.insert(0, 'backend/src'); from core.schema_migrations import bootstrap_fresh_sqlite_database; from argon2 import PasswordHasher; path=Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path); db=sqlite3.connect(path); ph=PasswordHasher(); db.execute('INSERT INTO users (username,password_hash,role,is_active) VALUES (?,?,?,1)', ('golden-admin',ph.hash('golden-admin-pass-1'),'admin')); db.execute(\"INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,?,?,'active')\", ('11111111-1111-1111-1111-111111111111','Andi','andi')); db.commit(); db.close()";
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

describe("student update workbook candidates", () => {
  it("keeps workbook preview non-mutating and rejects invalid rows at commit", async () => {
    const path = `/tmp/operatoros-student-update-${process.pid}-${Date.now()}.db`; seed(path); const database = openDatabase(path); const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-student-update-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) })); const auth = { cookie: cookie(login) };
      const template = await app.handle(new Request("http://local/api/student-masters/management/export-template", { headers: auth })); expect(template.status).toBe(200);
      const workbook = await loadXlsxWorkbook(await template.arrayBuffer()); const sheet = workbook.getWorksheet("Student Data")!; expect(sheet.rowCount).toBeGreaterThan(1); sheet.spliceRows(2, sheet.rowCount - 1); appendRow(sheet, ["missing-student", ...Array(headers.length - 1).fill("")]); const bytes = await writeXlsxWorkbook(workbook); const form = new FormData(); form.append("file", new File([bytes], "student-update.xlsx"));
      const preview = await app.handle(new Request("http://local/api/student-masters/management/update-preview", { method: "POST", headers: auth, body: form })); const body = await preview.json() as any; expect(preview.status, JSON.stringify(body)).toBe(200); expect(body.summary).toMatchObject({ total: 1, invalid: 1 }); expect(body.rows[0]).toMatchObject({ classification: "INVALID", errors: [{ code: "UNKNOWN_UUID" }] });
      const history = await app.handle(new Request("http://local/api/student-masters/management/import-history", { headers: auth })); expect(history.status).toBe(200); expect((await history.json() as any).total).toBe(1);
      const commit = await app.handle(new Request(`http://local/api/student-masters/management/update-commit/${body.id}`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ selected_row_ids: [body.rows[0].id], confirmation: "COMMIT_STUDENT_DATA_UPDATE", preview_checksum: body.preview_checksum }) })); expect(commit.status).toBe(409);
      expect((database.client.query("SELECT COUNT(*) AS count FROM student_masters").get() as any).count).toBe(1);
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);

  it("reports applied and not-updated rows from a synthetic workbook", async () => {
    const path = `/tmp/operatoros-student-update-result-${process.pid}-${Date.now()}.db`; seed(path); const database = openDatabase(path); const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-student-update-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) })); const auth = { cookie: cookie(login) };
      const template = await app.handle(new Request("http://local/api/student-masters/management/export-template", { headers: auth }));
      const workbook = await loadXlsxWorkbook(await template.arrayBuffer()); const sheet = workbook.getWorksheet("Student Data")!;
      appendRow(sheet, (sheet.getRow(2).values as unknown[]).slice(1));
      sheet.getRow(2).getCell(headers.indexOf("Phone") + 1).value = "081300000000";
      appendRow(sheet, ["missing-student", ...Array(headers.length - 1).fill("")]);
      const bytes = await writeXlsxWorkbook(workbook); const form = new FormData(); form.append("file", new File([bytes], "synthetic-update.xlsx"));
      const response = await app.handle(new Request("http://local/api/student-masters/management/update-preview", { method: "POST", headers: auth, body: form })); const plan = await response.json() as any;
      expect(response.status, JSON.stringify(plan)).toBe(200);
      expect(plan.summary).toMatchObject({ total: 3, updates: 1, unchanged: 1, invalid: 1 });
      expect(plan.rows.map((value: any) => value.classification)).toEqual(["UPDATE_EXISTING_MASTER", "NO_CHANGE", "INVALID"]);
      expect(plan.rows[0].differences.student_phone).toMatchObject({ current: null, uploaded: "081300000000" });
      const commitResponse = await app.handle(new Request(`http://local/api/student-masters/management/update-commit/${plan.id}`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ selected_row_ids: [plan.rows[0].id], confirmation: "COMMIT_STUDENT_DATA_UPDATE", preview_checksum: plan.preview_checksum }) }));
      expect(commitResponse.status).toBe(200);
      expect((database.client.query("SELECT student_phone FROM student_contacts WHERE student_master_id = ?").get("11111111-1111-1111-1111-111111111111") as any).student_phone).toBe("081300000000");
      expect(database.client.query("SELECT provenance_status, rollback_state, applied_action_count FROM student_import_sessions WHERE id = ?").get(plan.session_id)).toMatchObject({ provenance_status: "COMPLETE_ACTION_PROVENANCE", rollback_state: "AVAILABLE", applied_action_count: 1 });
      expect((database.client.query("SELECT COUNT(*) AS count FROM student_import_applied_actions WHERE session_id = ?").get(plan.session_id) as any).count).toBe(1);
      const session = await app.handle(new Request(`http://local/api/student-masters/management/imports/${plan.id}`, { headers: auth })); const detail = await session.json() as any;
      expect(detail.rows.map((value: any) => value.selected)).toEqual([true, false, false]);
      const result = await app.handle(new Request(`http://local/api/student-masters/management/imports/${plan.id}/result.xlsx`, { headers: auth })); expect(result.status).toBe(200);
      const report = await loadXlsxWorkbook(await result.arrayBuffer());
      expect(report.getWorksheet("Updated")?.rowCount).toBe(2);
      expect(report.getWorksheet("Not Updated")?.rowCount).toBe(3);
      expect(report.getWorksheet("Summary")?.getCell("B2").value).toBe(1);
      const rollbackPreviewResponse = await app.handle(new Request(`http://local/api/student-import-sessions/${plan.session_id}/rollback-preview`, { method: "POST", headers: auth }));
      const rollbackPlan = await rollbackPreviewResponse.json() as any;
      expect(rollbackPreviewResponse.status, JSON.stringify(rollbackPlan)).toBe(200);
      expect(rollbackPlan).toMatchObject({ is_rollbackable: true, eligible_actions: 1, total_applied_actions: 1 });
      const rollbackResponse = await app.handle(new Request(`http://local/api/student-import-sessions/${plan.session_id}/rollback`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ preview_checksum: rollbackPlan.preview_checksum, mode: "ALL", reason: "Synthetic Student Update rollback", confirmation_value: rollbackPlan.required_confirmation, idempotency_token: "synthetic-rollback-1" }) }));
      expect(rollbackResponse.status, await rollbackResponse.text()).toBe(200);
      expect(database.client.query("SELECT student_phone FROM student_contacts WHERE student_master_id = ?").get("11111111-1111-1111-1111-111111111111")).toBeNull();
      const afterRollback = await app.handle(new Request(`http://local/api/student-import-sessions/${plan.session_id}/rollback-preview`, { method: "POST", headers: auth }));
      expect(await afterRollback.json()).toMatchObject({ is_rollbackable: false, eligible_actions: 0, already_compensated_actions: 2 });
      const legacySessionId = "legacy-student-update-session";
      database.client.run("INSERT INTO student_import_sessions (id,session_uuid,import_type,status,provenance_status,created_by,expires_at,source_filename,source_file_checksum,row_count,selected_row_count,applied_action_count,rollback_state,metadata,schema_version) VALUES (?,?,'STUDENT_DATA_UPDATE','COMMITTED','COMPLETE_ACTION_PROVENANCE','golden-admin','2026-09-29','legacy.xlsx',?,1,1,1,'AVAILABLE','{}','1')", [legacySessionId, legacySessionId, "d".repeat(64)]);
      database.client.run("INSERT INTO student_import_batches (id,session_id,filename,file_checksum,source_sheet,status,total_rows,update_count,created_by) VALUES (? ,?,'legacy.xlsx',?,'student_update','committed',1,1,'golden-admin')", ["legacy-student-update-batch", legacySessionId, "e".repeat(64)]);
      database.client.run("INSERT INTO student_import_rows (batch_id,source_row,classification,matched_student_master_id,normalized_payload,differences,validation_errors,selected_for_commit) VALUES (?,2,'UPDATE_EXISTING_MASTER',?,?, '{}','[]',1)", ["legacy-student-update-batch", "11111111-1111-1111-1111-111111111111", JSON.stringify({ "Legal Name": "Andi", NIPD: null })]);
      const legacyDetail = await app.handle(new Request("http://local/api/student-masters/management/imports/legacy-student-update-batch", { headers: auth }));
      expect(await legacyDetail.json()).toMatchObject({ rollback_state: "NOT_AVAILABLE", applied_action_count: 1, rollback_action_count: 0, rollback_unavailable_reason: "NO_RECORDED_STUDENT_UPDATE_ACTIONS" });
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);

  it("compensates only the applied Student's profile, address, guardian, contact, and device changes", async () => {
    const path = `/tmp/operatoros-student-update-rollback-${process.pid}-${Date.now()}.db`; seed(path); const database = openDatabase(path); const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-student-update-audit-${process.pid}` } });
    try {
      const yearId = Number(database.client.run("INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2026/2027-student-update-rollback','2026-07-01','2027-06-30','active',1)").lastInsertRowid);
      const jenjangId = Number(database.client.run("INSERT INTO jenjangs (name,code,level,active) VALUES ('Synthetic Rollback','SYN-ROLLBACK','primary',1)").lastInsertRowid);
      const programId = Number(database.client.run("INSERT INTO academic_programs (jenjang_id,name,active) VALUES (?, 'Synthetic Program',1)", [jenjangId]).lastInsertRowid);
      const gradeId = Number(database.client.run("INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (?, ?, 'Synthetic Grade',1,1)", [jenjangId, programId]).lastInsertRowid);
      const oldClassId = Number(database.client.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?, ?, 'Synthetic Old Class','OLD',1)", [yearId, gradeId]).lastInsertRowid);
      const newClassId = Number(database.client.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?, ?, 'Synthetic New Class','NEW',1)", [yearId, gradeId]).lastInsertRowid);
      database.client.run("INSERT INTO student_enrollments (student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (?, ?, ?, ?, 'Synthetic Old Class',1,'2026-07-01','ACTIVE')", ["11111111-1111-1111-1111-111111111111", yearId, jenjangId, oldClassId]);
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) })); const auth = { cookie: cookie(login) };
      const template = await app.handle(new Request("http://local/api/student-masters/management/export-template", { headers: auth }));
      const workbook = await loadXlsxWorkbook(await template.arrayBuffer()); const sheet = workbook.getWorksheet("Student Data")!;
      for (const [header, value] of Object.entries({ "Legal Name": "Synthetic Updated", Address: "Synthetic Street", Phone: "081300000001", "Guardian Name": "Synthetic Guardian", "Attendance Device No. ID": "123456", "Academic Class ID": newClassId, Class: "Synthetic New Class" })) sheet.getRow(2).getCell(headers.indexOf(header) + 1).value = value;
      const form = new FormData(); form.append("file", new File([await writeXlsxWorkbook(workbook)], "synthetic-rollback.xlsx"));
      const response = await app.handle(new Request("http://local/api/student-masters/management/update-preview", { method: "POST", headers: auth, body: form })); const plan = await response.json() as any;
      expect(plan.summary).toMatchObject({ total: 1, updates: 1 });
      const committed = await app.handle(new Request(`http://local/api/student-masters/management/update-commit/${plan.id}`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ selected_row_ids: [plan.rows[0].id], confirmation: "COMMIT_STUDENT_DATA_UPDATE", preview_checksum: plan.preview_checksum }) }));
      expect(committed.status, await committed.text()).toBe(200);
      expect((database.client.query("SELECT full_name FROM student_masters WHERE id = ?").get("11111111-1111-1111-1111-111111111111") as any).full_name).toBe("Synthetic Updated");
      database.client.run("UPDATE student_contacts SET student_phone = '081399999999' WHERE student_master_id = ?", ["11111111-1111-1111-1111-111111111111"]);
      const stale = await app.handle(new Request(`http://local/api/student-import-sessions/${plan.session_id}/rollback-preview`, { method: "POST", headers: auth }));
      expect((await stale.json() as any)).toMatchObject({ is_rollbackable: false, blocked_actions: 1 });
      database.client.run("UPDATE student_contacts SET student_phone = '081300000001' WHERE student_master_id = ?", ["11111111-1111-1111-1111-111111111111"]);
      const rollbackPreview = await app.handle(new Request(`http://local/api/student-import-sessions/${plan.session_id}/rollback-preview`, { method: "POST", headers: auth })); const rollbackPlan = await rollbackPreview.json() as any;
      expect(rollbackPlan).toMatchObject({ is_rollbackable: true, eligible_actions: 1 });
      const rollback = await app.handle(new Request(`http://local/api/student-import-sessions/${plan.session_id}/rollback`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ preview_checksum: rollbackPlan.preview_checksum, mode: "ALL", reason: "Synthetic Student Update compensation", confirmation_value: rollbackPlan.required_confirmation, idempotency_token: "synthetic-rollback-2" }) }));
      expect(rollback.status, await rollback.text()).toBe(200);
      expect(database.client.query("SELECT full_name, normalized_name FROM student_masters WHERE id = ?").get("11111111-1111-1111-1111-111111111111")).toMatchObject({ full_name: "Andi", normalized_name: "andi" });
      expect(database.client.query("SELECT academic_class_id, class_name FROM student_enrollments WHERE student_master_id = ? AND academic_year_id = ?").get("11111111-1111-1111-1111-111111111111", yearId)).toMatchObject({ academic_class_id: oldClassId, class_name: "Synthetic Old Class" });
      expect((database.client.query("SELECT COUNT(*) AS count FROM student_addresses WHERE student_master_id = ?").get("11111111-1111-1111-1111-111111111111") as any).count).toBe(0);
      expect((database.client.query("SELECT COUNT(*) AS count FROM student_contacts WHERE student_master_id = ?").get("11111111-1111-1111-1111-111111111111") as any).count).toBe(0);
      expect((database.client.query("SELECT COUNT(*) AS count FROM student_parent_guardians WHERE student_master_id = ?").get("11111111-1111-1111-1111-111111111111") as any).count).toBe(0);
      expect((database.client.query("SELECT COUNT(*) AS count FROM student_device_identities WHERE student_master_id = ? AND is_active = 1").get("11111111-1111-1111-1111-111111111111") as any).count).toBe(0);
      expect((database.client.query("SELECT COUNT(*) AS count FROM student_import_applied_actions WHERE session_id = ? AND action_type = 'UPDATE_STUDENT_DATA'").get(plan.session_id) as any).count).toBe(1);
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);
});
