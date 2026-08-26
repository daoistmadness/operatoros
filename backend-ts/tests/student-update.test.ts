import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import ExcelJS from "exceljs";
import { createApp } from "../src/app";
import { openDatabase } from "../src/db/connection";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const python = process.env.OPERATOROS_PYTHON ?? "/home/mikhailryu/projects/absensi/school-attendance-analytics/backend/.venv/bin/python";
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
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await template.arrayBuffer() as any); const sheet = workbook.getWorksheet("Student Data")!; expect(sheet.rowCount).toBeGreaterThan(1); sheet.spliceRows(2, sheet.rowCount - 1); sheet.addRow(["missing-student", ...Array(headers.length - 1).fill("")]); const bytes = new Uint8Array(await workbook.xlsx.writeBuffer()); const form = new FormData(); form.append("file", new File([bytes], "student-update.xlsx"));
      const preview = await app.handle(new Request("http://local/api/student-masters/management/update-preview", { method: "POST", headers: auth, body: form })); const body = await preview.json() as any; expect(preview.status, JSON.stringify(body)).toBe(200); expect(body.summary).toMatchObject({ total: 1, invalid: 1 }); expect(body.rows[0]).toMatchObject({ classification: "INVALID", errors: [{ code: "UNKNOWN_UUID" }] });
      const history = await app.handle(new Request("http://local/api/student-masters/management/import-history", { headers: auth })); expect(history.status).toBe(200); expect((await history.json() as any).total).toBe(1);
      const commit = await app.handle(new Request(`http://local/api/student-masters/management/update-commit/${body.id}`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ selected_row_ids: [body.rows[0].id], confirmation: "COMMIT_STUDENT_DATA_UPDATE", preview_checksum: body.preview_checksum }) })); expect(commit.status).toBe(409);
      expect((database.client.query("SELECT COUNT(*) AS count FROM student_masters").get() as any).count).toBe(1);
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);
});
