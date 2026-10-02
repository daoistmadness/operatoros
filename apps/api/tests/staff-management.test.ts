import { describe, expect, it } from "bun:test";
import { createFreshDatabase, openDatabase } from "@operatoros/db";
import { addWorksheet, appendRow, createWorkbook, loadXlsxWorkbook, writeXlsxWorkbook } from "@operatoros/excel";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";

const secret = "synthetic-staff-test-cookie-secret-32";
const employeeHeaders = ["Id Staff", "STATUS", "Nama", "NIP", "NUPTK", "DAPODIK", "Tempat Lahir", "Tanggal Lahir", "Umur", "Jabatan", "Mulai Kerja", "Masa Kerja", "NIK", "Alamat", "Email", "No Hp"];

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function setup(label: string, clock: () => Date = () => new Date()) {
  const root = mkdtempSync(join(tmpdir(), `operatoros-staff-${label}-`));
  const path = join(root, "operatoros.sqlite");
  const auditDir = join(root, "audit");
  createFreshDatabase(path);
  const database = openDatabase(path);
  const adminHash = await Bun.password.hash("synthetic-admin-password-123", "argon2id");
  const staffHash = await Bun.password.hash("synthetic-staff-password-123", "argon2id");
  database.client.run("INSERT INTO users (username,password_hash,role,is_active,created_at,updated_at,failed_login_attempts) VALUES (?,?,'admin',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0)", ["synthetic-admin", adminHash]);
  database.client.run("INSERT INTO users (username,password_hash,role,is_active,created_at,updated_at,failed_login_attempts) VALUES (?,?,'staff',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0)", ["synthetic-staff", staffHash]);
  const app = createApp({ databaseHandle: database, clock, auth: { authCookieSecret: secret, auditDir, allowedOrigins: ["http://local"] } });
  const adminLogin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "synthetic-admin", password: "synthetic-admin-password-123" }) }));
  const staffLogin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "synthetic-staff", password: "synthetic-staff-password-123" }) }));
  return {
    root, database, app, admin: cookie(adminLogin), staff: cookie(staffLogin),
    cleanup() { database.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

function jsonRequest(method: string, path: string, session?: string, body?: unknown): Request {
  const headers = new Headers();
  if (session) headers.set("cookie", session);
  if (method !== "GET") headers.set("origin", "http://local");
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function employeeWorkbook(rows: unknown[][], date1904 = false): Promise<Uint8Array> {
  const workbook = createWorkbook({ exportType: "synthetic-staff-import-test" });
  workbook.properties.date1904 = date1904;
  const sheet = addWorksheet(workbook, "Data Karyawan Edelweiss");
  appendRow(sheet, employeeHeaders);
  for (const values of rows) appendRow(sheet, values);
  for (let row = 2; row <= rows.length + 1; row += 1) {
    sheet.getCell(row, 9).value = { formula: "1+1", result: 99 };
    sheet.getCell(row, 12).value = { formula: "1+1", result: 999 };
  }
  return writeXlsxWorkbook(workbook);
}

function employeeRow(id = "TEST-001", nip = "123456789012345678", name = "Synthetic Employee"): unknown[] {
  return [id, "AKTIF", name, nip, null, "TIDAK", "Testville", new Date("2000-10-03T00:00:00.000Z"), 99, "Synthetic Teacher", new Date("2020-01-01T00:00:00.000Z"), 999, nip.slice(0, 16), "1 Example Street", "employee@example.com", "081234567890"];
}

async function preview(app: ReturnType<typeof createApp>, session: string, bytes: Uint8Array): Promise<Response> {
  const form = new FormData();
  form.append("file", new File([bytes], "synthetic-employees.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  return app.handle(new Request("http://local/api/staff/import/preview", { method: "POST", headers: { cookie: session, origin: "http://local" }, body: form }));
}

describe("employee master data", () => {
  it("authorizes access, keeps sensitive fields off list/detail, records history, and exports by capability", async () => {
    const value = await setup("crud");
    try {
      expect((await value.app.handle(jsonRequest("GET", "/api/staff"))).status).toBe(401);
      expect((await value.app.handle(jsonRequest("GET", "/api/staff", value.staff))).status).toBe(403);
      const created = await value.app.handle(jsonRequest("POST", "/api/staff", value.admin, {
        full_name: "Synthetic Employee", source_staff_id: "TEST-CRUD-1", employment_status: "ACTIVE", nip: "223456789012345678",
        birth_place: "Testville", birth_date: "2000-10-03", job_title_raw: "Synthetic Teacher", employment_start_date: "2020-01-01",
        dapodik_status_raw: "AKTIF", nuptk: "2234567890123456", nik: "2234567890123456", email: "employee@example.com", phone: "+620000000000", address: "1 Example Street",
      }));
      expect(created.status).toBe(201);
      const profile = await created.json() as { id: string; updated_at: string };
      const list = await value.app.handle(jsonRequest("GET", "/api/staff?status=ALL", value.admin));
      expect(list.status).toBe(200);
      const listBody = await list.json() as { items: Array<Record<string, unknown>> };
      expect(listBody.items[0]).toMatchObject({ full_name: "Synthetic Employee", has_nuptk: true });
      for (const field of ["nik", "address", "phone", "email", "birth_date", "birth_place"]) expect(listBody.items[0]).not.toHaveProperty(field);
      const detail = await value.app.handle(jsonRequest("GET", `/api/staff/${profile.id}`, value.admin));
      const detailBody = await detail.json() as Record<string, unknown>;
      expect(detailBody).not.toHaveProperty("birth_date");
      expect((await value.app.handle(jsonRequest("GET", `/api/staff/${profile.id}/sensitive`, value.staff))).status).toBe(403);
      const sensitive = await value.app.handle(jsonRequest("GET", `/api/staff/${profile.id}/sensitive`, value.admin));
      expect(await sensitive.json()).toMatchObject({ birth_date: "2000-10-03", contact: { email: "employee@example.com", address: "1 Example Street" }, identifiers: expect.arrayContaining([expect.objectContaining({ type: "NIK", normalized_value: "2234567890123456" })]) });

      const updated = await value.app.handle(jsonRequest("PATCH", `/api/staff/${profile.id}`, value.admin, { job_title_raw: "Synthetic Lead", expected_updated_at: profile.updated_at }));
      expect(updated.status).toBe(200);
      expect((await value.app.handle(jsonRequest("PATCH", `/api/staff/${profile.id}`, value.admin, { full_name: "Stale overwrite", expected_updated_at: profile.updated_at }))).status).toBe(409);
      const status = await value.app.handle(jsonRequest("POST", `/api/staff/${profile.id}/employment-status`, value.admin, { employment_status: "FORMER", effective_date: "2026-10-02" }));
      expect(status.status).toBe(200);
      expect((await status.json() as { employment_end_date: string }).employment_end_date).toBe("2026-10-02");
      const future = await value.app.handle(jsonRequest("POST", `/api/staff/${profile.id}/employment-status`, value.admin, { employment_status: "ACTIVE", effective_date: "2099-01-01" }));
      expect(future.status).toBe(422);
      const history = await value.app.handle(jsonRequest("GET", `/api/staff/${profile.id}/history`, value.admin));
      expect(await history.json()).toEqual(expect.arrayContaining([expect.objectContaining({ action: "EMPLOYMENT_HISTORY", effective_date: "2026-10-02" })]));
      const historic = await value.app.handle(jsonRequest("GET", "/api/staff/analytics/summary?as_of_date=2024-01-01", value.admin));
      expect((await historic.json() as { workforce: Record<string, number> }).workforce).toMatchObject({ total: 1, active: 1, former: 0 });

      expect((await value.app.handle(jsonRequest("GET", "/api/staff/export-excel?status=ALL", value.staff))).status).toBe(403);
      expect((await value.app.handle(jsonRequest("GET", "/api/staff/export-excel?status=ALL&include_sensitive=true", value.staff))).status).toBe(403);
      const exported = await value.app.handle(jsonRequest("GET", "/api/staff/export-excel?status=ALL", value.admin));
      expect(exported.status).toBe(200);
      const workbook = await loadXlsxWorkbook(new Uint8Array(await exported.arrayBuffer()));
      expect(workbook.getWorksheet("Employees")?.getRow(1).values).not.toContain("NIK");
      const nipSearch = await value.app.handle(jsonRequest("GET", "/api/staff?status=ALL&search=223456789012345678", value.admin));
      expect(await nipSearch.json()).toMatchObject({ total: 1 });
      const emailSearch = await value.app.handle(jsonRequest("GET", "/api/staff?status=ALL&search=employee%40example.com", value.admin));
      expect(await emailSearch.json()).toMatchObject({ total: 1 });
      const nipExport = await value.app.handle(jsonRequest("GET", "/api/staff/export-excel?status=ALL&search=223456789012345678", value.admin));
      expect((await loadXlsxWorkbook(new Uint8Array(await nipExport.arrayBuffer())).then((book) => book.getWorksheet("Employees")!.rowCount))).toBe(2);
      const emailExport = await value.app.handle(jsonRequest("GET", "/api/staff/export-excel?status=ALL&search=employee%40example.com", value.admin));
      expect((await loadXlsxWorkbook(new Uint8Array(await emailExport.arrayBuffer())).then((book) => book.getWorksheet("Employees")!.rowCount))).toBe(2);
      const sensitiveExport = await value.app.handle(jsonRequest("GET", "/api/staff/export-excel?status=ALL&include_sensitive=true", value.admin));
      const sensitiveBook = await loadXlsxWorkbook(new Uint8Array(await sensitiveExport.arrayBuffer()));
      expect(sensitiveBook.getWorksheet("Employees")?.getRow(1).values).toContain("NIK");

      const audit = value.database.client.query("SELECT operation,metadata FROM operations_audit_events WHERE entity_reference=?").all(profile.id) as Array<{ operation: string; metadata: string }>;
      expect(audit.map((event) => event.operation)).toEqual(expect.arrayContaining(["STAFF_CREATE", "STAFF_PROFILE_UPDATE", "STAFF_STATUS_CHANGE", "STAFF_SENSITIVE_READ"]));
      expect(audit.map((event) => event.metadata).join(" ")).not.toContain("2234567890123456");
    } finally { value.cleanup(); }
  });

  it("previews, commits and reimports a synthetic workbook without persisting formulas or erasing blank fields", async () => {
    const value = await setup("import");
    try {
      const bytes = await employeeWorkbook([employeeRow()]);
      const firstPreview = await preview(value.app, value.admin, bytes);
      expect(firstPreview.status).toBe(200);
      const staged = await firstPreview.json() as { batch_id: string; summary: { total: number; valid: number; new: number; warnings: number }; rows: Array<{ row_number: number; state: string; issues: Array<{ code: string }> }> };
      expect(staged.summary).toMatchObject({ total: 1, valid: 1, new: 1 });
      expect(staged.summary.warnings).toBeGreaterThan(0);
      expect(staged.rows[0]?.state).toBe("NEW");
      expect(staged.rows[0]?.issues.map((issue) => issue.code)).toContain("UNMAPPED_DAPODIK_STATUS");
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM staff_members").get() as { count: number }).count)).toBe(0);
      const committed = await value.app.handle(jsonRequest("POST", "/api/staff/import/commit", value.admin, { batch_id: staged.batch_id, row_numbers: [2] }));
      expect(committed.status).toBe(200);
      expect(await committed.json()).toMatchObject({ status: "APPLIED", summary: { inserted: 1 } });
      const member = value.database.client.query("SELECT id,birth_date,employment_start_date,dapodik_status_raw,dapodik_status_normalized FROM staff_members WHERE source_staff_id='TEST-001'").get() as Record<string, unknown>;
      expect(member).toMatchObject({ birth_date: "2000-10-03", employment_start_date: "2020-01-01", dapodik_status_raw: "TIDAK", dapodik_status_normalized: "UNKNOWN" });
      expect(value.database.client.query("PRAGMA table_info(staff_members)").all().map((column) => (column as { name: string }).name)).not.toContain("age");
      const stagedAfterCommit = value.database.client.query("SELECT raw_payload_json,normalized_payload_json FROM staff_import_rows WHERE batch_id=?").get(staged.batch_id) as { raw_payload_json: string; normalized_payload_json: string };
      expect(stagedAfterCommit).toEqual({ raw_payload_json: "{}", normalized_payload_json: "{}" });

      const secondPreview = await preview(value.app, value.admin, bytes);
      const second = await secondPreview.json() as { batch_id: string; summary: { unchanged: number; new: number }; rows: Array<{ state: string }> };
      expect(second.summary).toMatchObject({ unchanged: 1, new: 0 });
      expect(second.rows[0]?.state).toBe("UNCHANGED");
      const secondCommit = await value.app.handle(jsonRequest("POST", "/api/staff/import/commit", value.admin, { batch_id: second.batch_id, row_numbers: [2] }));
      expect(await secondCommit.json()).toMatchObject({ summary: { inserted: 0, unchanged: 1 } });
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM staff_members").get() as { count: number }).count)).toBe(1);
    } finally { value.cleanup(); }
  });

  it("reads the displayed text from Excel hyperlink cells", async () => {
    const value = await setup("hyperlink-email");
    try {
      const row = employeeRow("TEST-HYPERLINK-EMAIL");
      row[14] = { text: "linked.employee@example.com", hyperlink: "mailto:linked.employee@example.com" };
      const result = await preview(value.app, value.admin, await employeeWorkbook([row]));
      const body = await result.json() as { batch_id: string; summary: { valid: number }; rows: Array<{ issues: Array<{ field: string; code: string }> }> };
      expect(result.status).toBe(200);
      expect(body.summary.valid).toBe(1);
      expect(body.rows[0]?.issues).not.toContainEqual(expect.objectContaining({ field: "email", code: "INVALID_EMAIL" }));

      const committed = await value.app.handle(jsonRequest("POST", "/api/staff/import/commit", value.admin, { batch_id: body.batch_id, row_numbers: [2] }));
      expect(committed.status).toBe(200);
      expect(value.database.client.query("SELECT email FROM staff_contact_details").get()).toEqual({ email: "linked.employee@example.com" });
    } finally { value.cleanup(); }
  });

  it("preserves raw position and DAPODIK values when an unrelated profile field is edited", async () => {
    const value = await setup("raw-roundtrip");
    try {
      value.database.client.run("INSERT INTO staff_job_title_mappings (raw_title,normalized_title,position_category,is_teaching_role,status) VALUES ('Teacher A','Teacher','TEACHING',1,'APPROVED')");
      const created = await value.app.handle(jsonRequest("POST", "/api/staff", value.admin, {
        full_name: "Synthetic Raw Employee", source_staff_id: "TEST-RAW-1", employment_status: "ACTIVE",
        nip: "523456789012345678", job_title_raw: "Teacher A", dapodik_status_raw: "AKTIF",
        employment_start_date: "2020-01-01",
      }));
      expect(created.status).toBe(201);
      const profile = await created.json() as { id: string; updated_at: string; job_title: string; job_title_raw: string; dapodik_status: string; dapodik_status_raw: string };
      expect(profile).toMatchObject({ job_title: "Teacher", job_title_raw: "Teacher A", dapodik_status: "ACTIVE", dapodik_status_raw: "AKTIF" });

      const updated = await value.app.handle(jsonRequest("PATCH", `/api/staff/${profile.id}`, value.admin, { full_name: "Synthetic Renamed Employee", expected_updated_at: profile.updated_at }));
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({ full_name: "Synthetic Renamed Employee", job_title: "Teacher", job_title_raw: "Teacher A", dapodik_status: "ACTIVE", dapodik_status_raw: "AKTIF" });
      expect(value.database.client.query("SELECT job_title_raw,dapodik_status_raw,job_title_normalized,dapodik_status_normalized FROM staff_members WHERE id=?").get(profile.id)).toEqual({ job_title_raw: "Teacher A", dapodik_status_raw: "AKTIF", job_title_normalized: "Teacher", dapodik_status_normalized: "ACTIVE" });
      expect((await value.app.handle(jsonRequest("GET", "/api/staff/analytics/summary", value.admin)).then((response) => response.json()) as { workforce: { teaching: number } }).workforce.teaching).toBe(1);
    } finally { value.cleanup(); }
  });

  it("revalidates NIP and NIK identities for unmatched rows at commit", async () => {
    for (const kind of ["nip", "nik"] as const) {
      const value = await setup(`stale-${kind}`);
      try {
        const row = employeeRow(`TEST-STALE-${kind.toUpperCase()}`);
        const pending = await preview(value.app, value.admin, await employeeWorkbook([row]));
        const staged = await pending.json() as { batch_id: string; rows: Array<{ state: string }> };
        expect(staged.rows[0]?.state).toBe("NEW");
        const canonical = await value.app.handle(jsonRequest("POST", "/api/staff", value.admin, {
          full_name: "Synthetic Concurrent Employee", source_staff_id: `CANONICAL-${kind.toUpperCase()}`,
          [kind]: kind === "nip" ? row[3] : row[12],
        }));
        expect(canonical.status).toBe(201);

        const committed = await value.app.handle(jsonRequest("POST", "/api/staff/import/commit", value.admin, { batch_id: staged.batch_id, row_numbers: [2] }));
        expect(committed.status).toBe(200);
        expect(value.database.client.query("SELECT source_row_number AS row_number FROM staff_import_rows WHERE batch_id=? AND id IN (SELECT import_row_id FROM staff_import_issues WHERE batch_id=? AND issue_code='STALE_UNMATCHED_MATCH')").get(staged.batch_id, staged.batch_id)).toEqual({ row_number: 2 });
        expect(await committed.json()).toMatchObject({ summary: { inserted: 0, failed: 1 }, failed_rows: [{ row_number: 2, code: "STALE_UNMATCHED_MATCH" }] });
        expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM staff_members").get() as { count: number }).count)).toBe(1);
        expect(value.database.client.query("SELECT issue_code FROM staff_import_issues WHERE batch_id=? AND issue_code LIKE 'STALE_%'").get(staged.batch_id)).toEqual({ issue_code: "STALE_UNMATCHED_MATCH" });
        const replay = await value.app.handle(jsonRequest("POST", "/api/staff/import/commit", value.admin, { batch_id: staged.batch_id, row_numbers: [2] }));
        expect(await replay.json()).toMatchObject({ summary: { inserted: 0, failed: 1 }, failed_rows: [{ row_number: 2, code: "STALE_UNMATCHED_MATCH" }] });
      } finally { value.cleanup(); }
    }
  });

  it("rejects stale unmatched rows whose strong identifiers now point to different employees", async () => {
    const value = await setup("stale-conflict");
    try {
      const source = employeeRow("TEST-STALE-CONFLICT", "823456789012345678");
      const pending = await preview(value.app, value.admin, await employeeWorkbook([source]));
      const staged = await pending.json() as { batch_id: string; rows: Array<{ state: string }> };
      expect(staged.rows[0]?.state).toBe("NEW");
      const bySource = await value.app.handle(jsonRequest("POST", "/api/staff", value.admin, { full_name: "Synthetic Source Match", source_staff_id: String(source[0]) }));
      const byNip = await value.app.handle(jsonRequest("POST", "/api/staff", value.admin, { full_name: "Synthetic NIP Match", nip: source[3] }));
      expect([bySource.status, byNip.status]).toEqual([201, 201]);

      const committed = await value.app.handle(jsonRequest("POST", "/api/staff/import/commit", value.admin, { batch_id: staged.batch_id, row_numbers: [2] }));
      expect(await committed.json()).toMatchObject({ summary: { inserted: 0, failed: 1 }, failed_rows: [{ row_number: 2, code: "STALE_CONFLICTING_MATCHES" }] });
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM staff_members").get() as { count: number }).count)).toBe(2);
      expect(value.database.client.query("SELECT issue_code FROM staff_import_issues WHERE batch_id=? AND issue_code LIKE 'STALE_%'").get(staged.batch_id)).toEqual({ issue_code: "STALE_CONFLICTING_MATCHES" });
    } finally { value.cleanup(); }
  });

  it("parses equivalent 1900 and 1904 Excel date serials to the same calendar date", async () => {
    const value = await setup("date-epochs");
    try {
      const standard = employeeRow("TEST-1900");
      standard[7] = 43831;
      standard[10] = 43831;
      const legacy = employeeRow("TEST-1904");
      legacy[7] = 42369;
      legacy[10] = 42369;
      const standardPreview = await preview(value.app, value.admin, await employeeWorkbook([standard]));
      const legacyPreview = await preview(value.app, value.admin, await employeeWorkbook([legacy], true));
      const standardBatch = await standardPreview.json() as { batch_id: string };
      const legacyBatch = await legacyPreview.json() as { batch_id: string };
      const dates = [standardBatch.batch_id, legacyBatch.batch_id].map((batchId) => {
        const payload = value.database.client.query("SELECT normalized_payload_json FROM staff_import_rows WHERE batch_id=?").get(batchId) as { normalized_payload_json: string };
        const normalized = JSON.parse(payload.normalized_payload_json) as { birth_date: string; employment_start_date: string };
        return [normalized.birth_date, normalized.employment_start_date];
      });
      expect(dates).toEqual([["2020-01-01", "2020-01-01"], ["2020-01-01", "2020-01-01"]]);
    } finally { value.cleanup(); }
  });

  it("preserves eight-digit text NIP and rejects numeric or placeholder source cells", async () => {
    const value = await setup("nip-source-formats");
    try {
      const textNip = employeeRow("TEST-NIP-TEXT", "00123456"); textNip[12] = "9234567890123456";
      const numericNip = employeeRow("TEST-NIP-NUMERIC", "12345678"); numericNip[3] = 12345678; numericNip[12] = "9234567890123457";
      const placeholderNip = employeeRow("TEST-NIP-ZERO", "0"); placeholderNip[12] = "9234567890123458";
      const response = await preview(value.app, value.admin, await employeeWorkbook([textNip, numericNip, placeholderNip]));
      const staged = await response.json() as { batch_id: string; summary: { valid: number; invalid: number }; rows: Array<{ state: string; issues: Array<{ code: string }> }> };
      expect(staged.summary).toMatchObject({ valid: 1, invalid: 2 });
      expect(staged.rows.map((row) => row.state)).toEqual(["WARNING", "INVALID", "INVALID"]);
      expect(staged.rows[1]?.issues.map((issue) => issue.code)).toContain("IDENTIFIER_STORED_AS_NUMBER");
      expect(staged.rows[2]?.issues.map((issue) => issue.code)).toContain("PLACEHOLDER_NIP");
      const committed = await value.app.handle(jsonRequest("POST", "/api/staff/import/commit", value.admin, { batch_id: staged.batch_id, row_numbers: [2] }));
      expect(await committed.json()).toMatchObject({ summary: { inserted: 1, rejected: 2 } });
      expect(value.database.client.query("SELECT raw_value,normalized_value FROM staff_identifiers WHERE staff_member_id=(SELECT id FROM staff_members WHERE source_staff_id='TEST-NIP-TEXT') AND identifier_type='NIP'").get()).toEqual({ raw_value: "00123456", normalized_value: "00123456" });
      const manual = await value.app.handle(jsonRequest("POST", "/api/staff", value.admin, { full_name: "Synthetic Text NIP", source_staff_id: "TEST-MANUAL-NIP", nip: "00123457" }));
      expect(manual.status).toBe(201);
      expect(value.database.client.query("SELECT raw_value,normalized_value FROM staff_identifiers WHERE staff_member_id=(SELECT id FROM staff_members WHERE source_staff_id='TEST-MANUAL-NIP') AND identifier_type='NIP'").get()).toEqual({ raw_value: "00123457", normalized_value: "00123457" });
    } finally { value.cleanup(); }
  });

  it("warns on matching workbook name and birth date without merging rows", async () => {
    const value = await setup("weak-duplicate");
    try {
      const response = await preview(value.app, value.admin, await employeeWorkbook([
        employeeRow("TEST-WEAK-A", "623456789012345678", "Synthetic Shared Name"),
        employeeRow("TEST-WEAK-B", "723456789012345678", "  synthetic   shared name  "),
      ]));
      const body = await response.json() as { summary: { duplicates: number; conflicts: number }; rows: Array<{ state: string; issues: Array<{ code: string }> }> };
      expect(body.summary).toMatchObject({ duplicates: 2, conflicts: 0 });
      expect(body.rows.map((row) => row.state)).toEqual(["WARNING", "WARNING"]);
      expect(body.rows.every((row) => row.issues.some((issue) => issue.code === "POSSIBLE_DUPLICATE_PERSON"))).toBe(true);
      expect(value.database.client.query("SELECT COUNT(*) AS count FROM staff_members").get()).toEqual({ count: 0 });
    } finally { value.cleanup(); }
  });

  it("cleans abandoned staged PII from the running application lifecycle", async () => {
    let now = new Date();
    const value = await setup("retention", () => now);
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const callbacks: Array<{ id: number; delay: number; callback: () => void }> = [];
    const cleared = new Set<number>();
    let nextId = 0;
    let started = false;
    globalThis.setInterval = ((handler: () => void, delay?: number) => {
      if (delay === 6 * 60 * 60 * 1000) {
        const id = ++nextId;
        callbacks.push({ id, delay, callback: handler });
        return id as unknown as ReturnType<typeof setInterval>;
      }
      return originalSetInterval(handler, delay);
    }) as typeof setInterval;
    globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
      if (typeof id === "number" && callbacks.some((entry) => entry.id === id)) cleared.add(id);
      else originalClearInterval(id);
    }) as typeof clearInterval;
    try {
      const response = await preview(value.app, value.admin, await employeeWorkbook([employeeRow("TEST-RETENTION")]));
      const staged = await response.json() as { batch_id: string };
      expect((value.database.client.query("SELECT raw_payload_json FROM staff_import_rows WHERE batch_id=?").get(staged.batch_id) as { raw_payload_json: string }).raw_payload_json).not.toBe("{}");
      value.app.listen({ hostname: "127.0.0.1", port: 0 });
      started = true;
      const timer = callbacks.find((entry) => entry.delay === 6 * 60 * 60 * 1000);
      expect(timer).toBeDefined();
      now = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      timer!.callback();
      expect(value.database.client.query("SELECT raw_payload_json FROM staff_import_rows WHERE batch_id=?").get(staged.batch_id)).toEqual({ raw_payload_json: "{}" });
      expect(value.database.client.query("SELECT status FROM staff_import_batches WHERE id=?").get(staged.batch_id)).toEqual({ status: "FAILED" });
    } finally {
      if (started) await value.app.stop(true);
      const allTimersStopped = callbacks.every((entry) => cleared.has(entry.id));
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
      value.cleanup();
      expect(allTimersStopped).toBe(true);
    }
  });

  it("rejects active employees with an employment end date", async () => {
    const value = await setup("active-end-date");
    try {
      const response = await value.app.handle(jsonRequest("POST", "/api/staff", value.admin, {
        full_name: "Synthetic Invalid Active", employment_status: "ACTIVE", employment_start_date: "2020-01-01", employment_end_date: "2021-01-01",
      }));
      expect(response.status).toBe(422);
      const formerWithoutEnd = await value.app.handle(jsonRequest("POST", "/api/staff", value.admin, {
        full_name: "Synthetic Former Without Date", employment_status: "FORMER",
      }));
      expect(formerWithoutEnd.status).toBe(201);
    } finally { value.cleanup(); }
  });

  it("rejects workbook duplicates and rolls back all rows on a fatal commit error", async () => {
    const value = await setup("rollback");
    try {
      const duplicate = await preview(value.app, value.admin, await employeeWorkbook([employeeRow("TEST-DUP-A"), employeeRow("TEST-DUP-B")]));
      const duplicateBody = await duplicate.json() as { summary: { duplicates: number; conflicts: number }; rows: Array<{ state: string }> };
      expect(duplicateBody.summary).toMatchObject({ duplicates: 2, conflicts: 2 });
      expect(duplicateBody.rows.map((row) => row.state)).toEqual(["CONFLICT", "CONFLICT"]);

      const validRows = [employeeRow("TEST-ROLLBACK-A", "323456789012345678", "Synthetic First"), employeeRow("TEST-ROLLBACK-B", "423456789012345678", "Synthetic Fail")];
      const pending = await preview(value.app, value.admin, await employeeWorkbook(validRows));
      const pendingBody = await pending.json() as { batch_id: string };
      value.database.client.exec("CREATE TRIGGER synthetic_employee_insert_failure BEFORE INSERT ON staff_members WHEN NEW.full_name='Synthetic Fail' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
      const failed = await value.app.handle(jsonRequest("POST", "/api/staff/import/commit", value.admin, { batch_id: pendingBody.batch_id, row_numbers: [2, 3] }));
      expect(failed.status).toBe(409);
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM staff_members").get() as { count: number }).count)).toBe(0);
      expect(value.database.client.query("SELECT status FROM staff_import_batches WHERE id=?").get(pendingBody.batch_id)).toEqual({ status: "VALIDATED" });
    } finally { value.cleanup(); }
  });
});
