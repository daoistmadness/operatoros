import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { createGoldenFixture } from "./fixtures/golden";

const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  createGoldenFixture(path, "academic-with-defaults");
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return value;
}

describe("CSV data portability candidates", () => {
  it("lists datasets, previews and exports CSV, and creates templates", async () => {
    const path = `/tmp/operatoros-portability-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-portability-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: `astyx_session=${cookie(login)}`, origin: "http://localhost:5173" };
      const datasets = await app.handle(new Request("http://local/api/data-portability/datasets", { headers: auth }));
      expect(datasets.status).toBe(200);
      const datasetInfo = await datasets.json() as Array<{ identifier: string; has_sensitive_access: boolean; export_eligible: boolean; import_eligible: boolean }>;
      expect(datasetInfo).toHaveLength(4);
      expect(datasetInfo.find((dataset) => dataset.identifier === "student_roster")?.has_sensitive_access).toBe(true);
      expect(datasetInfo.find((dataset) => dataset.identifier === "student_enrollment")).toMatchObject({ export_eligible: true, import_eligible: false, update_policy: "prohibited" });
      const enrollmentTemplate = await app.handle(new Request("http://local/api/data-portability/templates/student_enrollment", { headers: auth }));
      expect(enrollmentTemplate.status).toBe(400);
      const enrollmentFile = new FormData();
      enrollmentFile.append("dataset", "student_enrollment");
      enrollmentFile.append("file", new File(["student_id,full_name,academic_year_code,class_code\n"], "enrollment.csv", { type: "text/csv" }));
      const enrollmentImport = await app.handle(new Request("http://local/api/data-portability/imports/preview", { method: "POST", headers: auth, body: enrollmentFile }));
      expect(enrollmentImport.status).toBe(400);
      const enrollmentExport = await app.handle(new Request("http://local/api/data-portability/exports", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ dataset: "student_enrollment", format_type: "csv" }) }));
      expect(enrollmentExport.status).toBe(200);
      expect(await enrollmentExport.text()).toContain("academic_year_code");
      const preview = await app.handle(new Request("http://local/api/data-portability/exports/preview", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ dataset: "student_roster" }) }));
      expect(preview.status).toBe(200);
      expect(await preview.json()).toMatchObject({ estimated_row_count: 2, allowed: true, sensitive_fields_included: false });
      const exportResponse = await app.handle(new Request("http://local/api/data-portability/exports", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ dataset: "student_roster", format_type: "csv" }) }));
      expect(exportResponse.status).toBe(200);
      expect(await exportResponse.text()).toContain("student_id,full_name");
      const templateResponse = await app.handle(new Request("http://local/api/data-portability/templates/student_roster", { headers: auth }));
      expect(templateResponse.status).toBe(200);
      expect(new Uint8Array(await templateResponse.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([80, 75]));

      const staffLogin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
      const staffAuth = { cookie: `astyx_session=${cookie(staffLogin)}`, origin: "http://localhost:5173" };
      const staffDatasets = await app.handle(new Request("http://local/api/data-portability/datasets", { headers: staffAuth }));
      const staffRoster = (await staffDatasets.json() as Array<{ identifier: string; has_sensitive_access: boolean }>).find((dataset) => dataset.identifier === "student_roster");
      expect(staffDatasets.status).toBe(200);
      expect(staffRoster?.has_sensitive_access).toBe(false);
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);

  it("counts the complete export dataset and rejects exports above the supported limit", async () => {
    const path = `/tmp/operatoros-portability-limit-${process.pid}-${Date.now()}.db`;
    const auditDir = `/tmp/operatoros-portability-limit-audit-${process.pid}-${Date.now()}`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: `astyx_session=${cookie(login)}`, origin: "http://localhost:5173" };
      const requestPreview = () => app.handle(new Request("http://local/api/data-portability/exports/preview", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ dataset: "student_roster" }) }));
      const requestExport = () => app.handle(new Request("http://local/api/data-portability/exports", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ dataset: "student_roster", format_type: "csv" }) }));

      const belowLimit = await requestPreview();
      expect(await belowLimit.json()).toMatchObject({ estimated_row_count: 2, allowed: true });
      const smallExport = await requestExport();
      expect(smallExport.status).toBe(200);
      expect((await smallExport.text()).trimEnd().split("\n")).toHaveLength(3);

      for (let index = 0; index < 4998; index++) {
        const id = `portability-limit-${index}`;
        database.client.run("INSERT INTO student_masters (id, full_name, normalized_name, student_status, gender) VALUES (?, ?, ?, 'active', 'L')", [id, id, id]);
      }
      const atLimitPreview = await requestPreview();
      expect(await atLimitPreview.json()).toMatchObject({ estimated_row_count: 5000, allowed: true, maximum_permitted_rows: 5000 });
      const fullExport = await requestExport();
      expect(fullExport.status).toBe(200);
      expect((await fullExport.text()).trimEnd().split("\n")).toHaveLength(5001);

      database.client.run("INSERT INTO student_masters (id, full_name, normalized_name, student_status, gender) VALUES ('portability-limit-over', 'over limit', 'over limit', 'active', 'L')");
      const overLimitPreview = await requestPreview();
      expect(await overLimitPreview.json()).toMatchObject({ estimated_row_count: 5001, allowed: false, maximum_permitted_rows: 5000, warnings: [expect.stringContaining("5000 rows")] });
      const rejectedExport = await requestExport();
      expect(rejectedExport.status).toBe(400);
      const rejection = await rejectedExport.json() as { detail: string };
      expect(rejection.detail).toContain("5000 rows");
      expect(rejection.detail).toContain("Narrow filters or select fewer records");
      expect(rejection.detail).not.toContain("student_id,full_name");
    } finally {
      database.close();
      rmSync(path, { force: true });
      rmSync(auditDir, { recursive: true, force: true });
    }
  }, 30000);

  it("previews and commits a disposable CSV import, then emits errors and history", async () => {
    const path = `/tmp/operatoros-portability-import-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-portability-import-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: `astyx_session=${cookie(login)}`, origin: "http://localhost:5173" };
      const form = new FormData();
      form.append("dataset", "student_roster");
      form.append("file", new File(["student_id,full_name,student_status,gender\nportability-new,Portable Student,ACTIVE,L\n"], "students.csv", { type: "text/csv" }));
      const preview = await app.handle(new Request("http://local/api/data-portability/imports/preview", { method: "POST", headers: auth, body: form }));
      expect(preview.status).toBe(200);
      const previewBody = await preview.json() as any;
      expect(previewBody).toMatchObject({ dataset: "student_roster", valid_count: 1, error_count: 0, summary: { NEW: 1 } });
      const commit = await app.handle(new Request("http://local/api/data-portability/imports/commit", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ batch_id: previewBody.batch_id, confirmation: "CONFIRM_IMPORT" }) }));
      expect(commit.status).toBe(200);
      expect(await commit.json()).toMatchObject({ success: true, committed_count: 1 });
      expect((database.client.query("SELECT full_name FROM student_masters WHERE id = ?").get("portability-new") as any).full_name).toBe("Portable Student");
      const errorFile = await app.handle(new Request("http://local/api/data-portability/imports/error-file", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ errors: [{ row: "2", field: "student_id", code: "REQUIRED_FIELD_MISSING", message: "student_id is required" }] }) }));
      expect(errorFile.status).toBe(200);
      expect(await errorFile.text()).toContain("safe_error_code");
      const history = await app.handle(new Request("http://local/api/data-portability/history", { headers: auth }));
      expect(history.status).toBe(200);
      expect((await history.json() as any[]).length).toBeGreaterThanOrEqual(2);
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);

  it("classifies every repeated roster ID as a conflict and revalidates duplicates at commit", async () => {
    const path = `/tmp/operatoros-portability-duplicates-${process.pid}-${Date.now()}.db`;
    const auditDir = `/tmp/operatoros-portability-duplicates-audit-${process.pid}-${Date.now()}`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: `astyx_session=${cookie(login)}`, origin: "http://localhost:5173" };
      const existing = database.client.query("SELECT id, full_name FROM student_masters ORDER BY id LIMIT 1").get() as { id: string; full_name: string };
      const upload = (rows: Array<[string, string]>) => {
        const form = new FormData();
        form.append("dataset", "student_roster");
        form.append("file", new File([[
          "student_id,full_name,student_status,gender",
          ...rows.map(([id, name]) => `${id},${name},ACTIVE,L`),
        ].join("\n")], "duplicate-roster.csv", { type: "text/csv" }));
        return app.handle(new Request("http://local/api/data-portability/imports/preview", { method: "POST", headers: auth, body: form }));
      };
      const newRows: Array<[string, string]> = [
        ["duplicate-new", "First candidate"],
        ["duplicate-new", "Second candidate"],
        ["duplicate-new", "Third candidate"],
        ["valid-mixed", "Valid candidate"],
        ["", "Blank ID one"],
        ["", "Blank ID two"],
      ];
      const preview = await upload(newRows);
      expect(preview.status).toBe(200);
      const first = await preview.json() as any;
      expect(first.summary).toMatchObject({ CONFLICT: 3, NEW: 1, INVALID: 2 });
      expect(first.classified_rows.filter((value: any) => value.student_id === "duplicate-new").map((value: any) => value.status)).toEqual(["CONFLICT", "CONFLICT", "CONFLICT"]);
      expect(first.classified_rows.filter((value: any) => !value.student_id).map((value: any) => value.status)).toEqual(["INVALID", "INVALID"]);

      const reversed = await upload([...newRows].reverse());
      const second = await reversed.json() as any;
      const classifications = (value: any) => value.classified_rows.map((row: any) => [row.student_id, row.status]).sort((a: string[], b: string[]) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`));
      expect(classifications(second)).toEqual(classifications(first));

      const commitNew = await app.handle(new Request("http://local/api/data-portability/imports/commit", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ batch_id: first.batch_id, confirmation: "CONFIRM_IMPORT" }) }));
      expect(commitNew.status).toBe(409);
      expect((await commitNew.json() as any).detail).toContain("duplicate student IDs");
      expect(database.client.query("SELECT id FROM student_masters WHERE id IN ('duplicate-new', 'valid-mixed')").all()).toHaveLength(0);

      const existingRows: Array<[string, string]> = [[existing.id, "Overwrite one"], [existing.id, "Overwrite two"]];
      const existingPreview = await upload(existingRows);
      const existingBody = await existingPreview.json() as any;
      expect(existingBody.summary.CONFLICT).toBe(2);
      expect(existingBody.classified_rows.map((value: any) => value.status)).toEqual(["CONFLICT", "CONFLICT"]);
      const commitExisting = await app.handle(new Request("http://local/api/data-portability/imports/commit", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ batch_id: existingBody.batch_id, confirmation: "CONFIRM_IMPORT" }) }));
      expect(commitExisting.status).toBe(409);
      expect((database.client.query("SELECT full_name FROM student_masters WHERE id = ?").get(existing.id) as any).full_name).toBe(existing.full_name);
    } finally {
      database.close();
      rmSync(path, { force: true });
      rmSync(auditDir, { recursive: true, force: true });
    }
  }, 30000);
});
