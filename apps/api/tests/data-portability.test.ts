import { describe, expect, it } from "bun:test";
import JSZip from "jszip";
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

  it("keeps sensitive roster export fields correct with bulk related-record queries", async () => {
    const path = `/tmp/operatoros-portability-sensitive-${process.pid}-${Date.now()}.db`;
    const auditDir = `/tmp/operatoros-portability-sensitive-audit-${process.pid}-${Date.now()}`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ environment: "test", databaseHandle: database, auth: { authCookieSecret: secret, auditDir } });
    try {
      const id = "sensitive-export-candidate";
      database.client.run("INSERT INTO student_masters (id, full_name, normalized_name, student_status, gender, nik, nisn, nipd) VALUES (?, 'Sensitive Candidate', 'sensitive candidate', 'active', 'L', 'SYN-NIK', 'SYN-NISN', 'SYN-NIPD')", [id]);
      database.client.run("INSERT INTO student_addresses (student_master_id, address) VALUES (?, 'Synthetic Street')", [id]);
      database.client.run("INSERT INTO student_contacts (student_master_id, student_phone) VALUES (?, '08000000000')", [id]);
      database.client.run("INSERT INTO student_device_identities (student_master_id, device_identifier, device_source, effective_from, is_active) VALUES (?, 'RF-SYNTHETIC-001', 'test', '2026-01-01', 1)", [id]);
      database.client.run("INSERT INTO student_parent_guardians (student_master_id, guardian_type, name, phone) VALUES (?, 'father', 'Synthetic Guardian', '08111111111')", [id]);
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: `astyx_session=${cookie(login)}`, origin: "http://localhost:5173" };
      const response = await app.handle(new Request("http://local/api/data-portability/exports", {
        method: "POST", headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ dataset: "student_roster", selected_ids: [id], include_sensitive_fields: true }),
      }));
      expect(response.status).toBe(200);
      const csv = await response.text();
      expect(csv).toContain("RF-SYNTHETIC-001");
      expect(csv).toContain("Synthetic Street");
      expect(csv).toContain("08000000000");
      expect(csv).toContain("Synthetic Guardian");
      expect(csv).toContain("08111111111");
    } finally {
      database.close();
      rmSync(path, { force: true });
      rmSync(auditDir, { recursive: true, force: true });
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

  it("classifies changes to every committed roster field and rejects stale or unaudited commits", async () => {
    const path = `/tmp/operatoros-portability-parity-${process.pid}-${Date.now()}.db`;
    const auditDir = `/tmp/operatoros-portability-parity-audit-${process.pid}-${Date.now()}`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ environment: "test", databaseHandle: database, auth: { authCookieSecret: secret, auditDir } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: `astyx_session=${cookie(login)}`, origin: "http://localhost:5173" };
      for (const id of ["gender-review", "birth-review", "religion-review", "stale-review", "atomic-review"]) {
        database.client.run("INSERT INTO student_masters (id, full_name, normalized_name, student_status, gender, birth_place, religion) VALUES (?, ?, ?, 'active', 'L', 'Old Place', 'Islam')", [id, `${id} student`, `${id} student`]);
      }
      const preview = async (csv: string) => {
        const form = new FormData();
        form.append("dataset", "student_roster");
        form.append("file", new File([csv], "roster.csv", { type: "text/csv" }));
        const response = await app.handle(new Request("http://local/api/data-portability/imports/preview", { method: "POST", headers: auth, body: form }));
        expect(response.status).toBe(200);
        return await response.json() as { batch_id: string; summary: Record<string, number>; classified_rows: Array<{ student_id: string; status: string }> };
      };
      const commit = (batchId: string) => app.handle(new Request("http://local/api/data-portability/imports/commit", {
        method: "POST", headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ batch_id: batchId, confirmation: "CONFIRM_IMPORT" }),
      }));

      const fieldPreview = await preview([
        "student_id,full_name,student_status,gender,birth_place,religion",
        "gender-review,gender-review student,active,P,Old Place,Islam",
        "birth-review,birth-review student,active,L,New Place,Islam",
        "religion-review,religion-review student,active,L,Old Place,Christianity",
      ].join("\n"));
      expect(fieldPreview.summary).toMatchObject({ UPDATE: 3, NEW: 0 });
      expect(fieldPreview.classified_rows.map((value) => value.status)).toEqual(["UPDATE", "UPDATE", "UPDATE"]);

      const stalePreview = await preview([
        "student_id,full_name,student_status,gender,birth_place,religion",
        "stale-review,stale-review updated,active,L,Old Place,Islam",
      ].join("\n"));
      database.client.run("UPDATE student_masters SET religion = 'Concurrent edit' WHERE id = 'stale-review'");
      const staleCommit = await commit(stalePreview.batch_id);
      expect(staleCommit.status).toBe(409);
      expect(database.client.query<{ religion: string }, []>("SELECT religion FROM student_masters WHERE id = 'stale-review'").get()?.religion).toBe("Concurrent edit");

      const atomicPreview = await preview([
        "student_id,full_name,student_status,gender,birth_place,religion",
        "atomic-review,atomic-review updated,active,L,Old Place,Islam",
      ].join("\n"));
      database.client.run("CREATE TRIGGER fail_import_audit BEFORE INSERT ON operations_audit_events WHEN NEW.operation = 'IMPORT_COMMIT' BEGIN SELECT RAISE(ABORT, 'blocked audit'); END");
      const failedCommit = await commit(atomicPreview.batch_id);
      expect(failedCommit.status).toBe(500);
      expect(database.client.query<{ full_name: string }, []>("SELECT full_name FROM student_masters WHERE id = 'atomic-review'").get()?.full_name).toBe("atomic-review student");
      expect(database.client.query("SELECT id FROM operations_audit_events WHERE operation = 'IMPORT_COMMIT'").all()).toHaveLength(0);
    } finally {
      database.close();
      rmSync(path, { force: true });
      rmSync(auditDir, { recursive: true, force: true });
    }
  }, 30000);

  it("limits decompressed ZIP members before retaining oversized contents", async () => {
    const path = `/tmp/operatoros-portability-zip-limit-${process.pid}-${Date.now()}.db`;
    const auditDir = `/tmp/operatoros-portability-zip-limit-audit-${process.pid}-${Date.now()}`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ environment: "test", databaseHandle: database, auth: { authCookieSecret: secret, auditDir } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: `astyx_session=${cookie(login)}`, origin: "http://localhost:5173" };
      const archive = new JSZip();
      archive.file("manifest.json", JSON.stringify({ operatoros_format: "operatoros_csv_v1", dataset: "student_roster" }));
      archive.file("students.csv", Buffer.alloc(25 * 1024 * 1024 + 1, 65), { compression: "DEFLATE" });
      const bytes = await archive.generateAsync({ type: "uint8array", compression: "DEFLATE" });
      expect(bytes.byteLength).toBeLessThan(25 * 1024 * 1024);
      const form = new FormData();
      form.append("dataset", "student_roster");
      form.append("file", new File([bytes], "oversized.zip", { type: "application/zip" }));
      const response = await app.handle(new Request("http://local/api/data-portability/imports/preview", { method: "POST", headers: auth, body: form }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ detail: expect.stringContaining("maximum size limit") });
    } finally {
      database.close();
      rmSync(path, { force: true });
      rmSync(auditDir, { recursive: true, force: true });
    }
  }, 30000);

});
